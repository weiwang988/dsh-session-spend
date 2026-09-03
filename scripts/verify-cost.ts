/**
 * Independent cost reconciliation script.
 *
 * Reads the DSH JSONL session logs directly from disk (zstd concatenated
 * frames; the physical line format of both the released 0.1.2 line and the
 * master line: a `{type:'session'}` header line, one event per line, and
 * optionally packed `text-chunks`/`reasoning-chunks`/`tool-call-chunks`
 * delta rows that never carry usage). It then prices every
 * `assistant/message` usage record with the SAME official price table and
 * peak/valley window as the plugin, and prints per-day / per-model / per-
 * session totals for cross-checking against the GUI readout or the DeepSeek
 * console bill. Deliberately independent of the host persistence seam —
 * it validates the fold against the log bytes themselves.
 *
 * Usage:
 *   node scripts/verify-cost.ts                     # today (Asia/Shanghai)
 *   node scripts/verify-cost.ts --day 2026-08-31
 *   node scripts/verify-cost.ts --root D:\path --day 2026-08-31
 *   node scripts/verify-cost.ts --session <id-substr>
 *
 * Zero dependencies; needs Node >= 24 (node:zlib zstd).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import { classifyInstant, officialPeakWindow } from '../src/core/window.ts'
import { officialPriceTable, rateFor } from '../src/core/price.ts'
import { tokensToCny } from '../src/core/cost.ts'
import type { UsageBuckets } from '../src/core/fold.ts'

// ── Zstandard concatenated-frame scan (mirrors the official backend's
//    scanZstdFrames; Node's zstd API decodes exactly one frame per call).

const ZSTD_MAGIC = 0xFD2FB528

interface FrameRange { start: number; end: number }

function scanFrames(buffer: Buffer): FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt zstd log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error('corrupt zstd log: reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('corrupt zstd log: reserved block type')
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

function decodeAll(buffer: Buffer): string {
  const frames = scanFrames(buffer)
  if (frames.length === 0) return ''
  return frames
    .map(frame => zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8'))
    .join('')
}

// ── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const readArg = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const root = readArg('--root') ?? join(homedir(), '.dsh', 'sessions')
const dayFilter = readArg('--day')
const sessionFilter = readArg('--session')
/** --wide: also price compaction/summary calls (hidden model calls with usage). */
const wide = args.includes('--wide')
/** --tail-events N: simulate a refreshed client's loaded tail window. */
const tailEvents = Number(readArg('--tail-events') ?? '' ) || 0

const dayKey = (epochMs: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(epochMs))

// ── Walk session logs ──────────────────────────────────────────────────────

interface Record { seq: number; time: number; model: string | undefined; usage: UsageBuckets }

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name === 'session.jsonl.zstd' || entry.name === 'session.jsonl') out.push(path)
  }
  return out
}

function collectRecords(file: string): Record[] {
  const raw = readFileSync(file)
  const text = file.endsWith('.zstd') ? decodeAll(raw) : raw.toString('utf8')
  const byStep = new Map<string, Record>()
  let maxSeq = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    const event = parsed as { type?: string; seq?: number; time?: number; data?: unknown }
    if (event.seq !== undefined && event.seq > maxSeq) maxSeq = event.seq
    const isMessage = event.type === 'assistant/message'
    const isSummary = wide && event.type === 'compaction/summary'
    if (!isMessage && !isSummary) continue
    if (event.seq === undefined || event.time === undefined) continue
    const data = event.data as {
      turn?: number
      step?: number
      message?: { source?: { model?: unknown } }
      usage?: UsageBuckets
      model?: unknown
    }
    if (data.usage === undefined) continue
    // assistant/message: fold per (turn, step), last-seq wins; compaction
    // summaries are one-shot hidden calls — keyed by seq, never replaced.
    const key = isMessage && data.turn !== undefined && data.step !== undefined
      ? `${data.turn}:${data.step}`
      : `summary:${event.seq}`
    const model = isMessage
      ? data.message?.source?.model
      : data.model
    byStep.set(key, {
      seq: event.seq,
      time: event.time,
      model: typeof model === 'string' && model !== '' ? model : undefined,
      usage: data.usage,
    })
  }
  const records = [...byStep.values()].sort((left, right) => left.seq - right.seq)
  if (tailEvents > 0) {
    return records.filter(record => record.seq > maxSeq - tailEvents)
  }
  return records
}

// ── Price everything ───────────────────────────────────────────────────────

const dayTotals = new Map<string, { total: number; byModel: Map<string, number>; peak: number; valley: number; unknown: Set<string>; sessions: Map<string, number> }>()

for (const file of walk(root)) {
  const records = collectRecords(file)
  const sessionId = file.split(sep).at(-2) ?? relative(root, file)
  for (const record of records) {
    const day = dayKey(record.time)
    if (dayFilter !== undefined && day !== dayFilter) continue
    if (sessionFilter !== undefined && !sessionId.includes(sessionFilter)) continue
    let bucket = dayTotals.get(day)
    if (bucket === undefined) {
      bucket = { total: 0, byModel: new Map(), peak: 0, valley: 0, unknown: new Set(), sessions: new Map() }
      dayTotals.set(day, bucket)
    }
    bucket.sessions.set(sessionId, (bucket.sessions.get(sessionId) ?? 0) + 0)
    const kind = classifyInstant(record.time, officialPeakWindow)
    const price = rateFor(record.model, kind, officialPriceTable)
    if (price === undefined) {
      if (record.model !== undefined) bucket.unknown.add(record.model)
      continue
    }
    const cost = tokensToCny(record.usage, price)
    bucket.total += cost
    bucket.peak += kind === 'peak' ? cost : 0
    bucket.valley += kind === 'valley' ? cost : 0
    if (record.model !== undefined) {
      bucket.byModel.set(record.model, (bucket.byModel.get(record.model) ?? 0) + cost)
    }
    bucket.sessions.set(sessionId, (bucket.sessions.get(sessionId) ?? 0) + cost)
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

if (dayTotals.size === 0) {
  console.log(`(no priced records under ${root}${dayFilter !== undefined ? ` for ${dayFilter}` : ''})`)
  process.exit(0)
}
for (const [day, bucket] of [...dayTotals.entries()].sort()) {
  console.log(`${day}  total ¥${bucket.total.toFixed(2)}  (peak ¥${bucket.peak.toFixed(2)} / valley ¥${bucket.valley.toFixed(2)})  sessions: ${bucket.sessions.size}`)
  for (const [model, amount] of [...bucket.byModel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${model}  ¥${amount.toFixed(2)}`)
  }
  for (const [sessionId, amount] of [...bucket.sessions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     [session] ${sessionId}  ¥${amount.toFixed(2)}`)
  }
  if (bucket.unknown.size > 0) console.log(`     [unknown prices, excluded] ${[...bucket.unknown].join(', ')}`)
}
