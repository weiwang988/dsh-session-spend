/**
 * Session-cost Node Definition: one single-event Context per usage-carrying
 * log record (0.1.2 conversations contract).
 *
 * Why single-event Contexts: the engine forbids two starts for one id, treats
 * an `update` without state as a no-op, and gives match() no state access —
 * so a multi-event context cannot decide chunk→message replacement by itself.
 * Chunk sample and finalized message become two Contexts (chunk id vs message
 * id); the cost view builder folds them with a (turn, step) last-wins rule.
 */

import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConversationNodeContext, ConversationNodeDefinition, ConversationStartMatch,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UsageBuckets } from '../core/fold.ts'

/** One priced step record carried by a Context's Node. */
export interface CostNodeData {
  /** Source event seq — ordering authority for chunk→message replacement. */
  readonly seq: number
  readonly turn: number
  readonly step: number
  /** Append time of the carried event (the billing instant). */
  readonly time: number
  readonly model: string | undefined
  readonly usage: UsageBuckets
}

/** Branded context id tag so a chunk and its message never collide. */
const chunkTag = (turn: number, step: number): string => `${turn}:${step}:chunk`
const messageTag = (turn: number, step: number): string => `${turn}:${step}:msg`

/** Model id from an assistant message (message.source.model). */
function modelOf(message: { source: { model?: unknown; kind?: unknown } }): string | undefined {
  const model = message.source.model
  return typeof model === 'string' && model !== '' ? model : undefined
}

function nodeOf(context: ConversationNodeContext<CostNodeData>): ConversationViewNode | null {
  if (context.state === undefined) return null
  return {
    // context.key is the engine-owned context key (kind-length-prefixed id).
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: 'cost',
    data: context.state,
  }
}

const singleEventUpdate =
  (context: ConversationNodeContext<CostNodeData> & { readonly state: CostNodeData }): CostNodeData => context.state

/** Event → single-event Context state machine over usage-carrying events. */
export const sessionCostDefinition: ConversationNodeDefinition<CostNodeData> = {
  kind: 'session-cost',
  target: 'cost',

  match(event: SessionEventLike): { id: string; role: 'start' | 'update' } | null {
    if (event.type === 'assistant/chunk') {
      const data = event.data as { turn: number; step: number; chunk?: { type?: string } }
      if (data?.chunk?.type === 'usage') {
        return { id: chunkTag(data.turn, data.step), role: 'start' }
      }
      return null
    }
    if (event.type === 'assistant/message') {
      const data = event.data as { turn: number; step: number; usage?: unknown }
      if (data?.usage !== undefined) {
        return { id: messageTag(data.turn, data.step), role: 'start' }
      }
      return null
    }
    return null
  },

  start(context: ConversationNodeContext<CostNodeData>, match: ConversationStartMatch): CostNodeData {
    const event = match.event
    if (event.type === 'assistant/message') {
      const data = event.data as {
        turn: number
        step: number
        message: { source: { model?: unknown; kind?: unknown } }
        usage: UsageBuckets
      }
      return {
        seq: event.seq,
        turn: data.turn,
        step: data.step,
        time: event.time,
        model: modelOf(data.message),
        usage: data.usage,
      }
    }
    const data = event.data as { turn: number; step: number; chunk: { usage: UsageBuckets } }
    return {
      seq: event.seq,
      turn: data.turn,
      step: data.step,
      time: event.time,
      model: undefined,
      usage: data.chunk.usage,
    }
  },

  update: singleEventUpdate,
  buildViewNode: nodeOf,
}
