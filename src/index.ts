/**
 * Host half: one same-origin summary route for the dock readout.
 *
 * Everything heavy runs here — the browser never pages session history, so
 * the client window is never expanded and re-entering a session costs
 * nothing extra (the "full-window render cost" shortboard).
 *
 * `GET /_dsh-cost/summary?session=<id>` returns:
 *   - `session`  — the complete session ledger: priced with the same official
 *     price table + peak/valley window as the client (main-conversation
 *     records, last-wins per (turn, step)), folded from the persistence
 *     read handle's decoded logical event stream;
 *   - `today`    — every session's main-conversation cost since Beijing
 *     midnight (the "今日(DSH)" figure);
 *   - `balance`  — official GET /user/balance via DSH credentials.
 * Failures degrade silently per field (ok:false reasons), never block.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  buildEffectivePriceTable, DEFAULT_SESSION_COST_CONFIG, type SessionCostConfig,
} from './config.ts'
import { computeCost, tokensToCny } from './core/cost.ts'
import type { StepRecord, UsageBuckets } from './core/fold.ts'
import { parseRawLogLines, type LogEventLike } from './core/fold.ts'
import { rateFor } from './core/price.ts'
import { classifyInstant, officialPeakWindow } from './core/window.ts'

/** Settings namespace shared with the client card. */
const NS = 'session-cost'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const ROUTE = '/_dsh-cost/summary'

export const inject = ['webServer', 'credentials']

/**
 * One durable log event as delivered by the persistence read handle (DSH
 * `SessionEvent` wire shape: `{ type, seq, time, data }` with optional
 * provenance fields). Structurally typed so the plugin needs no
 * `@deepseek-ai/dsh-session` runtime dependency.
 */
type LogEvent = LogEventLike

/**
 * The persistence service (duck-typed, zero runtime dependency).
 *
 * Two lines:
 *  - **master seam** (post-0.1.2-alpha.5, the current host line):
 *    `open(id, 'read')` → `handle.read()` returns the decoded logical event
 *    stream (packed chunk rows already expanded, torn tails never returned);
 *  - **released 0.1.2 line** (alpha.4/alpha.5/rc.1 still ship the
 *    pre-seam surface): `supportsRawArtifacts` + `readRaw(id)` → decompressed
 *    JSONL text, parsed with {@link parseRawLogLines}. Whether either exists
 *    is probed at request time, so the same bundle serves both.
 */
interface PersistenceSeam {
  open(id: string, access: 'read', options?: { signal?: AbortSignal }): Promise<SessionReadHandle>
  supportsRawArtifacts?: boolean
  readRaw?(id: string, signal?: AbortSignal): Promise<{ readonly content: string } | undefined>
}

interface SessionReadHandle {
  read(options?: { signal?: AbortSignal }): Promise<readonly LogEvent[]>
  close(): Promise<void>
}

/** Read one session's logical event stream from whichever seam the host ships. */
async function readSessionLog(
  persistence: PersistenceSeam,
  sessionId: string,
): Promise<readonly LogEvent[] | undefined> {
  if (typeof persistence.open === 'function') {
    const handle = await persistence.open(sessionId, 'read')
    try {
      return await handle.read()
    } finally {
      await handle.close()
    }
  }
  if (persistence.supportsRawArtifacts === true && typeof persistence.readRaw === 'function') {
    const artifact = await persistence.readRaw(sessionId)
    return artifact === undefined ? undefined : parseRawLogLines(artifact.content)
  }
  return undefined
}

/** Host fold record: StepRecord plus the event seq (replace-order authority). */
interface HostRecord extends StepRecord {
  readonly seq: number
}

/** Beijing-midnight epoch ms for the "today" boundary. */
function todayStartMs(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date())
  const pick = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)
  return Date.UTC(pick('year'), pick('month') - 1, pick('day')) - 8 * 3600 * 1000
}

/** Fold one session's logical events' main-conversation usage into priced records. */
function foldEvents(events: readonly LogEvent[], onlySince?: number): HostRecord[] {
  const byStep = new Map<string, HostRecord>()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    if (onlySince !== undefined && event.time < onlySince) continue
    const data = event.data as {
      turn?: number
      step?: number
      message?: { source?: { model?: unknown } }
      usage?: UsageBuckets
    }
    if (data.usage === undefined || data.turn === undefined || data.step === undefined) continue
    const model = data.message?.source?.model
    const key = `${data.turn}:${data.step}`
    const previous = byStep.get(key)
    if (previous !== undefined && previous.seq >= event.seq) continue
    byStep.set(key, {
      seq: event.seq,
      turn: data.turn,
      step: data.step,
      time: event.time,
      model: typeof model === 'string' && model !== '' ? model : undefined,
      usage: data.usage,
    })
  }
  return [...byStep.values()].sort((left, right) => left.seq - right.seq)
}

/** One priced record at its own billing instant (cache hit/miss/output rates). */
function priceRecord(record: StepRecord, table: ReturnType<typeof buildEffectivePriceTable>): number | undefined {
  const kind = classifyInstant(record.time, officialPeakWindow)
  const rate = rateFor(record.model, kind, table)
  return rate === undefined ? undefined : tokensToCny(record.usage, rate)
}

/** Loose schemastery schema over the flat config (mirror-shape at build time). */
const ConfigSchema = z.object({
  flashCacheHit: z.number(), flashCacheMiss: z.number(), flashOutput: z.number(),
  proCacheHit: z.number(), proCacheMiss: z.number(), proOutput: z.number(),
  visionCacheHit: z.number(), visionCacheMiss: z.number(), visionOutput: z.number(),
  valleyFactor: z.number(),
})

interface SettingsSectionHook {
  setSource(current: () => Readonly<SessionCostConfig>): void
  /** Required by the contract; pricing re-reads the source at request time. */
  onChange(): void
}

interface SettingsLike {
  installSection(
    ctx: Context,
    namespace: string,
    schema: unknown,
    entry: Readonly<SessionCostConfig>,
    hooks: SettingsSectionHook,
  ): void
}

export function apply(ctx: Context): void {
  let pricingConfig: Readonly<SessionCostConfig> = DEFAULT_SESSION_COST_CONFIG

  // Editable price table through the settings page card (optional: works
  // with no settings provider mounted — the default table stays).
  const settings = ctx.get('settings') as SettingsLike | undefined
  if (settings !== undefined && typeof settings.installSection === 'function') {
    settings.installSection(ctx, NS, ConfigSchema, DEFAULT_SESSION_COST_CONFIG, {
      setSource: current => { pricingConfig = current() },
      onChange: () => {},
    })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      const write = (payload: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const table = buildEffectivePriceTable(pricingConfig)
      const persistence = ctx.get('sessionPersistence') as PersistenceSeam | undefined
      const sessionId = new URL(req.url ?? `http://x${ROUTE}`, 'http://x').searchParams.get('session')
      const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })

      // ── session ledger + daily buckets — one logical read ────────────────
      // Daily(DSH) and today are scoped to the CURRENT session (what the
      // user asked): each day covers only this session's priced records.
      let sessionPayload: unknown = null
      let dailyPayload: Array<{ date: string; cost: number; calls: number; peak: number; valley: number }> | undefined
      let todayPayload: { cost: number; calls: number; peak: number; valley: number } | undefined
      if (persistence !== undefined && sessionId !== null) {
        try {
          // Seam-first (master line); released-0.1.2 readRaw fallback keeps
          // the same readout on both. Absence and corruption both degrade
          // silently to the local tail fold.
          const events = await readSessionLog(persistence, sessionId)
          if (events !== undefined) {
            const records = foldEvents(events)
            const summary = computeCost(records, table, officialPeakWindow)
            sessionPayload = {
              totalCny: summary.totalCny,
              peakCny: summary.peakCny,
              valleyCny: summary.valleyCny,
              cacheSavedCny: summary.cacheSavedCny,
              unknownModelIds: summary.unknownModelIds,
              recordCount: summary.recordCount,
              byModel: summary.byModel,
            }
            // Session-scoped day buckets (oldest first); today = last bucket.
            const buckets = new Map<string, { cost: number; calls: number; peak: number; valley: number }>()
            for (const record of records) {
              const priced = priceRecord(record, table)
              if (priced === undefined) continue
              const kind = classifyInstant(record.time, officialPeakWindow)
              const day = dayKey.format(new Date(record.time))
              const bucket = buckets.get(day) ?? { cost: 0, calls: 0, peak: 0, valley: 0 }
              bucket.cost += priced
              bucket.calls += 1
              if (kind === 'peak') bucket.peak += priced
              else bucket.valley += priced
              buckets.set(day, bucket)
            }
            const daily = [...buckets.entries()]
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
              .map(([date, bucket]) => ({
                date, cost: bucket.cost, calls: bucket.calls, peak: bucket.peak, valley: bucket.valley,
              }))
            dailyPayload = daily
            const last = buckets.get(dayKey.format(new Date(todayStartMs())))
            todayPayload = last === undefined
              ? { cost: 0, calls: 0, peak: 0, valley: 0 }
              : { cost: last.cost, calls: last.calls, peak: last.peak, valley: last.valley }
          }
        } catch {
          sessionPayload = null
          dailyPayload = undefined
          todayPayload = undefined
        }
      }

      // ── account balance via official endpoint ───────────────────────────
      let balancePayload: { available: boolean; infos: Array<{ currency: string; total: number }> } | undefined
      try {
        const credential = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
        if (credential !== undefined) {
          const response = await fetch(BALANCE_URL, {
            headers: { authorization: `Bearer ${credential.value}` },
            signal: AbortSignal.timeout(15_000),
          })
          if (response.ok) {
            const body = await response.json() as {
              is_available?: boolean
              balance_infos?: Array<{ currency?: string; total_balance?: string | number }>
            }
            balancePayload = {
              available: body.is_available ?? false,
              infos: (body.balance_infos ?? []).map(info => ({
                currency: info.currency ?? 'CNY',
                total: Number(info.total_balance ?? 0),
              })),
            }
          }
        }
      } catch {
        balancePayload = undefined
      }

      write({
        ok: true,
        at: Date.now(),
        session: sessionPayload,
        today: todayPayload,
        daily: dailyPayload,
        balance: balancePayload,
        window: {
          current: classifyInstant(Date.now(), officialPeakWindow),
          valleyFactor: pricingConfig.valleyFactor,
        },
      })
    },
  }), 'session-cost: summary route')
}
