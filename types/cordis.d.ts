/**
 * Offline type mirror: the base cordis Context slice this plugin uses.
 *
 * The Context is a merge-extensible interface: plugin-facing service members
 * (slots/locale/uiConversation/settingsScope) are contributed by the
 * declaring packages' mirrors, and the host-facing members
 * (webServer/credentials/settings) by ./host-harness.d.ts — exactly the
 * merge shape the real packages use.
 */

export interface Context {
  effect(fn: () => unknown, name?: string): void
  get<K extends string>(key: K): unknown
  on(event: string, listener: (...args: unknown[]) => void): void
}
