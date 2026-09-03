/**
 * Offline type mirror: the Conversation contract (Definition / snapshot /
 * view builder) plus the merges this plugin consumes. Mirrors
 * packages/client/ui-conversation/src/client/contract/conversation.ts and
 * contract/snapshot.ts at the 0.1.2-alpha.5 line (the current host line).
 *
 * Used ONLY by tsconfig.offline.json (no network installs in the dev
 * sandbox). The production tsconfig.json has no paths: real published
 * typings assert these at build time, so any drift surfaces there.
 */

import type { SessionEvent } from './dsh-session.d.ts'
import type { SessionEventLike } from './dsh-api-session-controller-client.d.ts'
import type { SnapshotSelectorHook } from './dsh-ui-slots.d.ts'

/** Definition-local identity and lifecycle role extracted from one event. */
export interface ConversationMatchResult {
  readonly id: string
  readonly role: 'start' | 'update'
}

/** Merge-extensible business values published against one Turn. */
export interface ConversationTurnDataMap {}

/** Merge-extensible business values published against one Step. */
export interface ConversationStepDataMap {}

/** Engine-owned placement of one matched event in the Session hierarchy. */
export type ConversationLocation =
  | { readonly kind: 'session' }
  | { readonly kind: 'turn'; readonly turn: { readonly turn: number } }
  | { readonly kind: 'step'; readonly turn: { readonly turn: number }; readonly step: { readonly turn: number; readonly step: number } }
  | { readonly kind: 'unresolved' }

/** One scalar event accepted as a Context's unique start. */
export interface ConversationStartMatch {
  readonly event: SessionEvent
  readonly role: 'start'
  readonly location: ConversationLocation
}

/** One event accepted by a Definition, with its lifecycle role and resolved Location. */
export type ConversationMatch =
  | ConversationStartMatch
  | { readonly event: SessionEventLike; readonly role: 'update'; readonly location: ConversationLocation }

/** Target-neutral identity returned by a business Definition. */
export interface ConversationViewNode {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly target: string
  readonly data: unknown
}

/** Merge-extensible immutable snapshots published by registered view targets. */
export interface ConversationViewSnapshotMap {}

/** Stable reader over the latest snapshot of every registered view target. */
export interface ConversationViewSnapshotStore {
  get<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ConversationViewSnapshotMap[Target] | undefined
}

/** Immutable public view of an assembled business Context. */
export interface ConversationNodeContext<State = unknown> {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly matches: readonly ConversationMatch[]
  readonly start: ConversationStartMatch | undefined
  readonly state: State | undefined
  readonly current: ReadonlyMap<string, ConversationViewNode | null>
}

/** Read-only predecessor returned to a Definition's start function. */
export interface ConversationPreviousContext<State = unknown> {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly startSeq: number
  readonly state: Readonly<State>
  readonly matches: readonly ConversationMatch[]
}

/** Strictly-backward Context lookup available while a start is evaluated. */
export interface ConversationContextReader {
  previous<State>(kind: string): ConversationPreviousContext<State> | undefined
}

/** One independently registered business Event-to-Node state machine. */
export interface ConversationNodeDefinition<State = unknown> {
  readonly kind: string
  readonly target?: string
  match(event: SessionEventLike): ConversationMatchResult | null
  start(
    context: ConversationNodeContext<State>,
    match: ConversationStartMatch,
    reader: ConversationContextReader,
  ): State
  update(
    context: ConversationNodeContext<State> & { readonly state: State },
    match: ConversationMatch,
  ): State
  buildViewNode?(context: ConversationNodeContext<State>): ConversationViewNode | null
}

/** Reference-stable Turn/Step facts published beside view Nodes. */
export interface ConversationTimelineSnapshot {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<number, { readonly turn: number }>
}

/** Per-Session incremental builder for one view target. */
export interface ConversationViewBuilder<Node extends ConversationViewNode = ConversationViewNode, Snapshot = unknown> {
  readonly empty: Snapshot
  replace(input: {
    readonly nodes: readonly Node[]
    readonly timeline: ConversationTimelineSnapshot
  }): Snapshot
  apply(input: {
    readonly upserts: readonly Node[]
    readonly timeline: ConversationTimelineSnapshot
  }): Snapshot
}

/** Registry contribution that creates an isolated builder when a Session first uses this target. */
export interface ConversationViewDefinition<Node extends ConversationViewNode = ConversationViewNode, Snapshot = unknown> {
  readonly target: string
  create(): ConversationViewBuilder<Node, Snapshot>
}

/** Latest registered target snapshots and their shell-level activity. */
export interface ConversationSnapshot {
  readonly views: ConversationViewSnapshotStore
  readonly activeTargets: ReadonlySet<string>
}

/** Session-standard props merged by ui-conversation (the Conversation seat). */
export interface ConversationStandardProps {
  readonly useConversation: SnapshotSelectorHook<ConversationSnapshot>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Ambient entries below the composer card (0.1.2 alpha.5: no owner share). */
    'conversation.composer.dock': { kind: 'list'; scope: 'session' }
  }
  interface SessionStandardProps {
    /** Selector hook over the current Session's assembled Conversation. */
    useConversation: SnapshotSelectorHook<ConversationSnapshot>
    /** Selector hook over the Session input machine (unused by this plugin). */
    useInput: SnapshotSelectorHook<unknown>
    /** Stable public input actions for this Session (unused by this plugin). */
    inputActions: { readonly [key: string]: unknown }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    uiConversation: {
      readonly events: {
        register(definition: ConversationNodeDefinition): () => void
      }
      readonly views: {
        register(definition: ConversationViewDefinition): () => void
      }
    }
  }
}
