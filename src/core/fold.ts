/**
 * Event fold over provider usage samples, 0.1.5 (format v3) vocabulary (pure).
 *
 * Mirrors the official token-meter rule
 * (packages/llm/token-meter/src/usage-projection.ts on the 0.1.5 line):
 *  - a durable Assistant settlement — `assistant/attempt` or
 *    `assistant/message` — contributes the LAST usage sample embedded in its
 *    stream (`data.usage` wins when present, else the stream's final
 *    `usage` chunk);
 *  - samples are slot-addressed per (turn, step, generation);
 *    `llm/retry-started` opens a NEW generation for that step, so a retried
 *    attempt ADDS to the total instead of replacing the failed attempt's
 *    sample (the provider billed both requests);
 *  - model attribution: settlements carry no model for attempts; the model
 *    of the nearest preceding `request/header` (its `config.model`) applies —
 *    DSH re-logs the header only when it changes, so the latest preceding
 *    header IS the routed model of the request;
 *  - records are priced at their own settlement instant (event append time).
 *
 * The same fold serves the host full-log path and the client view fold; both
 * only differ in how their event/Node stream is projected into {@link CostItem}.
 */

/** Provider-reported token accounting (disjoint buckets, see DSH TokenUsage). */
export interface UsageBuckets {
  /** Uncached input tokens only. */
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

/** One settled slot's final measurable record. */
export interface StepRecord {
  readonly turn: number
  readonly step: number
  readonly time: number
  readonly model?: string
  readonly usage: UsageBuckets
}

/** Immutable record set keyed by slot identity (map identity changes on every fold). */
export type StepRecordMap = ReadonlyMap<string, StepRecord>

/** One durable log event as decoded by the persistence read handle. */
export interface LogEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Structural shape of a provider `usage` object (`TokenUsage` field names). */
interface TokenUsageLike {
  readonly inputTokens?: unknown
  readonly outputTokens?: unknown
  readonly cacheReadTokens?: unknown
  readonly cacheWriteTokens?: unknown
}

/** Normalize one provider usage object to billing buckets; malformed values are discarded. */
function toBuckets(raw: unknown): UsageBuckets | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const usage = raw as TokenUsageLike
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return undefined
  const cacheRead = cacheReadTokens
  const cacheWrite = cacheWriteTokens
  if (cacheRead !== undefined && (typeof cacheRead !== 'number' || !Number.isFinite(cacheRead))) return undefined
  if (cacheWrite !== undefined && (typeof cacheWrite !== 'number' || !Number.isFinite(cacheWrite))) return undefined
  return {
    inputTokens,
    outputTokens,
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite },
  }
}

/**
 * Usage contributed by one v2 Assistant settlement event payload
 * (`assistant/attempt` or `assistant/message` data): `usage` wins when the
 * adapter reported it; otherwise the LAST `usage` chunk embedded in the
 * compact stream (usage chunks are plain `{type:'chunk', chunk}` records —
 * packed text/reasoning/tool-call runs never carry usage).
 */
export function usageFromSettlement(data: unknown): UsageBuckets | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as { readonly usage?: unknown; readonly stream?: unknown }
  const direct = toBuckets(record.usage)
  if (direct !== undefined) return direct
  if (!Array.isArray(record.stream)) return undefined
  for (let index = record.stream.length - 1; index >= 0; index--) {
    const member = record.stream[index] as
      | { readonly type?: unknown; readonly chunk?: { readonly type?: unknown; readonly usage?: unknown } }
      | undefined
    if (member?.type === 'chunk' && member.chunk?.type === 'usage') {
      const sample = toBuckets(member.chunk.usage)
      if (sample !== undefined) return sample
    }
  }
  return undefined
}

/** Usage carried by one client-only `assistant/live-chunk` presentation frame. */
export function usageFromLiveChunk(data: unknown): UsageBuckets | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const chunk = (data as { readonly chunk?: { readonly type?: unknown; readonly usage?: unknown } }).chunk
  return chunk?.type === 'usage' ? toBuckets(chunk.usage) : undefined
}

/** One seq-ordered fold input. */
export type CostItem =
  | {
    readonly kind: 'record'
    readonly seq: number
    readonly turn: number
    readonly step: number
    readonly time: number
    readonly model?: string
    readonly usage: UsageBuckets
  }
  | { readonly kind: 'retry'; readonly seq: number; readonly turn: number; readonly step: number }
  | { readonly kind: 'header'; readonly seq: number; readonly model: string }

export function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

/**
 * Fold seq-ordered items into the billed record set.
 *
 * Per (turn, step) the fold keeps the LAST sample of each generation; a
 * `retry` item opens a new generation. Every kept record is attributed to the
 * nearest preceding `header` model unless the record carries its own.
 */
export function foldCostItems(items: readonly CostItem[]): StepRecord[] {
  const ordered = [...items].sort((left, right) => left.seq - right.seq)
  const slots = new Map<string, StepRecord>()
  const generations = new Map<string, number>()
  let headerModel: string | undefined
  for (const item of ordered) {
    if (item.kind === 'header') {
      headerModel = item.model
      continue
    }
    if (item.kind === 'retry') {
      const key = stepKey(item.turn, item.step)
      generations.set(key, (generations.get(key) ?? 0) + 1)
      continue
    }
    const key = `${stepKey(item.turn, item.step)}.${generations.get(stepKey(item.turn, item.step)) ?? 0}`
    slots.set(key, {
      turn: item.turn,
      step: item.step,
      time: item.time,
      ...item.model === undefined && headerModel === undefined ? {} : { model: item.model ?? headerModel },
      usage: item.usage,
    })
  }
  return [...slots.values()].sort((left, right) => left.time - right.time)
}

/**
 * Project one v2 durable event into {@link CostItem}s: settlements and retry
 * markers contribute records, `request/header` contributes the model item.
 * Usage-free events (streams without a usage chunk, header-less requests)
 * contribute nothing.
 */
export function logItemsOf(events: readonly LogEventLike[]): CostItem[] {
  const items: CostItem[] = []
  for (const event of events) {
    if (event.type === 'request/header') {
      const data = event.data as { header?: { config?: { model?: unknown } } } | undefined
      const model = data?.header?.config?.model
      if (typeof model === 'string' && model !== '') items.push({ kind: 'header', seq: event.seq, model })
      continue
    }
    if (event.type === 'llm/retry-started') {
      const data = event.data as { turn?: unknown; step?: unknown } | undefined
      if (typeof data?.turn === 'number' && typeof data.step === 'number') {
        items.push({ kind: 'retry', seq: event.seq, turn: data.turn, step: data.step })
      }
      continue
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    const data = event.data as {
      turn?: unknown
      step?: unknown
      message?: { source?: { model?: unknown } }
    } | undefined
    if (typeof data?.turn !== 'number' || typeof data.step !== 'number') continue
    const usage = usageFromSettlement(event.data)
    if (usage === undefined) continue
    const modelSource = data.message?.source?.model
    items.push({
      kind: 'record',
      seq: event.seq,
      turn: data.turn,
      step: data.step,
      time: event.time,
      ...typeof modelSource === 'string' && modelSource !== '' ? { model: modelSource } : {},
      usage,
    })
  }
  return items
}
