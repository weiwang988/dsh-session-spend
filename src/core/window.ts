/**
 * Peak/valley window classification (pure).
 *
 * Official DeepSeek V4 scheme (collected 2026-08-28 from
 * api-docs.deepseek.com/zh-cn/quick_start/pricing/):
 * peak = Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00
 * (interval start inclusive, end exclusive — 12:00 and 18:00 are valley);
 * everything else — nights, lunch, evenings, weekends — is valley.
 * Valley price = peak price × 0.5.
 */

export type WindowKind = 'peak' | 'valley'

export interface PeakInterval {
  /** Minutes of day where the interval starts, inclusive (e.g. 9*60 = 540). */
  readonly startMin: number
  /** Minutes of day where the interval ends, exclusive (e.g. 12*60 = 720). */
  readonly endMin: number
}

export interface PeakWindowConfig {
  /** Days of week counted as peak days: 1=Monday … 7=Sunday. */
  readonly peakWeekdays: readonly number[]
  /** Wall-clock peak intervals (in the configured time zone). */
  readonly peakIntervals: readonly PeakInterval[]
  /** IANA time zone the peak rule is evaluated in (official: Asia/Shanghai = UTC+8, no DST). */
  readonly timeZone: string
  /** Valley factor applied to peak prices; official scheme: 0.5. */
  readonly valleyFactor: number
}

/** Official window (collected 2026-08-28). */
export const officialPeakWindow: PeakWindowConfig = {
  peakWeekdays: [1, 2, 3, 4, 5],
  peakIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 14 * 60, endMin: 18 * 60 },
  ],
  timeZone: 'Asia/Shanghai',
  valleyFactor: 0.5,
}

interface WallClock {
  readonly weekday: number
  readonly minutesOfDay: number
}

let wallClockFormatter: Intl.DateTimeFormat | undefined

/** Wall-clock breakdown of one instant in the configured zone (cached formatter). */
function wallClockOf(epochMs: number, timeZone: string): WallClock {
  if (wallClockFormatter === undefined || wallClockFormatter.resolvedOptions().timeZone !== timeZone) {
    wallClockFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
  }
  const parts = wallClockFormatter.formatToParts(new Date(epochMs))
  let weekday = 0
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'weekday') {
      // en-US short weekday labels: Mon..Sun.
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const index = names.indexOf(part.value)
      weekday = index === -1 ? 0 : index
    } else if (part.type === 'hour') {
      hour = Number(part.value)
    } else if (part.type === 'minute') {
      minute = Number(part.value)
    }
  }
  return { weekday, minutesOfDay: hour * 60 + minute }
}

/**
 * Classify one instant against the peak/valley rule.
 * @param epochMs - Unix epoch milliseconds.
 * @param config - window rule; defaults to the official scheme.
 */
export function classifyInstant(epochMs: number, config: PeakWindowConfig = officialPeakWindow): WindowKind {
  const { weekday, minutesOfDay } = wallClockOf(epochMs, config.timeZone)
  if (!config.peakWeekdays.includes(weekday)) return 'valley'
  for (const interval of config.peakIntervals) {
    if (minutesOfDay >= interval.startMin && minutesOfDay < interval.endMin) return 'peak'
  }
  return 'valley'
}

/** Current window kind for the official rule at this instant. */
export function currentWindow(now: number = Date.now()): WindowKind {
  return classifyInstant(now)
}
