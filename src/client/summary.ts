/**
 * Shared host-summary carrier for the dock entries: one fetch, many readers.
 * The main readout fetches/sets it; the daily trigger reads the cached value
 * and falls back to a lazy fetch on hover.
 *
 * A diagnostic sink records what each fetch actually did. The dock renders it
 * only under `?costDebug=1`, so a silent failure (no host route, a non-JSON
 * answer, an aborted request) becomes readable in the browser instead of
 * leaving an empty band.
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
  /** Current peak/valley window plus the fixed official valley factor (0.5). */
  readonly window?: {
    readonly current: 'peak' | 'valley'
    readonly valleyFactor: number
  }
}

/** Last fetch outcome, readable from the optional `?costDebug=1` panel. */
export interface SummaryDiagnostics {
  readonly outcome: 'ok' | 'http-error' | 'non-json' | 'network-error'
  readonly status?: number
  readonly detail?: string
  readonly at: number
  /** Consecutive failures; success resets it to 0. */
  readonly failures: number
}

let diagnostics: SummaryDiagnostics | undefined

export function summaryDiagnostics(): SummaryDiagnostics | undefined {
  return diagnostics
}

function record(outcome: SummaryDiagnostics['outcome'], status?: number, detail?: string): void {
  const failures = outcome === 'ok' ? 0 : (diagnostics?.failures ?? 0) + 1
  diagnostics = {
    outcome,
    ...status === undefined ? {} : { status },
    ...detail === undefined ? {} : { detail },
    at: Date.now(),
    failures,
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
    if (!response.ok) {
      record('http-error', response.status)
      return undefined
    }
    let payload: HostSummary
    try {
      payload = await response.json() as HostSummary
    } catch (error) {
      record('non-json', response.status, error instanceof Error ? error.message : String(error))
      return undefined
    }
    if (!payload.ok) {
      record('non-json', response.status, 'payload.ok is false')
      return undefined
    }
    record('ok', response.status)
    rememberSummary(sessionId, payload)
    return payload
  } catch (error) {
    record('network-error', undefined, error instanceof Error ? error.message : String(error))
    return undefined
  }
}
