/**
 * Cost view target: folds the Definition's Nodes into one readout snapshot.
 *
 * Chunk sample and finalized message arrive as two nodes for one (turn, step);
 * the builder keeps the node with the greater seq (the finalized message web)
 * and prices every kept record at its own billing instant. The engine rebuilds
 * the complete node set on window replace, so paging and replay can never
 * double-count.
 */

import type {
  ConversationTimelineSnapshot, ConversationViewBuilder, ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CostNodeData } from './definition.ts'
import { computeCost, type ModelCostShare } from '../core/cost.ts'
import type { StepRecord } from '../core/fold.ts'
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

const stepKeyOf = (data: CostNodeData): string => `${data.turn}:${data.step}`

/** Builder-local fold over the current node set (chunk→message last-wins). */
export class SessionCostViewBuilder implements ConversationViewBuilder<ConversationViewNode, CostReadout> {
  readonly empty: CostReadout = EMPTY_READOUT
  /** step key → the winning (latest-seq) node's data. */
  private won: Map<string, CostNodeData> = new Map()
  private readonly prices: PriceTable
  private readonly windowConfig: PeakWindowConfig

  constructor(prices: PriceTable, windowConfig: PeakWindowConfig) {
    this.prices = prices
    this.windowConfig = windowConfig
  }

  private absorb(nodes: readonly ConversationViewNode[]): void {
    for (const node of nodes) {
      const data = node.data as CostNodeData
      const key = stepKeyOf(data)
      const existing = this.won.get(key)
      if (existing === undefined || existing.seq < data.seq) {
        this.won.set(key, data)
      }
    }
  }

  private snapshot(): CostReadout {
    const records: StepRecord[] = []
    let lastTurn = 0
    for (const data of this.won.values()) {
      if (data.turn > lastTurn) lastTurn = data.turn
      records.push({
        turn: data.turn,
        step: data.step,
        time: data.time,
        ...(data.model === undefined ? {} : { model: data.model }),
        usage: data.usage,
      })
    }
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
      lastTurn,
      byModel: summary.byModel,
    }
  }

  replace(input: {
    readonly nodes: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): CostReadout {
    this.won = new Map()
    this.absorb(input.nodes)
    return this.snapshot()
  }

  apply(input: {
    readonly upserts: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): CostReadout {
    this.absorb(input.upserts)
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
