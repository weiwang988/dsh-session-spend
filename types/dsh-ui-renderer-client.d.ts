/**
 * Offline type mirror: the ui-renderer client face — the slots service
 * Context merge (the real program declares `ctx.slots` from
 * @deepseek-ai/dsh-client-ui-renderer/client, which owns the cordis Service
 * layer over SlotCore).
 */

/** Mirror of the SlotRegistry surface this plugin consumes. */
export interface SlotRegistryLike {
  inject(name: string, factory: () => () => void): () => void
  register(registration: {
    readonly name: string
    readonly id?: string
    readonly order?: number
    readonly locale?: string
    readonly key?: string
    readonly priority?: number
    readonly inject?: (sessionId?: string) => unknown
  }, component: unknown): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotRegistryLike
  }
}
