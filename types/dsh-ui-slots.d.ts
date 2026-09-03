/**
 * Offline type mirror: slot system + component prop shares (0.1.2 alpha.5
 * contract shape). The real slot machinery lives in
 * @deepseek-ai/dsh-client-ui-slots; this mirror keeps only the surface this
 * plugin consumes and mirrors the mergeable tables (SlotMap,
 * SessionStandardProps, GlobalStandardProps, LocaleNamespaceMap) so the
 * declaring packages' mirrors can augment them exactly like the real
 * packages do.
 *
 * Used ONLY by tsconfig.offline.json (no network installs in the dev
 * sandbox). The production tsconfig.json has no paths: real published
 * typings assert these at build time, so any drift surfaces there.
 */

export type SnapshotSelectorHook<Snapshot> = <Selected>(
  selector: (snapshot: Snapshot) => Selected,
) => Selected

/** Merge-extensible slot catalogue (ui-conversation / ui-settings declare rows). */
export interface SlotMap {}

/** Merge-extensible standard kit delivered to every session-scope slot component. */
export interface SessionStandardProps {}

/** Merge-extensible standard kit delivered to current-session-optional slots. */
export interface SessionMaybeStandardProps {}

/** Merge-extensible standard kit delivered to every slot component. */
export interface GlobalStandardProps {}

/** Merge-extensible locale dictionary catalogue (each namespace owner augments). */
export interface LocaleNamespaceMap {}

export type ScopeOf<K extends keyof SlotMap & string> =
  SlotMap[K] extends { readonly scope: infer S } ? S : never

/** Owner-supplied props share for a slot key ({} for entries declaring none). */
export type OwnerOf<K extends keyof SlotMap & string> =
  SlotMap[K] extends { readonly owner: infer O extends object } ? O : object

/**
 * Runtime props share for a slot key: owner share + session standard kit
 * (session scope only) + the global seat. Mirrors the real scope axis.
 */
export type PropsRuntime<K extends keyof SlotMap & string> =
  OwnerOf<K>
  & (ScopeOf<K> extends 'session' ? SessionStandardProps
    : ScopeOf<K> extends 'session-maybe' ? SessionMaybeStandardProps
      : object)
  & GlobalStandardProps

/** Namespace-addressed translate (loose mirror of the real typed seat). */
export type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string

export type PropsLocale<N extends string = string> = {
  readonly t: Translate
}

/** Registration options accepted by the slots service (kind shape fields). */
export interface SlotRegistration {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly locale?: string
  readonly key?: string
  readonly priority?: number
  readonly inject?: (sessionId?: string) => unknown
}

export interface SlotsService {
  inject(name: string, factory: () => () => void): () => void
  register(registration: SlotRegistration, component: unknown): () => void
}
