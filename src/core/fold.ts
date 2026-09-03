/**
 * Event fold over provider usage samples (pure).
 *
 * Mirrors the token-meter last-wins rule
 * (packages/llm/token-meter/src/usage-projection.ts): a `usage` chunk is an
 * early sample for its (turn, step); the finalized `assistant/message`
 * replaces it — never double counts. Keys are (turn, step); replacements are
 * key-addressed so replay and paging stay deterministic.
 */

/** Provider-reported token accounting (disjoint buckets, see DSH TokenUsage). */
export interface UsageBuckets {
  /** Uncached input tokens only. */
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

/** One usage observation from the durable log, with its append time (epoch ms). */
export interface UsageSample {
  readonly turn: number
  readonly step: number
  /** Event append time — the billing instant used for peak/valley classification. */
  readonly time: number
  /** Provider model id (assistant/message carries it; a usage chunk sample may not). */
  readonly model?: string
  readonly usage?: UsageBuckets
}

/** One settled step's final measurable record. */
export interface StepRecord {
  readonly turn: number
  readonly step: number
  readonly time: number
  readonly model?: string
  readonly usage: UsageBuckets
}

export function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

/** Immutable record set keyed by step identity (map identity changes on every fold). */
export type StepRecordMap = ReadonlyMap<string, StepRecord>

/**
 * Fold one sample into the record set.
 * @returns the updated map: inserts a new (turn, step), or replaces the
 * existing record in place (usage chunk → finalized message correction).
 */
export function foldSample(records: StepRecordMap, sample: UsageSample): StepRecordMap {
  if (sample.usage === undefined) return records
  const key = stepKey(sample.turn, sample.step)
  const next = new Map(records)
  next.set(key, {
    turn: sample.turn,
    step: sample.step,
    time: sample.time,
    usage: sample.usage,
    ...(sample.model === undefined ? {} : { model: sample.model }),
  })
  return next
}

/** Fold an ordered sample sequence; usage-free samples are skipped. */
export function foldSamples(samples: Iterable<UsageSample>): StepRecordMap {
  let records: StepRecordMap = new Map()
  for (const sample of samples) records = foldSample(records, sample)
  return records
}

/** One durable log event as decoded by the persistence read handle. */
export interface LogEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/**
 * Parse raw JSONL log text (the released-0.1.2 `readRaw` artifact form) into
 * logical events. One physical line per record; the first line is the
 * format header (`type: "session"`), and delta-chunk runs may be packed into
 * `text-chunks` / `reasoning-chunks` / `tool-call-chunks` rows (bare,
 * slash-less tags) which carry no usage and are never billed. Malformed
 * lines are skipped; the caller's last-wins fold keeps billing identical to
 * the decoded handle path.
 */
export function parseRawLogLines(text: string): readonly LogEventLike[] {
  const events: LogEventLike[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const record = parsed as { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }
    if (typeof record.type !== 'string') continue
    if (record.type === 'session'
      || record.type === 'text-chunks'
      || record.type === 'reasoning-chunks'
      || record.type === 'tool-call-chunks') continue
    if (typeof record.seq !== 'number' || typeof record.time !== 'number') continue
    events.push({ type: record.type, seq: record.seq, time: record.time, data: record.data })
  }
  return events
}
