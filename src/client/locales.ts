/**
 * Locale dictionaries for the session-cost readout.
 * Product copy is Chinese.
 */

export const NS = 'session-cost'

/** The session-cost key union (zh is the key-set source of truth). */
export type SessionCostKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'session-cost': SessionCostKey
  }
}

export const zh = {
  'window.peak': '高峰中',
  'window.valley': '低谷中',
  'readout.total': '总计 {amount}',
  'readout.todayShort': '今日 {amount}',
  'readout.balance': '余额 {amount}',
  'readout.breakdown': '低峰节省 {valleySaved} · 缓存节省 {cacheSaved}',
  'readout.sessionSplit': '当前会话：高峰 {peak} · 低峰 {valley}',
  'readout.todaySplit': '今日：高峰 {peak} · 低峰 {valley}',
  'readout.byModel': '模型分解：{items}',
  'readout.modelItem': '{model} {amount}',
  'readout.daily': '每日消耗：{items}',
  'readout.dailyItemFull': '{date} ¥{amount}（峰 ¥{peak} · 谷 ¥{valley}）',
  'readout.dailyLabel': '每日',
  'readout.loading': ' · 数据加载中…',
  'readout.noData': '暂无数据',
  'readout.unknown': '价格未知：{models}',
} satisfies Record<string, string>

export const en = {
  'window.peak': 'peak now',
  'window.valley': 'valley now',
  'readout.total': 'Total {amount}',
  'readout.todayShort': 'Today {amount}',
  'readout.balance': 'Balance {amount}',
  'readout.breakdown': 'Valley saved {valleySaved} · Cache saved {cacheSaved}',
  'readout.sessionSplit': 'Session: peak {peak} · valley {valley}',
  'readout.todaySplit': 'Today: peak {peak} · valley {valley}',
  'readout.byModel': 'By model: {items}',
  'readout.modelItem': '{model} {amount}',
  'readout.daily': 'Daily: {items}',
  'readout.dailyItemFull': '{date} ¥{amount} (peak ¥{peak} · valley ¥{valley})',
  'readout.dailyLabel': 'Daily',
  'readout.loading': ' · loading…',
  'readout.noData': 'no data',
  'readout.unknown': 'Unknown price: {models}',
} satisfies Record<SessionCostKey, string>
