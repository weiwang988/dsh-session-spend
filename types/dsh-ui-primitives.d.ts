/**
 * Offline type mirror: the Tooltip primitive (ui-primitives API actually used
 * by the StatsLine precedent: label/side/delayMs/disabled + children).
 */

import type { ReactNode } from 'react'

export interface TooltipProps {
  readonly label: string
  readonly side?: 'top' | 'bottom' | 'left' | 'right'
  readonly delayMs?: number
  readonly disabled?: boolean
  readonly children: ReactNode
}

export declare function Tooltip(props: TooltipProps): ReactNode
