/**
 * Offline type mirror: the settings-namespace scope contract
 * (@deepseek-ai/dsh-client-ui-settings/client) plus its Context merge —
 * the settings-card consumer surface at the 0.1.2 line.
 */

/** Client-side sync state of one settings namespace. */
export interface SettingsScopeSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  readonly value: T | undefined
  /** Composition layer the Host resolved the value over. */
  readonly base: unknown
  /** Raw user layer as stored; a field's PRESENCE here marks it overridden. */
  readonly user: unknown
  /** Namespace revision fencing the next write. */
  readonly revision: number | undefined
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** `host` syncs with the Host document; `memory` keeps a remote browser process-local. */
  readonly mode: 'host' | 'memory'
}

/** Domain-owned description of one settings namespace consumed by a browser plugin. */
export interface SettingsScopeSpec<T> {
  readonly namespace: string
  readonly decode?: (section: unknown) => T | undefined
}

/** Reactive owner handle over one namespace's durable section. */
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** The settings-domain service: `bind` produces one namespace's scope. */
export interface SettingsScopeBinder {
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsScope: SettingsScopeBinder
  }
}
