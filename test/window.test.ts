import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyInstant, officialPeakWindow, currentWindow } from '../src/core/window.ts'

// 2026-08-28 is a Friday; 2026-08-29 Saturday; 2026-08-31 Monday.
// Asia/Shanghai is UTC+8 with no DST, so wall 09:00 = epoch 01:00 UTC.
const at = (day: number, hour: number, minute = 0, second = 0): number =>
  Date.UTC(2026, 7, day, hour - 8, minute, second)

test('official peak: weekday 09:00 inclusive start', () => {
  assert.equal(classifyInstant(at(28, 9, 0, 0)), 'peak')
})

test('official peak: 11:59:59 inside morning interval', () => {
  assert.equal(classifyInstant(at(28, 11, 59, 59)), 'peak')
})

test('official valley: 12:00 starts the lunch valley (end exclusive)', () => {
  assert.equal(classifyInstant(at(28, 12, 0, 0)), 'valley')
})

test('official valley: 13:59 lunch', () => {
  assert.equal(classifyInstant(at(28, 13, 59, 59)), 'valley')
})

test('official peak: 14:00 afternoon interval starts', () => {
  assert.equal(classifyInstant(at(28, 14, 0, 0)), 'peak')
})

test('official valley: 18:00 exact end exclusive', () => {
  assert.equal(classifyInstant(at(28, 18, 0, 0)), 'valley')
})

test('official valley: early morning 08:59:59', () => {
  assert.equal(classifyInstant(at(28, 8, 59, 59)), 'valley')
})

test('official valley: midnight', () => {
  assert.equal(classifyInstant(at(28, 0, 30)), 'valley')
})

test('official valley: weekend during what would be peak hours', () => {
  assert.equal(classifyInstant(at(29, 10, 0, 0)), 'valley')
})

test('official valley: Monday 00:00 (before peak)', () => {
  assert.equal(classifyInstant(at(31, 0, 0)), 'valley')
})

test('peak weekdays are Mon-Fri only', () => {
  assert.deepEqual(officialPeakWindow.peakWeekdays, [1, 2, 3, 4, 5])
})

test('currentWindow returns the official classification of now', () => {
  const kind = currentWindow(at(28, 10, 0, 0))
  assert.equal(['peak', 'valley'].includes(kind), true)
})

test('custom config: rotated weekdays / wider interval', () => {
  const cfg = { ...officialPeakWindow, peakWeekdays: [6], peakIntervals: [{ startMin: 0, endMin: 24 * 60 }] }
  assert.equal(classifyInstant(at(29, 10), cfg), 'peak')
  assert.equal(classifyInstant(at(28, 10), cfg), 'valley')
})
