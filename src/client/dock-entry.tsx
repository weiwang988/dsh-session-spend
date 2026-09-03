/**
 * `conversation.composer.dock` entry: the session-cost readout, shown in the
 * same band as the shipped stats line (the daily trigger lives in the
 * sibling `session-cost-daily` entry).
 *
 * Main line: `总计 ¥x · 今日 ¥y · 高峰中/低峰中 · 余额 ¥z`. Tooltip: savings
 * breakdown, per-model shares, unknown models. Data comes from the host
 * summary route `/_dsh-cost/summary` (complete session ledger + daily +
 * balance) — the browser never pages session history, so the client window
 * is never expanded and re-entering a session costs nothing extra. Fetched
 * on mount and on the turn edge (the local 'cost' view's `lastTurn`, folded
 * from the tiny initial tail window only). Failures degrade silently to the
 * local tail fold.
 */

import { memo, useEffect, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatCny } from '../core/cost.ts'
import { classifyInstant, officialPeakWindow } from '../core/window.ts'
import { NS } from './locales.ts'
import { cachedSummary, fetchSummary, type HostSummary } from './summary.ts'
import type { CostReadout } from './view-definition.ts'

export type SessionCostDockEntryProps =
  PropsRuntime<'conversation.composer.dock'> & PropsLocale<typeof NS>

/** '2026-08-21' → '8/21'. */
function shortDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match === null ? date : `${Number(match[2])}/${Number(match[3])}`
}

function allDaysLabel(summary: HostSummary, t: SessionCostDockEntryProps['t']): string {
  const daily = summary.daily ?? []
  const items = daily
    .map(entry => t('readout.dailyItemFull', {
      date: shortDate(entry.date),
      amount: entry.cost.toFixed(2),
      peak: entry.peak.toFixed(2),
      valley: entry.valley.toFixed(2),
    }))
    .join(' · ')
  return t('readout.daily', { items })
}

/** Inline daily trigger, rendered at the right end of the same line. */
const DailyTrigger = memo(function DailyTrigger({
  sessionId, t,
}: { sessionId: string; t: SessionCostDockEntryProps['t'] }) {
  const [label, setLabel] = useState<string | null>(null)
  const reveal = (): void => {
    if (label !== null) return
    const cached = cachedSummary(sessionId)
    if (cached !== undefined) {
      setLabel(allDaysLabel(cached, t))
      return
    }
    void fetchSummary(sessionId).then(summary => {
      setLabel(summary === undefined ? '' : allDaysLabel(summary, t))
    })
  }
  if (label === '') return null
  return (
    <Tooltip label={label ?? ''} side="top" delayMs={300}>
      <span onMouseEnter={reveal} style={{ cursor: 'default' }}>
        {' · '}
        {t('readout.dailyLabel')}
      </span>
    </Tooltip>
  )
})

function breakdownLabel(
  summary: HostSummary,
  t: SessionCostDockEntryProps['t'],
  valleyFactor: number,
): string {
  const session = summary.session
  if (session === undefined) return t('readout.noData')
  // Line 1: 当前会话/今日峰谷拆分 + 节省；Line 2: 模型分解（+ 未知模型）。
  // The Tooltip bubble is white-space: pre-line, so '\n' renders as a break.
  const head = [
    t('readout.sessionSplit', {
      peak: formatCny(session.peakCny),
      valley: formatCny(session.valleyCny),
    }),
    summary.today === undefined
      ? ''
      : t('readout.todaySplit', {
        peak: formatCny(summary.today.peak),
        valley: formatCny(summary.today.valley),
      }),
    t('readout.breakdown', {
      valleySaved: formatCny(session.valleyCny * (1 / valleyFactor - 1)),
      cacheSaved: formatCny(session.cacheSavedCny),
    }),
  ].filter(text => text !== '').join(' · ')

  const tail: string[] = []
  if (session.byModel.length > 0) {
    const items = session.byModel
      .map(share => t('readout.modelItem', { model: share.model, amount: formatCny(share.totalCny) }))
      .join(' · ')
    tail.push(t('readout.byModel', { items }))
  }
  if (session.unknownModelIds.length > 0) {
    tail.push(t('readout.unknown', { models: session.unknownModelIds.join(', ') }))
  }
  return tail.length === 0 ? head : `${head}\n${tail.join(' · ')}`
}

function balanceText(summary: HostSummary, t: SessionCostDockEntryProps['t']): string {
  const infos = (summary.balance?.infos ?? []).filter(info => info.total > 0)
  if (infos.length === 0) return ''
  const amounts = infos
    .map(info => `${info.currency === 'USD' ? '$' : '¥'}${info.total >= 1 ? info.total.toFixed(2) : info.total.toFixed(4)}`)
    .join(' + ')
  return t('readout.balance', { amount: amounts })
}

export const SessionCostDockEntry = memo(function SessionCostDockEntry({
  sessionId, useConversation, t,
}: SessionCostDockEntryProps) {
  // Local tail fold: the turn-edge signal (and the graceful fallback while
  // the host summary is in flight). Never pages history.
  const local = useConversation(conversation => conversation).views.get('cost')

  const [summary, setSummary] = useState<HostSummary | null>(null)
  useEffect(() => {
    let alive = true
    void fetchSummary(sessionId).then(payload => {
      if (alive && payload !== undefined) setSummary(payload)
    })
    return () => { alive = false }
  }, [sessionId, local?.lastTurn])

  // ⑧ badge keeps ticking so an idle session flips 高峰/低谷 at the window
  // boundary (host-provided current window wins when available).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => { clearInterval(timer) }
  }, [])

  const windowKind = summary?.window?.current ?? classifyInstant(now, officialPeakWindow)
  const valleyFactor = summary?.window?.valleyFactor ?? officialPeakWindow.valleyFactor
  const windowLabel = t(windowKind === 'peak' ? 'window.peak' : 'window.valley')
  // Prefer the host ledger; fall back to the local tail fold while loading.
  const totalCny = summary?.session?.totalCny ?? local?.totalCny
  if (totalCny === undefined || (summary === null && (local === undefined || local.recordCount === 0))) {
    return null
  }
  const fallback: HostSummary = { ok: true, session: local === undefined ? undefined : {
    totalCny: local.totalCny,
    peakCny: local.peakCny,
    valleyCny: local.valleyCny,
    cacheSavedCny: local.cacheSavedCny,
    unknownModelIds: local.unknownModelIds,
    recordCount: local.recordCount,
    byModel: local.byModel,
  } }
  const displayed: HostSummary = summary ?? fallback

  // Main line: 总计 · 今日 · 高峰/低谷 · 余额
  const segments = [t('readout.total', { amount: formatCny(totalCny) })]
  if (displayed.today !== undefined) {
    segments.push(t('readout.todayShort', { amount: formatCny(displayed.today.cost) }))
  }
  segments.push(windowLabel)
  const balance = balanceText(displayed, t)
  if (balance !== '') segments.push(balance)

  return (
    // Sibling tooltips — never nest: the main readout tooltip and the daily
    // trigger tooltip are independent elements on one line, so hovering the
    // trigger cannot open both.
    <span>
      <Tooltip label={breakdownLabel(displayed, t, valleyFactor)} side="top" delayMs={500}>
        <span>
          {segments.join(' · ')}
          {summary === null ? t('readout.loading') : ''}
        </span>
      </Tooltip>
      <DailyTrigger sessionId={sessionId} t={t} />
    </span>
  )
})
