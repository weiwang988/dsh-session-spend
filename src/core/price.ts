/**
 * Model price table (pure).
 *
 * Official DeepSeek scheme, collected 2026-09-10 from
 * api-docs.deepseek.com/zh-cn/quick_start/pricing/:
 *
 * | ¥/1M tokens       | deepseek-flash | deepseek-v4-pro | legacy flash names |
 * |-------------------|----------------|-----------------|--------------------|
 * | cache hit  peak   | 0.04           | 0.30            | billed as flash    |
 * | cache hit  valley | 0.02           | 0.15            | billed as flash    |
 * | cache miss peak   | 2.0            | 9.0             | billed as flash    |
 * | cache miss valley | 1.0            | 4.5             | billed as flash    |
 * | output     peak   | 8.0            | 27.0            | billed as flash    |
 * | output     valley | 4.0            | 13.5            | billed as flash    |
 *
 * `deepseek-flash` serves DeepSeek-V4.1-Flash and is the DSH 0.1.5 default
 * (llm-deepseek catalog). The retired names `deepseek-v4-flash` and
 * `deepseek-v4-flash-vision-exp` stay callable, but the provider serves them
 * with V4.1-Flash at Flash prices (official footnote), so they map to the same
 * rates here. `deepseek-v4-pro` keeps its own rate until the provider routes
 * it to V4.1 Flash (announced for 2026-09-14 12:00 Beijing) — after that its
 * requests are billed at Flash prices too, so move the pro row then.
 *
 * Valley = peak × 0.5 per the official rule ("空闲时段价格为高峰时段价格的一半").
 * Prices change; everything here is overridable through plugin configuration.
 */

import type { WindowKind } from './window.ts'

/** One model's per-1M-token prices, in CNY. */
export interface ModelRate {
  /** Cached-input read price (¥/1M tokens). */
  readonly cacheHit: number
  /** Uncached input + cache write price (¥/1M tokens). */
  readonly cacheMiss: number
  /** Output token price (¥/1M tokens). */
  readonly output: number
}

/** Price set for one model at one window kind. */
export type ModelPrices = Record<WindowKind, ModelRate>

/** Full configurable price table: model id → peak/valley rates. */
export type PriceTable = Readonly<Record<string, ModelPrices>>

/** Official defaults (collected 2026-09-10). */
export const officialPriceTable: PriceTable = {
  // DSH 0.1.5 default route: DeepSeek-V4.1-Flash.
  'deepseek-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
    valley: { cacheHit: 0.02, cacheMiss: 1.0, output: 4.0 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
    valley: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  // Retired names, still callable: served by V4.1-Flash at Flash prices.
  'deepseek-v4-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
    valley: { cacheHit: 0.02, cacheMiss: 1.0, output: 4.0 },
  },
  'deepseek-v4-flash-vision-exp': {
    peak: { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
    valley: { cacheHit: 0.02, cacheMiss: 1.0, output: 4.0 },
  },
}

/**
 * Resolve the applicable rate for one model id and window kind.
 * @returns the rate, or undefined for an unknown model (callers must not guess).
 */
export function rateFor(
  modelId: string | undefined,
  kind: WindowKind,
  table: PriceTable = officialPriceTable,
): ModelRate | undefined {
  if (modelId === undefined) return undefined
  const prices = table[modelId]
  return prices?.[kind]
}
