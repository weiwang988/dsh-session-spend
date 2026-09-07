import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  foldCostItems, logItemsOf, usageFromLiveChunk, usageFromSettlement, type CostItem,
} from '../src/core/fold.ts'

// ── usageFromSettlement: v2 Assistant settlement payloads ──────────────────

const usage = (over: Record<string, number> = {}): { inputTokens: number; outputTokens: number; [key: string]: number } => ({
  inputTokens: 100,
  outputTokens: 50,
  ...over,
})

const streamChunk = (inner: unknown): unknown => ({ type: 'chunk', time: 10, chunk: inner })
const packedText = (): unknown => ({ type: 'text-chunks', time0: 5, index: 0, dt: [1], texts: ['a'] })
const usageChunk = (over: Record<string, number> = {}): unknown => ({ type: 'usage', usage: usage(over) })

test('settlement usage: direct usage wins', () => {
  const sample = usageFromSettlement({ turn: 0, step: 0, usage: usage({ inputTokens: 7, outputTokens: 3 }) })
  assert.deepEqual(sample, { inputTokens: 7, outputTokens: 3 })
})

test('settlement usage: message without usage falls back to the embedded stream', () => {
  const sample = usageFromSettlement({
    turn: 0, step: 0,
    message: { source: { kind: 'model', provider: 'x', model: 'deepseek-v4-flash' } },
    stream: [packedText(), streamChunk(usageChunk({ inputTokens: 9, outputTokens: 4 }))],
  })
  assert.deepEqual(sample, { inputTokens: 9, outputTokens: 4 })
})

test('settlement usage: stream scan picks the LAST usage chunk (reverse scan)', () => {
  const sample = usageFromSettlement({
    turn: 0, step: 0,
    stream: [
      streamChunk(usageChunk({ inputTokens: 1, outputTokens: 1 })),
      packedText(),
      streamChunk(usageChunk({ inputTokens: 99, outputTokens: 44 })),
    ],
  })
  assert.deepEqual(sample, { inputTokens: 99, outputTokens: 44 })
})

test('settlement usage: usage-less stream and malformed values are discarded', () => {
  assert.equal(usageFromSettlement({ turn: 0, step: 0, stream: [packedText()] }), undefined)
  assert.equal(usageFromSettlement({ usage: { inputTokens: 1 } }), undefined)
  assert.equal(usageFromSettlement({ usage: { inputTokens: '1', outputTokens: 1 } }), undefined)
  assert.equal(usageFromSettlement(null), undefined)
})

test('settlement usage: cache buckets ride through', () => {
  const sample = usageFromSettlement({
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1 },
  })
  assert.deepEqual(sample, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1 })
})

test('live chunk usage: only a usage chunk counts', () => {
  assert.deepEqual(
    usageFromLiveChunk({ attemptId: 'a1', turn: 0, step: 0, chunk: usageChunk({ inputTokens: 8, outputTokens: 2 }) }),
    { inputTokens: 8, outputTokens: 2 },
  )
  assert.equal(usageFromLiveChunk({ attemptId: 'a1', turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'y' } }), undefined)
})

// ── foldCostItems: slot semantics + attribution ────────────────────────────

const record = (seq: number, over: Partial<Extract<CostItem, { kind: 'record' }>> & { turn: number; step: number }): CostItem => ({
  kind: 'record', seq, time: 1_752_000_000_000, usage: usage(), ...over,
})
const retry = (seq: number, turn: number, step: number): CostItem => ({ kind: 'retry', seq, turn, step })
const header = (seq: number, model: string): CostItem => ({ kind: 'header', seq, model })

test('single sample folds to one record with its own model', () => {
  const records = foldCostItems([record(1, { turn: 0, step: 0, model: 'deepseek-v4-flash' })])
  assert.equal(records.length, 1)
  assert.equal(records[0]?.model, 'deepseek-v4-flash')
  assert.deepEqual(records[0]?.usage, usage())
})

test('live sample then settled message for the same step: newer sample wins (no double count)', () => {
  const records = foldCostItems([
    record(10, { turn: 0, step: 0, time: 1_752_000_000_100, usage: usage({ inputTokens: 90, outputTokens: 40 }) }),
    record(25, { turn: 0, step: 0, time: 1_752_000_000_500, model: 'deepseek-v4-flash', usage: usage({ inputTokens: 100, outputTokens: 50 }) }),
  ])
  assert.equal(records.length, 1)
  assert.equal(records[0]?.time, 1_752_000_000_500)
  assert.equal(records[0]?.model, 'deepseek-v4-flash')
  assert.deepEqual(records[0]?.usage, { inputTokens: 100, outputTokens: 50 })
})

test('failed attempt then retry-started then final message: BOTH attempts are billed', () => {
  const records = foldCostItems([
    record(10, { turn: 0, step: 0, usage: usage({ inputTokens: 100, outputTokens: 20 }) }),
    retry(15, 0, 0),
    record(30, { turn: 0, step: 0, time: 1_752_000_000_900, model: 'deepseek-v4-flash', usage: usage({ inputTokens: 200, outputTokens: 40 }) }),
  ])
  assert.equal(records.length, 2)
  assert.equal(records[0]?.time, 1_752_000_000_000)
  assert.equal(records[1]?.time, 1_752_000_000_900)
})

test('model attribution: record without a model takes the nearest preceding header', () => {
  const records = foldCostItems([
    record(1, { turn: 0, step: 0, model: 'deepseek-v4-flash' }),
    header(5, 'deepseek-v4-pro'),
    record(9, { turn: 0, step: 1 }),
  ])
  assert.equal(records[0]?.model, 'deepseek-v4-flash')
  assert.equal(records[1]?.model, 'deepseek-v4-pro')
})

test('model attribution: header is per-record (a later change does not repaint earlier records)', () => {
  const records = foldCostItems([
    header(2, 'deepseek-v4-flash'),
    record(4, { turn: 0, step: 0 }),
    header(6, 'deepseek-v4-pro'),
    record(8, { turn: 0, step: 1 }),
  ])
  assert.deepEqual(records.map(entry => entry.model), ['deepseek-v4-flash', 'deepseek-v4-pro'])
})

test('no header and no own model: record carries no model (never guessed)', () => {
  const records = foldCostItems([record(1, { turn: 0, step: 0 })])
  assert.equal(records[0]?.model, undefined)
})

test('retry marker without samples folds nothing', () => {
  const records = foldCostItems([retry(1, 0, 0)])
  assert.equal(records.length, 0)
})

test('steps and turns accumulate independently', () => {
  const records = foldCostItems([
    record(1, { turn: 0, step: 0 }),
    record(2, { turn: 0, step: 1 }),
    record(3, { turn: 1, step: 0 }),
  ])
  assert.equal(records.length, 3)
})

test('out-of-order input is folded deterministically by seq', () => {
  const one = foldCostItems([
    record(25, { turn: 0, step: 0, model: 'deepseek-v4-flash' }),
    record(10, { turn: 0, step: 0, model: 'deepseek-v4-flash', usage: usage({ inputTokens: 10, outputTokens: 10 }) }),
  ])
  const two = foldCostItems([
    record(10, { turn: 0, step: 0, model: 'deepseek-v4-flash', usage: usage({ inputTokens: 10, outputTokens: 10 }) }),
    record(25, { turn: 0, step: 0, model: 'deepseek-v4-flash' }),
  ])
  assert.deepEqual(one, two)
  assert.equal(one.length, 1)
  assert.deepEqual(one[0]?.usage, usage())
})

// ── logItemsOf: durable v2 event projection ────────────────────────────────

const event = (type: string, seq: number, time: number, data: unknown) => ({ type, seq, time, data })

test('log projection: message (usage + stream), attempt (stream), header, retry', () => {
  const items = logItemsOf([
    event('turn/start', 1, 1, { turn: 0 }),
    event('step/start', 2, 2, { turn: 0, step: 0 }),
    event('request/header', 3, 3, { header: { config: { provider: 'x', model: 'deepseek-v4-flash' } }, reason: 'initial' }),
    event('request/context', 4, 4, { provider: 'x', model: 'deepseek-v4-flash' }),
    event('assistant/message', 5, 5, {
      turn: 0, step: 0,
      message: { source: { kind: 'model', provider: 'x', model: 'deepseek-v4-flash' } },
      stream: [streamChunk(usageChunk({ inputTokens: 100, outputTokens: 50 }))],
      usage: usage({ inputTokens: 100, outputTokens: 50 }),
    }),
    event('llm/retry-started', 6, 6, { turn: 0, step: 0 }),
    event('assistant/message', 7, 7, { turn: 0, step: 0, message: { source: { model: 'deepseek-v4-flash' } } }),
    event('assistant/attempt', 8, 8, { turn: 0, step: 0, stream: [streamChunk(usageChunk({ inputTokens: 5, outputTokens: 1 }))] }),
    event('tool/call', 9, 9, { turn: 0, step: 0 }),
  ])
  const kinds = items.map(item => item.kind)
  assert.deepEqual(kinds, ['header', 'record', 'retry', 'record'])
  assert.equal(items[1]?.kind === 'record' && items[1].model, 'deepseek-v4-flash')
  // Message with no direct usage still contributes through its stream.
  assert.equal(items[2]?.kind === 'retry' && items[2].seq, 6)
  assert.equal(items[3]?.kind === 'record' && items[3].usage.inputTokens, 5)
})

test('log projection: headers require a non-empty model; usage-less settlements are skipped', () => {
  const items = logItemsOf([
    event('request/header', 1, 1, { header: { config: { provider: 'x' } }, reason: 'initial' }),
    event('assistant/attempt', 2, 2, { turn: 0, step: 0, stream: [packedText()] }),
    event('assistant/message', 3, 3, { turn: 0, step: 0, message: { source: { model: '' } } }),
  ])
  assert.equal(items.length, 0)
})

test('log projection: full-log fold yields the billed record set', () => {
  const records = foldCostItems(logItemsOf([
    event('request/header', 1, 1, { header: { config: { model: 'deepseek-v4-flash' } }, reason: 'initial' }),
    event('assistant/attempt', 2, 2, { turn: 0, step: 0, stream: [streamChunk(usageChunk({ inputTokens: 100, outputTokens: 20 }))] }),
    event('llm/retry-started', 3, 3, { turn: 0, step: 0 }),
    event('assistant/message', 4, 4, {
      turn: 0, step: 0,
      message: { source: { model: 'deepseek-v4-flash' } },
      stream: [streamChunk(usageChunk({ inputTokens: 200, outputTokens: 40 }))],
    }),
  ]))
  assert.equal(records.length, 2)
  assert.deepEqual(records.map(entry => entry.model), ['deepseek-v4-flash', 'deepseek-v4-flash'])
})
