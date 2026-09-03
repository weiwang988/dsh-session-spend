/**
 * Offline type mirror: the `settings.plugin.item` keyed row (declared by
 * @deepseek-ai/dsh-client-ui-settings-plugins/client in the real program),
 * merged onto the shared SlotMap.
 */

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

export {}
