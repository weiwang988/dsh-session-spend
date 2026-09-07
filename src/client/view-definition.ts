/**
 * Cost view target: folds the Definition's Context nodes into one readout
 * snapshot.
 *
 * Nodes are per-step sample histories plus per-request header model facts;
 * the builder projects them into one seq-ordered {@link CostItem} stream and
 * runs the same pure fold as the host. Per (turn, step, generation) the LAST
 * sample wins (a settle message replaces its live/attempt samples), an
 * `llm/retry-started` opens a new generation so the retry ADDS, and every
 * record is attributed to the nearest preceding header model. The engine
 * rebuilds the complete node set on window replace, so paging and replay can
 * never double-count.
 */

import type {
  ConversationTimelineSnapshot, ConversationViewBuilder, ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionCostState } from './definition.ts'
import { computeCost, type ModelCostShare } from '../core/cost.ts'
import { foldCostItems, type CostItem } from '../core/fold.ts'
import type { PriceTable } from '../core/price.ts'
import type { PeakWindowConfig } from '../core/window.ts'

/** Snapshot consumed by the dock readout. */
export interface CostReadout {
  readonly totalCny: number
  readonly peakCny: number
  readonly valleyCny: number
  /** Saving vs having paid peak price for traffic that ran during valley. */
  readonly valleySavedCny: number
  /** Saving vs uncached pricing: cacheRead × (miss − hit), same window rate. */
  readonly cacheSavedCny: number
  readonly unknownModelIds: readonly string[]
  readonly recordCount: number
  /** Highest turn among priced records — the balance refresh edge. */
  readonly lastTurn: number
  /** Per-model share; model switching prices each record by its own model. */
  readonly byModel: readonly ModelCostShare[]
}

const EMPTY_READOUT: CostReadout = {
  totalCny: 0,
  peakCny: 0,
  valleyCny: 0,
  valleySavedCny: 0,
  cacheSavedCny: 0,
  unknownModelIds: [],
  recordCount: 0,
  lastTurn: 0,
  byModel: [],
}

/** Project one Node's state into seq-ordered fold items. */
function itemsOf(node: ConversationViewNode): CostItem[] {
  const data = node.data as SessionCostState
  if (data.role === 'header') {
    return data.model === '' ? [] : [{ kind: 'header', seq: data.seq, model: data.model }]
  }
  const items: CostItem[] = []
  for (const retry of data.retries) {
    items.push({ kind: 'retry', seq: retry, turn: data.turn, step: data.step })
  }
  for (const sample of data.samples) {
    items.push({
      kind: 'record',
      seq: sample.seq,
      turn: data.turn,
      step: data.step,
      time: sample.time,
      ...sample.model === undefined ? {} : { model: sample.model },
      usage: sample.usage,
    })
  }
  return items
}

/** Builder-local fold over the current node set (per-generations last-wins). */
export class SessionCostViewBuilder implements ConversationViewBuilder<ConversationViewNode, CostReadout> {
  readonly empty: CostReadout = EMPTY_READOUT
  /** node key → latest Node; contexts replace in place on upsert. */
  private nodes = new Map<string, ConversationViewNode>()
  private readonly prices: PriceTable
  private readonly windowConfig: PeakWindowConfig

  constructor(prices: PriceTable, windowConfig: PeakWindowConfig) {
    this.prices = prices
    this.windowConfig = windowConfig
  }

  private snapshot(): CostReadout {
    const items: CostItem[] = []
    for (const node of this.nodes.values()) items.push(...itemsOf(node))
    const records = foldCostItems(items)
    const summary = computeCost(records, this.prices, this.windowConfig)
    return {
      totalCny: summary.totalCny,
      peakCny: summary.peakCny,
      valleyCny: summary.valleyCny,
      // Saving vs peak pricing for traffic that ran during valley
      // (valley price = peak × factor → saved = valleyCny × (1/factor − 1)).
      valleySavedCny: summary.valleyCny * (1 / this.windowConfig.valleyFactor - 1),
      cacheSavedCny: summary.cacheSavedCny,
      unknownModelIds: summary.unknownModelIds,
      recordCount: summary.recordCount,
      lastTurn: records.reduce((max, record) => Math.max(max, record.turn), 0),
      byModel: summary.byModel,
    }
  }

  replace(input: {
    readonly nodes: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): CostReadout {
    this.nodes = new Map(input.nodes.map(node => [node.key, node]))
    return this.snapshot()
  }

  apply(input: {
    readonly upserts: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): CostReadout {
    for (const node of input.upserts) this.nodes.set(node.key, node)
    return this.snapshot()
  }
}

/** Registerable view definition for the 'cost' target. */
export function createSessionCostView(
  prices: PriceTable,
  windowConfig: PeakWindowConfig,
): ConversationViewDefinition<ConversationViewNode, CostReadout> {
  return {
    target: 'cost',
    create: () => new SessionCostViewBuilder(prices, windowConfig),
  }
}
