/**
 * Plugin configuration (namespace `session-cost`), user-editable through the
 * settings page card.
 *
 * Field keys are FLAT (the settings scope addresses one field per key; no
 * nested paths). Values are PEAK ¥/1M tokens per model; the valley rate is
 * derived as peak × `valleyFactor` (official scheme: 0.5). Peak/valley
 * window rules stay on the official defaults (Beijing weekday 09:00-12:00 /
 * 14:00-18:00).
 */

export interface ModelRates {
  /** Cached-input read price (¥/1M tokens). */
  readonly cacheHit: number
  /** Uncached input + cache write price (¥/1M tokens). */
  readonly cacheMiss: number
  /** Output token price (¥/1M tokens). */
  readonly output: number
}

export interface SessionCostConfig {
  readonly flashCacheHit: number
  readonly flashCacheMiss: number
  readonly flashOutput: number
  readonly proCacheHit: number
  readonly proCacheMiss: number
  readonly proOutput: number
  readonly visionCacheHit: number
  readonly visionCacheMiss: number
  readonly visionOutput: number
  readonly valleyFactor: number
}

/** Official defaults (collected 2026-09-10; `deepseek-flash` = DeepSeek-V4.1-Flash). */
export const DEFAULT_SESSION_COST_CONFIG: Readonly<SessionCostConfig> = {
  flashCacheHit: 0.04,
  flashCacheMiss: 2.0,
  flashOutput: 8.0,
  proCacheHit: 0.30,
  proCacheMiss: 9.0,
  proOutput: 27.0,
  // Retired vision name: still callable, served by V4.1-Flash at Flash prices.
  visionCacheHit: 0.04,
  visionCacheMiss: 2.0,
  visionOutput: 8.0,
  valleyFactor: 0.5,
}

/** The editable numeric fields, in card order. */
export const CONFIG_FIELDS: ReadonlyArray<keyof SessionCostConfig> = [
  'flashCacheHit', 'flashCacheMiss', 'flashOutput',
  'proCacheHit', 'proCacheMiss', 'proOutput',
  'visionCacheHit', 'visionCacheMiss', 'visionOutput',
  'valleyFactor',
]

/** Effective price table: peak = configured, valley = peak × factor. */
export function buildEffectivePriceTable(
  config: Readonly<SessionCostConfig>,
): Readonly<Record<string, { peak: ModelRates; valley: ModelRates }>> {
  const flash: { peak: ModelRates; valley: ModelRates } = {
    peak: { cacheHit: config.flashCacheHit, cacheMiss: config.flashCacheMiss, output: config.flashOutput },
    valley: {
      cacheHit: config.flashCacheHit * config.valleyFactor,
      cacheMiss: config.flashCacheMiss * config.valleyFactor,
      output: config.flashOutput * config.valleyFactor,
    },
  }
  return {
    // DSH 0.1.5 default route plus the retired names it now serves.
    'deepseek-flash': flash,
    'deepseek-v4-flash': flash,
    'deepseek-v4-flash-vision-exp': {
      peak: { cacheHit: config.visionCacheHit, cacheMiss: config.visionCacheMiss, output: config.visionOutput },
      valley: {
        cacheHit: config.visionCacheHit * config.valleyFactor,
        cacheMiss: config.visionCacheMiss * config.valleyFactor,
        output: config.visionOutput * config.valleyFactor,
      },
    },
    'deepseek-v4-pro': {
      peak: { cacheHit: config.proCacheHit, cacheMiss: config.proCacheMiss, output: config.proOutput },
      valley: {
        cacheHit: config.proCacheHit * config.valleyFactor,
        cacheMiss: config.proCacheMiss * config.valleyFactor,
        output: config.proOutput * config.valleyFactor,
      },
    },
  }
}
