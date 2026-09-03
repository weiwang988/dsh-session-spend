/** Minimal durable event envelope (mirrors @deepseek-ai/dsh-session/types). */
export interface SessionEvent<Data = unknown> {
  readonly seq: number
  /** Unix epoch milliseconds (append time — the billing instant). */
  readonly time: number
  readonly type: string
  readonly data: Data
}
