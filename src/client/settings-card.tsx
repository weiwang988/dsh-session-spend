/**
 * Settings page card for the `session-cost` namespace: the editable price
 * table (peak ¥/1M per model) and the valley factor. Writes go through the
 * settings scope (field-level set/unset); the host half re-reads the section
 * on every summary request, so edits take effect on the next turn edge.
 */

import { memo, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CONFIG_FIELDS, type SessionCostConfig } from '../config.ts'
import { NS } from './locales.ts'

export interface SessionCostCardProps extends PropsLocale<typeof NS> {
  readonly scope: SettingsScope<SessionCostConfig>
}

interface FieldSpec {
  readonly key: keyof SessionCostConfig
  readonly label: string
}

const MODEL_GROUPS: ReadonlyArray<{ readonly model: string; readonly fields: readonly FieldSpec[] }> = [
  {
    model: 'deepseek-v4-flash',
    fields: [
      { key: 'flashCacheHit', label: '缓存命中' },
      { key: 'flashCacheMiss', label: '缓存未命中' },
      { key: 'flashOutput', label: '输出' },
    ],
  },
  {
    model: 'deepseek-v4-pro',
    fields: [
      { key: 'proCacheHit', label: '缓存命中' },
      { key: 'proCacheMiss', label: '缓存未命中' },
      { key: 'proOutput', label: '输出' },
    ],
  },
  {
    model: 'deepseek-v4-flash-vision-exp',
    fields: [
      { key: 'visionCacheHit', label: '缓存命中' },
      { key: 'visionCacheMiss', label: '缓存未命中' },
      { key: 'visionOutput', label: '输出' },
    ],
  },
]

export const SessionCostCard = memo(function SessionCostCard({ scope, t }: SessionCostCardProps) {
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<SessionCostConfig> | null>(null)
  useEffect(() => {
    const refresh = (): void => { setSnapshot(scope.getSnapshot()) }
    refresh()
    return scope.subscribe(refresh)
  }, [scope])

  // 'ready' + defined value: the namespace is served and holds an accepted
  // section; loading/unavailable and pre-acceptance stay hidden.
  if (snapshot === null || snapshot.status !== 'ready' || snapshot.value === undefined) return null
  const value = snapshot.value
  const user = snapshot.user as Record<string, unknown> | undefined
  const writable = snapshot.writable

  const update = (field: string, text: string): void => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return
    void scope.set(field, parsed)
  }
  const reset = (): void => {
    for (const field of CONFIG_FIELDS) {
      if (user?.[field] !== undefined) void scope.unset(field)
    }
  }

  const overridden = CONFIG_FIELDS.some(field => user?.[field] !== undefined)
  const rateField = (field: keyof SessionCostConfig, label: string): JSX.Element => (
    <label key={field} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 12 }}>
      <span>{label}</span>
      <input
        type="number"
        step="any"
        disabled={!writable}
        defaultValue={Number(value[field])}
        key={`${field}:${String(value[field])}`}
        onChange={event => update(field, event.target.value)}
        style={{ width: 90 }}
      />
    </label>
  )

  return (
    <section>
      <h4>{t('card.title')}</h4>
      {!writable ? <p>{t('card.readonly')}</p> : null}
      {MODEL_GROUPS.map(group => (
        <div key={group.model}>
          <strong>{group.model}</strong>
          <div>{group.fields.map(spec => rateField(spec.key, spec.label))}</div>
        </div>
      ))}
      <div>
        {rateField('valleyFactor', t('card.valleyFactor'))}
        <span>{t('card.valleyFactorHint')}</span>
      </div>
      <p>
        {overridden ? (
          <button type="button" onClick={reset} disabled={!writable}>
            {t('card.reset')}
          </button>
        ) : null}
        {' '}
        {t('card.hint')}
      </p>
    </section>
  )
})
