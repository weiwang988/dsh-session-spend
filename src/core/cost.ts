/**
 * Cost computation over folded records (pure).
 *
 * Price model: cache-read tokens at the hit rate, uncached input plus cache
 * write at the miss rate, output at the output rate — each at the rate of the
 * record's own billing instant (peak or valley). Unknown models are never
 * priced: they are reported through `unknownModelIds` and excluded from the
 * money figures.
 */

import type { StepRecord, StepRecordMap } from './fold.ts'
import { rateFor, type ModelRate, type PriceTable } from './price.ts'
import { classifyInstant, officialPeakWindow, type PeakWindowConfig } from './window.ts'

/** Per-model money share within one session (priced models only). */
export interface ModelCostShare {
  readonly model: string
  readonly totalCny: number
  readonly recordCount: number
}

/** Money figures for one session window, all in CNY. */
export interface CostSummary {
  /** Billed total (peak- and valley-priced traffic, priced models only). */
  readonly totalCny: number
  /** Portion billed at peak rate. */
  readonly peakCny: number
  /** Portion billed at valley rate. */
  readonly valleyCny: number
  /** Saving vs uncached pricing: cacheRead × (miss − hit), same window rate. */
  readonly cacheSavedCny: number
  /** Model ids present in the log but absent from the price table (not priced). */
  readonly unknownModelIds: readonly string[]
  /** Number of priced records folded. */
  readonly recordCount: number
  /**
   * Per-model share (model switching mid-session prices each record by its
   * own model). Sorted by totalCny descending for display.
   */
  readonly byModel: readonly ModelCostShare[]
}

/** Cost of one record at one rate. Billed input = uncached + cache reads + cache writes. */
export function tokensToCny(buckets: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}, rate: ModelRate): number {
  const cacheRead = buckets.cacheReadTokens ?? 0
  const cacheWrite = buckets.cacheWriteTokens ?? 0
  const uncached = buckets.inputTokens
  return (uncached + cacheWrite) * rate.cacheMiss / 1e6
    + cacheRead * rate.cacheHit / 1e6
    + buckets.outputTokens * rate.output / 1e6
}

/** Peak-vs-valley saving per record: cacheRead × (miss − hit) at the record's rate. */
export function cacheSavedCny(buckets: {
  readonly cacheReadTokens?: number
}, rate: ModelRate): number {
  return (buckets.cacheReadTokens ?? 0) * (rate.cacheMiss - rate.cacheHit) / 1e6
}

/** Summarize folded records into money figures. Unknown models are flagged, never guessed. */
export function computeCost(
  records: StepRecordMap | readonly StepRecord[],
  prices: PriceTable,
  windowConfig: PeakWindowConfig = officialPeakWindow,
): CostSummary {
  const iterable: Iterable<StepRecord> = Array.isArray(records) ? records : records.values()
  let totalCny = 0
  let peakCny = 0
  let valleyCny = 0
  let savedCny = 0
  let recordCount = 0
  const unknown = new Set<string>()
  const byModel = new Map<string, { totalCny: number; recordCount: number }>()
  for (const record of iterable) {
    const kind = classifyInstant(record.time, windowConfig)
    const rate = rateFor(record.model, kind, prices)
    if (rate === undefined) {
      if (record.model !== undefined) unknown.add(record.model)
      continue
    }
    const cost = tokensToCny(record.usage, rate)
    totalCny += cost
    peakCny += kind === 'peak' ? cost : 0
    valleyCny += kind === 'valley' ? cost : 0
    savedCny += cacheSavedCny(record.usage, rate)
    recordCount += 1
    if (record.model !== undefined) {
      const share = byModel.get(record.model) ?? { totalCny: 0, recordCount: 0 }
      byModel.set(record.model, { totalCny: share.totalCny + cost, recordCount: share.recordCount + 1 })
    }
  }
  return {
    totalCny,
    peakCny,
    valleyCny,
    cacheSavedCny: savedCny,
    unknownModelIds: [...unknown],
    recordCount,
    byModel: [...byModel]
      .map(([model, share]) => ({ model, ...share }))
      .sort((left, right) => right.totalCny - left.totalCny),
  }
}

/** Format a CNY amount: fixed 2 decimals, thousands separators (`¥1,234.56`). */
export function formatCny(value: number): string {
  return `¥${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
