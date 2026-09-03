/**
 * Offline type mirror: the ui-session SessionStandardProps merge
 * (@deepseek-ai/dsh-client-ui-session/client adds the strict `sessionId`).
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    readonly sessionId: string
  }
}

export {}
