/**
 * Browser plugin: live session-cost readout for the conversation composer
 * band (0.1.2 line). Modes:
 *  - the dock entry renders the HOST summary (complete session ledger + today
 *    + balance) — the browser never pages history, so the client window is
 *    never expanded and session re-entry costs nothing extra;
 *  - the Definition/view pair is kept only as the turn-edge signal
 *    (`lastTurn`) that triggers a fresh summary fetch; it folds only the
 *    tiny initial tail window, never paging.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only contract pulls: each package owns one merge the register calls
// type against (locale Context face, Conversation SlotMap rows + standard
// props + uiConversation face, sessionId standard props, settingsScope face,
// and the settings.plugin.item keyed row).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { sessionCostDefinition } from './definition.ts'
import { SessionCostDockEntry } from './dock-entry.tsx'
import { en, NS, zh } from './locales.ts'
import { SessionCostCard } from './settings-card.tsx'
import { createSessionCostView, type CostReadout } from './view-definition.ts'
import { officialPriceTable } from '../core/price.ts'
import { officialPeakWindow } from '../core/window.ts'
import type { SessionCostConfig } from '../config.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    cost: CostReadout
  }
}

export const inject = ['slots', 'uiConversation', 'locale', 'settingsScope']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-cost: dictionaries')
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'session-cost',
    order: 20,
    locale: NS,
  }, SessionCostDockEntry))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => ({ scope: ctx.settingsScope.bind<SessionCostConfig>({ namespace: NS }) }),
  }, SessionCostCard))
  ctx.uiConversation.events.register(sessionCostDefinition)
  ctx.uiConversation.views.register(createSessionCostView(officialPriceTable, officialPeakWindow))
}
