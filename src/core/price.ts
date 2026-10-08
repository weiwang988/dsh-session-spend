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
 * `deepseek-flash` serves DeepSeek-V4.1-Flash and is the DSH default model. The
 * retired names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are kept
 * as rows because RECORDED sessions still carry those ids as their routed
 * model. DSH 0.2.x removed both from the `llm-deepseek` catalog
 * (`feat(llm): remove the V4 Flash and V4 Flash Vision Exp defaults`), so a
 * current request cannot select them again; their recorded traffic was billed
 * by the provider as V4.1-Flash, which is the rate they keep here. Both rows
 * hold the SAME object reference as `deepseek-flash`, so a future price change
 * cannot drift them apart.
 *
 * `deepseek-v4-pro` keeps its own rate until the provider routes it to
 * V4.1 Flash (announced for 2026-09-14 12:00 Beijing) — after that its requests
 * are billed at Flash prices too, so move the pro row then.
 *
 * Valley = peak × 0.5 per the official rule ("空闲时段价格为高峰时段价格的一半").
 * Prices change; this table is a built-in constant (edit it and rebuild).
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

/**
 * V4.1-Flash rates (peak/valley). The retired ids below share this exact
 * object: one edit moves every row that the provider bills as Flash.
 */
const flashRates: ModelPrices = {
  peak: { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
  valley: { cacheHit: 0.02, cacheMiss: 1.0, output: 4.0 },
}

/** Official defaults (collected 2026-09-10; DSH 0.2.x catalog: flash + pro). */
export const officialPriceTable: PriceTable = {
  // DSH default model: DeepSeek-V4.1-Flash.
  'deepseek-flash': flashRates,
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
    valley: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  // Retired ids, kept for RECORDED sessions only; DSH 0.2.x no longer lists
  // them, and their historical traffic was billed as V4.1-Flash.
  'deepseek-v4-flash': flashRates,
  'deepseek-v4-flash-vision-exp': flashRates,
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
