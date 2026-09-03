import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SessionCostViewBuilder, type CostReadout } from '../src/client/view-definition.ts'
import type { ConversationViewNode } from '../types/dsh-ui-conversation-client.d.ts'
import type { CostNodeData } from '../src/client/definition.ts'
import { officialPriceTable } from '../src/core/price.ts'
import { officialPeakWindow } from '../src/core/window.ts'

// 2026-08-28 Friday; 06:00 UTC = 14:00 +08 → peak; 04:00 UTC = 12:00 +08 → valley.
const peakMs = Date.UTC(2026, 7, 28, 6)
const valleyMs = Date.UTC(2026, 7, 28, 4)

const node = (data: CostNodeData): ConversationViewNode => ({
  key: `session-cost|${data.turn}:${data.step}:${data.seq}`,
  kind: 'session-cost',
  id: `${data.turn}:${data.step}:${data.seq}`,
  target: 'cost',
  data,
})

const usage = (over: Partial<CostNodeData['usage']>): CostNodeData['usage'] => ({
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  ...over,
})

const builder = (): SessionCostViewBuilder => new SessionCostViewBuilder(officialPriceTable, officialPeakWindow)

test('chunk sample then finalized message: message wins by seq (never double counted)', () => {
  const b = builder()
  const chunk: ConversationViewNode = node({
    seq: 10, turn: 0, step: 0, time: peakMs, model: undefined,
    usage: usage({ inputTokens: 900_000, outputTokens: 400_000 }),
  })
  const message: ConversationViewNode = node({
    seq: 25, turn: 0, step: 0, time: peakMs, model: 'deepseek-v4-flash',
    usage: usage({ inputTokens: 1_000_000, outputTokens: 500_000 }),
  })
  let readout: CostReadout = b.replace({ nodes: [chunk], timeline: {} as never })
  // A usage-chunk sample carries no model id, so it is not priced (unknown).
  assert.equal(readout.recordCount, 0)
  readout = b.apply({ upserts: [message], timeline: {} as never })
  assert.equal(readout.recordCount, 1)
  assert.equal(readout.totalCny, 3.0 + 0.5 * 9.0)
  assert.equal(readout.peakCny, readout.totalCny)
})

test('older seq arriving later is ignored (replay order safety)', () => {
  const b = builder()
  b.replace({
    nodes: [node({ seq: 25, turn: 0, step: 0, time: peakMs, model: 'deepseek-v4-flash', usage: usage() })],
    timeline: {} as never,
  })
  const readout = b.apply({
    upserts: [node({ seq: 10, turn: 0, step: 0, time: peakMs, model: 'deepseek-v4-flash', usage: usage({ inputTokens: 10 }) })],
    timeline: {} as never,
  })
  assert.equal(readout.totalCny, 3.0 + 0.5 * 9.0)
})

test('mixed windows split peak/valley and report valley saving', () => {
  const b = builder()
  const readout = b.replace({
    nodes: [
      node({ seq: 1, turn: 0, step: 0, time: peakMs, model: 'deepseek-v4-flash', usage: usage() }),
      node({ seq: 2, turn: 0, step: 1, time: valleyMs, model: 'deepseek-v4-flash', usage: usage() }),
    ],
    timeline: {} as never,
  })
  // peak: 1M×3 + 500K×9 = 7.5; valley half = 3.75; total 11.25; valleySaved = 3.75.
  assert.equal(readout.peakCny, 7.5)
  assert.equal(readout.valleyCny, 3.75)
  assert.equal(readout.totalCny, 11.25)
  assert.equal(readout.valleySavedCny, 3.75)
})

test('unknown model flagged and excluded from money', () => {
  const b = builder()
  const readout = b.replace({
    nodes: [node({ seq: 3, turn: 0, step: 0, time: peakMs, model: 'custom-model', usage: usage() })],
    timeline: {} as never,
  })
  assert.equal(readout.totalCny, 0)
  assert.deepEqual(readout.unknownModelIds, ['custom-model'])
  assert.equal(readout.recordCount, 0)
})

test('replace resets prior accumulation (window rebuild)', () => {
  const b = builder()
  b.replace({ nodes: [node({ seq: 1, turn: 0, step: 0, time: peakMs, model: 'deepseek-v4-flash', usage: usage() })], timeline: {} as never })
  const readout = b.replace({ nodes: [], timeline: {} as never })
  assert.equal(readout.totalCny, 0)
  assert.equal(readout.recordCount, 0)
})
