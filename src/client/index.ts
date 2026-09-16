/**
 * Browser plugin: live session-cost readout for the conversation composer
 * band (0.1.3 line / format v2 vocabulary). Modes:
 *  - the dock entry renders the HOST summary (complete session ledger + today
 *    + balance) — the browser never pages history, so the client window is
 *    never expanded and session re-entry costs nothing extra;
 *  - the Definition/view pair supplies the refresh signal: `recordCount`
 *    advances as the tail window folds new settlements, and the dock refetches
 *    the host summary on an idle debounce; it folds only the tiny initial tail
 *    window, never paging.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only contract pulls: each package owns one merge the register calls
// type against (locale Context face, Conversation SlotMap rows + standard
// props + uiConversation face, and sessionId standard props).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { sessionCostDefinition } from './definition.ts'
import { SessionCostDockEntry } from './dock-entry.tsx'
import { en, NS, zh } from './locales.ts'
import { createSessionCostView, type CostReadout } from './view-definition.ts'
import { officialPriceTable } from '../core/price.ts'
import { officialPeakWindow } from '../core/window.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    cost: CostReadout
  }
}

export const inject = ['slots', 'uiConversation', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-cost: dictionaries')
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'session-cost',
    order: 20,
    locale: NS,
  }, SessionCostDockEntry))
  ctx.uiConversation.events.register(sessionCostDefinition)
  ctx.uiConversation.views.register(createSessionCostView(officialPriceTable, officialPeakWindow))
}
