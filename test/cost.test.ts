import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCost, formatCny, tokensToCny } from '../src/core/cost.ts'
import { foldCostItems, type CostItem, type StepRecord } from '../src/core/fold.ts'
import { officialPriceTable } from '../src/core/price.ts'

// 2026-08-28 (Friday) UTC+8 wall-clock helpers: 06:00 valley, 10:00 peak.
const at = (day: number, hour: number): number => Date.UTC(2026, 7, day, hour - 8)

interface Sample {
  turn: number
  step: number
  time: number
  model?: string
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
}

/** Lift plain samples into seq-ordered record items (test convenience). */
const records = (samples: readonly Sample[]): StepRecord[] => foldCostItems(
  samples.map((sample, index) => ({
    kind: 'record' as const,
    seq: index,
    ...sample,
  })),
)

/** Plain record items with explicit seqs for fold-level tests. */
const record = (seq: number, sample: Sample): CostItem => ({ kind: 'record', seq, ...sample })

test('per-record cost math: flash peak (deepseek-flash = V4.1-Flash)', () => {
  // 1,000,000 uncached input + 1,000,000 output at flash peak (0.04/2.0/8.0).
  const cost = tokensToCny({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, officialPriceTable['deepseek-flash'].peak)
  assert.equal(cost, 2.0 + 8.0)
})

test('per-record cost math: cache read at hit rate, write at miss rate', () => {
  const cost = tokensToCny(
    { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
    officialPriceTable['deepseek-flash'].valley,
  )
  // 2M at miss 1.0 + 1M at hit 0.02.
  assert.equal(cost, 2.0 + 0.02)
})

test('legacy flash names are billed at V4.1-Flash rates (official footnote)', () => {
  const legacy = tokensToCny({ inputTokens: 1_000_000, outputTokens: 0 }, officialPriceTable['deepseek-v4-flash'].peak)
  const vision = tokensToCny({ inputTokens: 1_000_000, outputTokens: 0 }, officialPriceTable['deepseek-v4-flash-vision-exp'].peak)
  const current = tokensToCny({ inputTokens: 1_000_000, outputTokens: 0 }, officialPriceTable['deepseek-flash'].peak)
  assert.equal(legacy, 2.0)
  assert.equal(vision, 2.0)
  assert.equal(legacy, current)
})

test('regression: user real session numbers (billed input 63.3K, hit 77%, output 7.2K)', () => {
  // Billed input 63,300 = cacheRead 48,741 + uncached/write 14,559 (77% hit).
  const cacheRead = Math.round(63_300 * 0.77) // 48,741
  const uncached = 63_300 - cacheRead
  const summary = computeCost(records([{
    turn: 0, step: 0,
    time: at(28, 10), // Friday 10:00 → peak
    model: 'deepseek-flash',
    usage: { inputTokens: uncached, outputTokens: 7_200, cacheReadTokens: cacheRead },
  }]), officialPriceTable)
  // cacheRead 48,741 × 0.04/1M + uncached 14,559 × 2.0/1M + 7,200 × 8.0/1M
  const expected = 48_741 * 0.04 / 1e6 + 14_559 * 2.0 / 1e6 + 7_200 * 8.0 / 1e6
  assert.ok(Math.abs(summary.totalCny - expected) < 1e-9)
  assert.equal(summary.peakCny, summary.totalCny)
  assert.equal(summary.valleyCny, 0)
  // Cache saving: cacheRead × (miss − hit) at peak = 48,741 × (2.0 − 0.04)/1M.
  assert.ok(Math.abs(summary.cacheSavedCny - 48_741 * 1.96 / 1e6) < 1e-9)
  assert.equal(summary.unknownModelIds.length, 0)
  assert.equal(summary.recordCount, 1)
  assert.equal(formatCny(summary.totalCny), '¥0.09')
})

test('same traffic at valley costs exactly half (official rule valley = peak × 0.5)', () => {
  const peak = records([{
    turn: 0, step: 0, time: at(28, 10), model: 'deepseek-flash',
    usage: { inputTokens: 60_000, outputTokens: 30_000, cacheReadTokens: 10_000 },
  }])
  const valley = records([{
    turn: 0, step: 0, time: at(28, 12), model: 'deepseek-flash',
    usage: { inputTokens: 60_000, outputTokens: 30_000, cacheReadTokens: 10_000 },
  }])
  const peakSummary = computeCost(peak, officialPriceTable)
  const valleySummary = computeCost(valley, officialPriceTable)
  assert.ok(Math.abs(valleySummary.totalCny - peakSummary.totalCny / 2) < 1e-9)
  assert.equal(valleySummary.peakCny, 0)
})

test('unknown model is flagged, never priced', () => {
  const summary = computeCost(records([{
    turn: 0, step: 0, time: at(28, 10), model: 'some-other-model',
    usage: { inputTokens: 1000, outputTokens: 1000 },
  }]), officialPriceTable)
  assert.equal(summary.totalCny, 0)
  assert.deepEqual(summary.unknownModelIds, ['some-other-model'])
  assert.equal(summary.recordCount, 0)
})

test('records without a model id are skipped as unknown too', () => {
  const summary = computeCost(records([{ turn: 0, step: 0, time: at(28, 10), usage: { inputTokens: 1, outputTokens: 1 } }]), officialPriceTable)
  assert.equal(summary.totalCny, 0)
  assert.equal(summary.unknownModelIds.length, 0)
  assert.equal(summary.recordCount, 0)
})

test('mixed peak and valley split the totals', () => {
  const summary = computeCost(records([
    { turn: 0, step: 0, time: at(28, 10), model: 'deepseek-flash', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    { turn: 0, step: 1, time: at(28, 12), model: 'deepseek-flash', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  ]), officialPriceTable)
  assert.equal(summary.totalCny, 2.0 + 1.0)
  assert.equal(summary.peakCny, 2.0)
  assert.equal(summary.valleyCny, 1.0)
})

test('formatCny: thousands separators and fixed two decimals', () => {
  assert.equal(formatCny(0.11), '¥0.11')
  assert.equal(formatCny(1234.5), '¥1,234.50')
  assert.equal(formatCny(0), '¥0.00')
})

test('custom price table overrides official defaults', () => {
  const custom = {
    'deepseek-flash': {
      peak: { cacheHit: 1, cacheMiss: 2, output: 3 },
      valley: { cacheHit: 0.5, cacheMiss: 1, output: 1.5 },
    },
  }
  const summary = computeCost(records([{
    turn: 0, step: 0, time: at(28, 10), model: 'deepseek-flash',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
  }]), custom)
  assert.equal(summary.totalCny, 2)
})

test('model switch mid-session: each record priced by its own model, with per-model share', () => {
  const summary = computeCost(records([
    { turn: 0, step: 0, time: at(28, 10), model: 'deepseek-flash', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    { turn: 0, step: 1, time: at(28, 10), model: 'deepseek-v4-pro', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  ]), officialPriceTable)
  // flash 1M input at miss 2.0 + pro 1M input at miss 9.0 — never a shared rate.
  assert.equal(summary.totalCny, 2.0 + 9.0)
  assert.equal(summary.recordCount, 2)
  assert.deepEqual(summary.byModel, [
    { model: 'deepseek-v4-pro', totalCny: 9.0, recordCount: 1 },
    { model: 'deepseek-flash', totalCny: 2.0, recordCount: 1 },
  ])
})

test('per-model share folds repeated records of the same model', () => {
  const summary = computeCost(records([
    { turn: 0, step: 0, time: at(28, 10), model: 'deepseek-flash', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    { turn: 0, step: 1, time: at(28, 10), model: 'deepseek-flash', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  ]), officialPriceTable)
  assert.equal(summary.byModel.length, 1)
  assert.deepEqual(summary.byModel[0], { model: 'deepseek-flash', totalCny: 4.0, recordCount: 2 })
})

// ── fold-level: retry billing and header attribution price correctly ────────

test('retried attempt and final message are both billed at their own instants', () => {
  const summary = computeCost(foldCostItems([
    { kind: 'header', seq: 5, model: 'deepseek-flash' },
    record(10, { turn: 0, step: 0, time: at(28, 10), usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
    { kind: 'retry', seq: 15, turn: 0, step: 0 },
    record(30, {
      turn: 0, step: 0, time: at(28, 11), model: 'deepseek-flash',
      usage: { inputTokens: 2_000_000, outputTokens: 0 },
    }),
  ]), officialPriceTable)
  // Failed attempt 1M (peak, flash via header) + final message 2M (peak): 2.0 + 4.0.
  assert.equal(summary.totalCny, 6.0)
  assert.equal(summary.recordCount, 2)
})

test('attempt without own model takes the routed header model', () => {
  const summary = computeCost(foldCostItems([
    { kind: 'header', seq: 1, model: 'deepseek-flash' },
    record(10, { turn: 0, step: 0, time: at(28, 10), usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
  ]), officialPriceTable)
  assert.equal(summary.totalCny, 2.0)
  assert.equal(summary.recordCount, 1)
  assert.deepEqual(summary.byModel, [{ model: 'deepseek-flash', totalCny: 2.0, recordCount: 1 }])
})
