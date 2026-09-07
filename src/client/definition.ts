/**
 * Session-cost Node Definition, 0.1.3 (format v2) conversations contract.
 *
 * One Context per (turn, step), started by the durable `step/start` opening the
 * step, then updated by every usage-carrying event of that step:
 *  - `assistant/live-chunk` (usage) — process-local transient frames; the
 *    engine's `settle-assistant` retires them once the durable settlement
 *    lands, replaying the Context from its remaining matches;
 *  - `assistant/attempt` / `assistant/message` — durable settlements whose
 *    usage is the LAST sample in the embedded stream (or `data.usage`);
 *  - `llm/retry-started` — opens a new billing generation for the step so a
 *    retried attempt adds to the total instead of replacing the failed one.
 *
 * A Context per `request/header` carries the routed model id; the view fold
 * attributes every record to the nearest preceding header (attempts carry no
 * model of their own). State is append-only, so the engine's window replace
 * and match replay rebuild it deterministically.
 */

import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConversationNodeContext, ConversationNodeDefinition, ConversationStartMatch,
  ConversationMatch, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { usageFromLiveChunk, usageFromSettlement, type UsageBuckets } from '../core/fold.ts'

/**
 * Structural view of any engine event. The published typings narrow `type` to
 * the vocabulary they shipped with; this plugin consumes the merge-extensible
 * vocabulary structurally, so the union-narrowing-free shape keeps the same
 * bundle valid across host lines (the host's own typings carry the authority
 * at bundle time).
 */
export interface CostEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

const asCostEvent = (event: unknown): CostEventLike => event as CostEventLike

/** One usage observation carried by a step-bound event. */
export interface CostSample {
  readonly seq: number
  /** Event append time — the billing instant used for peak/valley selection. */
  readonly time: number
  /** Model id from a finalized message; attempt/live samples carry none. */
  readonly model?: string
  readonly usage: UsageBuckets
}

/** Step Context state: append-only match history, folded at view time. */
export interface SessionCostStepState {
  readonly role: 'step'
  readonly turn: number
  readonly step: number
  readonly samples: readonly CostSample[]
  /** Seq of each `llm/retry-started` that opened a new generation for this step. */
  readonly retries: readonly number[]
}

/** Header Context state: routed model for request attribution. */
export interface SessionCostHeaderState {
  readonly role: 'header'
  readonly seq: number
  readonly model: string
}

export type SessionCostState = SessionCostStepState | SessionCostHeaderState

const stepId = (turn: number, step: number): string => `${turn}:${step}:step`
const headerId = (seq: number): string => `h:${seq}`

/** Extract {turn, step} from event data when both are present. */
function stepOf(data: unknown): { turn: number; step: number } | undefined {
  const record = data as { turn?: unknown; step?: unknown } | undefined
  return typeof record?.turn === 'number' && typeof record.step === 'number'
    ? { turn: record.turn, step: record.step }
    : undefined
}

/** Model id from an assistant message (message.source.model). */
function modelOf(message: { source?: { model?: unknown } } | undefined): string | undefined {
  const model = message?.source?.model
  return typeof model === 'string' && model !== '' ? model : undefined
}

/** First state (either family) surfaced as its target node. */
function nodeOf(context: ConversationNodeContext<SessionCostState>): ConversationViewNode | null {
  if (context.state === undefined) return null
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: 'cost',
    data: context.state,
  }
}

function start(
  _context: ConversationNodeContext<SessionCostState>,
  match: ConversationStartMatch,
): SessionCostState {
  const event = asCostEvent(match.event)
  if (event.type === 'request/header') {
    const data = event.data as { header?: { config?: { model?: unknown } } } | undefined
    const model = data?.header?.config?.model
    return {
      role: 'header',
      seq: event.seq,
      model: typeof model === 'string' && model !== '' ? model : '',
    }
  }
  const step = stepOf(event.data)
  if (step === undefined) throw new Error('session-cost: step/start without turn/step')
  return { role: 'step', turn: step.turn, step: step.step, samples: [], retries: [] }
}

function update(
  context: ConversationNodeContext<SessionCostState> & { readonly state: SessionCostState },
  match: ConversationMatch,
): SessionCostState {
  const state = context.state
  if (state.role === 'step') {
    const event = asCostEvent(match.event)
    if (event.type === 'llm/retry-started') {
      return { ...state, retries: [...state.retries, event.seq] }
    }
    let usage: UsageBuckets | undefined
    let model: string | undefined
    if (event.type === 'assistant/live-chunk') {
      usage = usageFromLiveChunk(event.data)
    } else if (event.type === 'assistant/attempt') {
      usage = usageFromSettlement(event.data)
    } else if (event.type === 'assistant/message') {
      usage = usageFromSettlement(event.data)
      const data = event.data as { message?: { source?: { model?: unknown } } } | undefined
      model = modelOf(data?.message)
    }
    if (usage === undefined) return state
    const sample: CostSample = {
      seq: event.seq,
      time: event.time,
      ...model === undefined ? {} : { model },
      usage,
    }
    return { ...state, samples: [...state.samples, sample] }
  }
  return state
}

/** Event → Context state machine over the 0.1.3 durable/transient window. */
export const sessionCostDefinition: ConversationNodeDefinition<SessionCostState> = {
  kind: 'session-cost',
  target: 'cost',

  match(event: SessionEventLike): { id: string; role: 'start' | 'update' } | null {
    const typed = asCostEvent(event)
    if (typed.type === 'step/start') {
      const step = stepOf(typed.data)
      return step === undefined ? null : { id: stepId(step.turn, step.step), role: 'start' }
    }
    if (typed.type === 'assistant/live-chunk') {
      if (usageFromLiveChunk(typed.data) === undefined) return null
      const step = stepOf(typed.data)
      return step === undefined ? null : { id: stepId(step.turn, step.step), role: 'update' }
    }
    if (typed.type === 'assistant/attempt' || typed.type === 'assistant/message') {
      const step = stepOf(typed.data)
      return step === undefined ? null : { id: stepId(step.turn, step.step), role: 'update' }
    }
    if (typed.type === 'llm/retry-started') {
      const step = stepOf(typed.data)
      return step === undefined ? null : { id: stepId(step.turn, step.step), role: 'update' }
    }
    if (typed.type === 'request/header') {
      return { id: headerId(typed.seq), role: 'start' }
    }
    return null
  },

  start,
  update,

  publication: match => (
    asCostEvent(match.event).type === 'assistant/live-chunk' ? 'animation-frame' : 'immediate'
  ),

  buildViewNode: nodeOf,
}
