/**
 * Shared host-summary carrier for the dock entries: one fetch, many readers.
 * The main readout fetches/sets it; the daily trigger reads the cached value
 * and falls back to a lazy fetch on hover.
 */

export interface HostSummary {
  readonly ok: boolean
  readonly session?: {
    readonly totalCny: number
    readonly peakCny: number
    readonly valleyCny: number
    readonly cacheSavedCny: number
    readonly unknownModelIds: readonly string[]
    readonly recordCount: number
    readonly byModel: readonly { model: string; totalCny: number; recordCount: number }[]
  }
  readonly today?: {
    readonly cost: number
    readonly calls: number
    readonly peak: number
    readonly valley: number
  }
  readonly daily?: ReadonlyArray<{
    readonly date: string
    readonly cost: number
    readonly calls: number
    readonly peak: number
    readonly valley: number
  }>
  readonly balance?: {
    readonly infos: ReadonlyArray<{ currency: string; total: number }>
  }
  /** Current window + derived valley factor (honors configured prices). */
  readonly window?: {
    readonly current: 'peak' | 'valley'
    readonly valleyFactor: number
  }
}

const summaries = new Map<string, HostSummary>()

export function cachedSummary(sessionId: string): HostSummary | undefined {
  return summaries.get(sessionId)
}

export function rememberSummary(sessionId: string, summary: HostSummary): void {
  summaries.set(sessionId, summary)
}

export async function fetchSummary(sessionId: string): Promise<HostSummary | undefined> {
  try {
    const response = await fetch(`/_dsh-cost/summary?session=${encodeURIComponent(sessionId)}`)
    const payload = await response.json() as HostSummary
    if (!payload.ok) return undefined
    rememberSummary(sessionId, payload)
    return payload
  } catch {
    return undefined
  }
}
