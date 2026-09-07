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
 *     records, per (turn, step, generation) last-wins, retry adds), folded
 *     from the persistence read handle's v2 logical event stream;
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
import { foldCostItems, logItemsOf, type LogEventLike, type StepRecord } from './core/fold.ts'
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
 * 0.1.3 line (format v2): `open(id, 'read')` → `handle.read()` returns the
 * decoded logical event stream in current-format vocabulary — the host
 * already migrated released v0/v1 artifacts through the format chain
 * (session-format-v0-to-v1 → v1-to-v2), assistant streams stay embedded in
 * `assistant/attempt` / `assistant/message`, and a torn physical tail is
 * never returned. Unknown vocabulary fails the read fail-closed.
 */
interface PersistenceSeam {
  open(id: string, access: 'read', options?: { signal?: AbortSignal }): Promise<SessionReadHandle>
}

interface SessionReadHandle {
  /**
   * Read a slice of the valid contiguous logical log: `offset` (default 0),
   * `length` (default the rest), optional cancellation.
   */
  read(
    offset?: number,
    length?: number,
    options?: { signal?: AbortSignal },
  ): Promise<readonly LogEvent[]>
  close(): Promise<void>
}

/** Read one session's logical event stream through the persistence seam. */
async function readSessionLog(
  persistence: PersistenceSeam,
  sessionId: string,
): Promise<readonly LogEvent[]> {
  const handle = await persistence.open(sessionId, 'read')
  try {
    return await handle.read()
  } finally {
    await handle.close()
  }
}

/** Fold one session's v2 logical events into priced records (pure fold helpers). */
function foldEvents(events: readonly LogEventLike[]): StepRecord[] {
  return foldCostItems(logItemsOf(events))
}

/** Beijing-midnight epoch ms for the "today" boundary. */
function todayStartMs(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date())
  const pick = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)
  return Date.UTC(pick('year'), pick('month') - 1, pick('day')) - 8 * 3600 * 1000
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
          const events = await readSessionLog(persistence, sessionId)
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
