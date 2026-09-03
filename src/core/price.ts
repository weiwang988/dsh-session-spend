/**
 * Model price table (pure).
 *
 * Official DeepSeek V4 scheme, collected 2026-08-28 from
 * api-docs.deepseek.com/zh-cn/quick_start/pricing/ (user-supplied screenshot):
 *
 * | ¥/1M tokens       | v4-flash | v4-pro | v4-flash-vision-exp |
 * |-------------------|----------|--------|----------------------|
 * | cache hit  peak   | 0.10     | 0.30   | 0.10                 |
 * | cache hit  valley | 0.05     | 0.15   | 0.05                 |
 * | cache miss peak   | 3.0      | 9.0    | 3.0                  |
 * | cache miss valley | 1.5      | 4.5    | 1.5                  |
 * | output     peak   | 9.0      | 27.0   | 9.0                  |
 * | output     valley | 4.5      | 13.5   | 4.5                  |
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

/** Official defaults (collected 2026-08-28). */
export const officialPriceTable: PriceTable = {
  'deepseek-v4-flash': {
    peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    valley: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
    valley: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  'deepseek-v4-flash-vision-exp': {
    peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    valley: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
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
