import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SessionCostViewBuilder, type CostReadout } from '../src/client/view-definition.ts'
import type { ConversationViewNode } from '../types/dsh-ui-conversation-client.d.ts'
import { officialPriceTable } from '../src/core/price.ts'
import { officialPeakWindow } from '../src/core/window.ts'
import type { UsageBuckets } from '../src/core/fold.ts'

// 2026-08-28 Friday; 06:00 UTC = 14:00 +08 → peak; 04:00 UTC = 12:00 +08 → valley.
const peakMs = Date.UTC(2026, 7, 28, 6)
const valleyMs = Date.UTC(2026, 7, 28, 4)

const stepNode = (
  key: string,
  state: {
    turn: number
    step: number
    samples?: readonly { seq: number; time: number; model?: string; usage: UsageBuckets }[]
    retries?: readonly number[]
  },
): ConversationViewNode => ({
  key,
  kind: 'session-cost',
  id: `session-cost|${key}`,
  target: 'cost',
  data: { role: 'step', turn: state.turn, step: state.step, samples: state.samples ?? [], retries: state.retries ?? [] },
})

const headerNode = (seq: number, model: string): ConversationViewNode => ({
  key: `session-cost|h:${seq}`,
  kind: 'session-cost',
  id: `session-cost|h:${seq}`,
  target: 'cost',
  data: { role: 'header', seq, model },
})

const usage = (over: Partial<UsageBuckets> = {}): UsageBuckets => ({
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  ...over,
})

const sample = (seq: number, time: number, over: { model?: string; usage?: UsageBuckets } = {}) => ({
  seq, time,
  ...over.model === undefined ? {} : { model: over.model },
  usage: over.usage ?? usage(),
})

const builder = (): SessionCostViewBuilder => new SessionCostViewBuilder(officialPriceTable, officialPeakWindow)

test('live sample then finalized message: message wins by seq (never double counted)', () => {
  const b = builder()
  const live: ConversationViewNode = stepNode('0:0:step', {
    turn: 0, step: 0,
    samples: [sample(10, peakMs, { usage: usage({ inputTokens: 900_000, outputTokens: 400_000 }) })],
  })
  const message: ConversationViewNode = stepNode('0:0:step', {
    turn: 0, step: 0,
    samples: [sample(25, peakMs, { model: 'deepseek-v4-flash', usage: usage({ inputTokens: 1_000_000, outputTokens: 500_000 }) })],
  })
  let readout: CostReadout = b.replace({ nodes: [live], timeline: {} as never })
  // A live usage sample carries no model id, so it is not priced (unknown).
  assert.equal(readout.recordCount, 0)
  readout = b.apply({ upserts: [message], timeline: {} as never })
  assert.equal(readout.recordCount, 1)
  assert.equal(readout.totalCny, 3.0 + 0.5 * 9.0)
  assert.equal(readout.peakCny, readout.totalCny)
})

test('retried attempt plus final message: both generations billed', () => {
  const b = builder()
  const readout = b.replace({
    nodes: [stepNode('0:0:step', {
      turn: 0, step: 0,
      retries: [15],
      samples: [
        // Failed attempt: sample before the retry-started marker (generation 0).
        sample(10, peakMs, { model: 'deepseek-v4-flash', usage: usage({ inputTokens: 1_000_000, outputTokens: 0 }) }),
        // Final settlement: sample after the marker (generation 1).
        sample(25, valleyMs, { model: 'deepseek-v4-flash', usage: usage({ inputTokens: 2_000_000, outputTokens: 0 }) }),
      ],
    })],
    timeline: {} as never,
  })
  // gen0: 1M at peak = 3.0; gen1: 2M at valley = 1.5 × 2 = 3.0; total 6.0.
  assert.equal(readout.totalCny, 6.0)
  assert.equal(readout.recordCount, 2)
  assert.equal(readout.peakCny, 3.0)
  assert.equal(readout.valleyCny, 3.0)
})

test('attempt without own model takes the nearest preceding header node', () => {
  const b = builder()
  const readout = b.replace({
    nodes: [
      headerNode(3, 'deepseek-v4-flash'),
      stepNode('0:0:step', {
        turn: 0, step: 0,
        samples: [sample(10, peakMs)],
      }),
    ],
    timeline: {} as never,
  })
  assert.equal(readout.totalCny, 3.0 + 0.5 * 9.0)
  assert.equal(readout.recordCount, 1)
  assert.deepEqual(readout.byModel, [{ model: 'deepseek-v4-flash', totalCny: readout.totalCny, recordCount: 1 }])
})

test('upsert carrying the accumulated state keeps the newest sample per generation', () => {
  // The per-step Context accumulates all of its matches, so an upsert always
  // carries the complete sample history; the fold must still price only the
  // newest sample of the generation (mirrors foldCostItems determinism).
  const b = builder()
  const readout = b.replace({
    nodes: [stepNode('0:0:step', {
      turn: 0, step: 0,
      samples: [
        sample(10, peakMs, { model: 'deepseek-v4-flash', usage: usage({ inputTokens: 900_000, outputTokens: 400_000 }) }),
        sample(25, peakMs, { model: 'deepseek-v4-flash' }),
      ],
    })],
    timeline: {} as never,
  })
  assert.equal(readout.totalCny, 3.0 + 0.5 * 9.0)
  assert.equal(readout.recordCount, 1)
})

test('mixed windows split peak/valley and report valley saving', () => {
  const b = builder()
  const readout = b.replace({
    nodes: [
      stepNode('0:0:step', { turn: 0, step: 0, samples: [sample(1, peakMs, { model: 'deepseek-v4-flash' })] }),
      stepNode('0:1:step', { turn: 0, step: 1, samples: [sample(2, valleyMs, { model: 'deepseek-v4-flash' })] }),
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
    nodes: [stepNode('0:0:step', {
      turn: 0, step: 0,
      samples: [sample(3, peakMs, { model: 'custom-model' })],
    })],
    timeline: {} as never,
  })
  assert.equal(readout.totalCny, 0)
  assert.deepEqual(readout.unknownModelIds, ['custom-model'])
  assert.equal(readout.recordCount, 0)
})

test('replace resets prior accumulation (window rebuild)', () => {
  const b = builder()
  b.replace({
    nodes: [stepNode('0:0:step', {
      turn: 0, step: 0,
      samples: [sample(1, peakMs, { model: 'deepseek-v4-flash' })],
    })],
    timeline: {} as never,
  })
  const readout = b.replace({ nodes: [], timeline: {} as never })
  assert.equal(readout.totalCny, 0)
  assert.equal(readout.recordCount, 0)
})

test('empty header model and empty step nodes contribute nothing', () => {
  const b = builder()
  const readout = b.replace({
    nodes: [
      headerNode(1, ''),
      stepNode('0:0:step', { turn: 0, step: 0 }),
      stepNode('0:1:step', { turn: 0, step: 1, retries: [9] }),
    ],
    timeline: {} as never,
  })
  assert.equal(readout.recordCount, 0)
  assert.equal(readout.totalCny, 0)
})
