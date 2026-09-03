import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  foldSample, foldSamples, parseRawLogLines, stepKey, type StepRecordMap, type UsageSample,
} from '../src/core/fold.ts'

const empty: StepRecordMap = new Map()

const sample = (over: Partial<UsageSample> & { turn: number; step: number }): UsageSample => ({
  time: 1_752_000_000_000,
  usage: { inputTokens: 100, outputTokens: 50 },
  ...over,
})

test('a usage-free sample is skipped', () => {
  const next = foldSample(empty, sample({ turn: 0, step: 1, usage: undefined }))
  assert.equal(next.size, 0)
  assert.equal(next, empty)
})

test('first sample inserts a record', () => {
  const next = foldSample(empty, sample({ turn: 0, step: 1 }))
  assert.equal(next.size, 1)
  assert.deepEqual(next.get(stepKey(0, 1)), {
    turn: 0, step: 1, time: sample({ turn: 0, step: 1 }).time, usage: { inputTokens: 100, outputTokens: 50 },
  })
})

test('usage chunk then finalized message for the same step: replace, never double count', () => {
  let records = foldSample(empty, sample({ turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 20 } }))
  assert.equal(records.size, 1)
  records = foldSample(records, sample({
    turn: 0, step: 0, time: 1_752_000_000_500, model: 'deepseek-v4-flash',
    usage: { inputTokens: 80, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 5 },
  }))
  assert.equal(records.size, 1)
  const record = records.get(stepKey(0, 0))
  assert.equal(record?.time, 1_752_000_000_500)
  assert.equal(record?.model, 'deepseek-v4-flash')
  assert.deepEqual(record?.usage, { inputTokens: 80, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 5 })
})

test('steps of different (turn, step) accumulate independently', () => {
  let records = foldSample(empty, sample({ turn: 0, step: 0 }))
  records = foldSample(records, sample({ turn: 0, step: 1 }))
  records = foldSample(records, sample({ turn: 1, step: 0 }))
  assert.equal(records.size, 3)
})

test('replay of the same sequence is idempotent', () => {
  const seq: UsageSample[] = [
    sample({ turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 20 } }),
    sample({ turn: 0, step: 0, usage: { inputTokens: 80, outputTokens: 30, cacheReadTokens: 10 } }),
    sample({ turn: 0, step: 1, usage: { inputTokens: 5, outputTokens: 5 } }),
  ]
  const once = foldSamples(seq)
  const twice = foldSamples(seq)
  assert.equal(once.size, 2)
  assert.deepEqual([...twice], [...once])
})

test('interrupted message with usage is counted (billing still applies)', () => {
  const records = foldSample(empty, sample({ turn: 0, step: 0, usage: { inputTokens: 7, outputTokens: 3 } }))
  assert.equal(records.size, 1)
})

// ── parseRawLogLines: the released-0.1.2 readRaw artifact form ─────────────

const header = JSON.stringify({ type: 'session', version: 2, id: 's1', createdAt: 1, delegationDepth: 0 })
const packedText = JSON.stringify({ type: 'text-chunks', seq0: 1, time0: 10, data: { turn: 0, step: 0, index: 0, texts: ['a', 'b', 'c'], dt: [1, 1] } })
const message = JSON.stringify({
  type: 'assistant/message', seq: 5, time: 50,
  data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'x', model: 'deepseek-v4-flash' } }, usage: { inputTokens: 10, outputTokens: 4 } },
})
const tornLine = '{ not json'

test('raw log parse skips header, packed chunk rows, and torn lines', () => {
  const events = parseRawLogLines([header, packedText, message, tornLine, ''].join('\n'))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'assistant/message')
  assert.equal(events[0]?.seq, 5)
  assert.equal(events[0]?.time, 50)
})

test('raw log parse keeps surface provenance fields without disturbing billing keys', () => {
  const surfaced = JSON.stringify({
    type: 'assistant/message', seq: 6, time: 60, surfaceOp: 'append', sourceEventSeqs: [1, 2],
    data: { turn: 1, step: 0, message: { source: { kind: 'model', provider: 'x', model: 'deepseek-v4-flash' } }, usage: { inputTokens: 1, outputTokens: 1 } },
  })
  const events = parseRawLogLines(surfaced)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.seq, 6)
})

test('raw log parse result folds identically to the decoded handle stream', () => {
  const chunk = JSON.stringify({
    type: 'assistant/chunk', seq: 3, time: 30,
    data: { turn: 0, step: 0, chunk: { type: 'usage', usage: { inputTokens: 9, outputTokens: 3 } } },
  })
  const text = [header, packedText, chunk, message].join('\n')
  const samples = parseRawLogLines(text).map(event => ({
    turn: (event.data as { turn: number }).turn,
    step: (event.data as { step: number }).step,
    time: event.time,
    ...event.type === 'assistant/message' ? { model: ((event.data as { message: { source?: { model?: string } } }).message.source?.model) } : {},
    usage: (event.data as { usage?: UsageBuckets }).usage,
  }))
  const records = foldSamples(samples)
  assert.equal(records.size, 1)
  assert.equal(records.get(stepKey(0, 0))?.time, 50)
})
