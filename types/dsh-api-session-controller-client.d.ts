/**
 * Offline type mirror: `SessionEventLike` as exported by
 * @deepseek-ai/dsh-api-session-controller/client (the Conversation
 * Definition match() input type at the 0.1.2 line).
 */

/** Event accepted by Definitions: a standard or compact Client history form. */
export interface SessionEventLike {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}
