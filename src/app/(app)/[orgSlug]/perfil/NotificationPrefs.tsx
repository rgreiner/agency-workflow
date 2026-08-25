'use client'

import { Fragment, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/Switch'
import { MultiSelect } from '@/components/ui/Select'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { PushSettings } from '@/components/pwa/PushSettings'
import { setDigestEnabled, setNotificationPrefs } from '@/app/actions/profile'
import {
  EVENT_ROWS, isOn, statusValues,
  type CanalPrefs, type EventKey, type NotifPrefs,
} from '@/lib/notification-prefs'

/**
 * Seção "Notificações" do Perfil: grade evento × canal (caixa de entrada /
 * push), resumo diário por e-mail e o push do aparelho.
 *
 * O filtro de verdade é o trigger da migration 254 — aqui só se grava a
 * preferência (RPC set_notification_prefs) com estado otimista.
 * Modelo: push ⊂ caixa. Desligar a caixa desabilita o push da linha SEM
 * apagar a escolha (religar devolve como estava — o banco garante o resto).
 */
export function NotificationPrefs({ orgSlug, initialPrefs, digestEnabled }: {
  orgSlug: string
  initialPrefs: NotifPrefs
  digestEnabled: boolean
}) {
  const statusCfg = useStatusConfig()
  const [prefs, setPrefs] = useState<NotifPrefs>(initialPrefs)
  const [digest, setDigest] = useState(digestEnabled)
  const [, start] = useTransition()

  const statusOpts = statusCfg.map(s => ({ value: s.value, label: s.label }))

  function persist(next: NotifPrefs) {
    const prev = prefs
    setPrefs(next)  // otimista
    start(async () => {
      const r = await setNotificationPrefs(orgSlug, next)
      if (r?.error) { setPrefs(prev); toast.error(r.error) }
    })
  }

  function toggle(canal: 'inbox' | 'push', key: EventKey, on: boolean) {
    const c: CanalPrefs = { ...(prefs[canal] ?? {}) }
    if (key === 'status') c.status = on ? null : []  // null = todos · [] = nenhum
    else c[key] = on
    persist({ ...prefs, [canal]: c })
  }

  function setStatusList(canal: 'inbox' | 'push', vals: string[]) {
    const c: CanalPrefs = { ...(prefs[canal] ?? {}) }
    c.status = vals.length === 0 ? null : vals  // vazio no MultiSelect = todos
    persist({ ...prefs, [canal]: c })
  }

  function toggleDigest() {
    const next = !digest
    setDigest(next)  // otimista
    start(async () => {
      const r = await setDigestEnabled(next)
      if (r?.error) { setDigest(!next); toast.error(r.error) }
      else toast.success(next ? 'Resumo diário ligado.' : 'Resumo diário desligado.')
    })
  }

  return (
    <div className="px-6 py-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Notificações</p>

      {/* Grade evento × canal */}
      <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem] gap-x-1 items-center">
        <span />
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-center pb-1">Caixa</span>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-center pb-1">Push</span>

        {EVENT_ROWS.map(row => {
          const inboxOn = row.inboxLocked || isOn(prefs, 'inbox', row.key)
          const pushOn = isOn(prefs, 'push', row.key)
          return (
            <Fragment key={row.key}>
              <div className="py-2 min-w-0 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-700">{row.label}</p>
                <p className="text-[11px] text-gray-400 leading-snug">{row.desc}</p>
              </div>
              <div className="flex justify-center border-t border-gray-100 self-stretch items-center">
                {row.inboxLocked ? (
                  <span className="text-[10px] font-medium text-gray-400" title="Menções sempre caem na caixa de entrada">
                    Sempre
                  </span>
                ) : (
                  <Switch size="sm" checked={inboxOn} label={`${row.label} — caixa de entrada`}
                    onChange={v => toggle('inbox', row.key, v)} />
                )}
              </div>
              <div className="flex justify-center border-t border-gray-100 self-stretch items-center">
                <Switch size="sm" checked={inboxOn && pushOn} disabled={!inboxOn}
                  label={`${row.label} — push`}
                  onChange={v => toggle('push', row.key, v)} />
              </div>

              {/* Quais status: um seletor por canal ligado */}
              {row.hasStatusPicker && inboxOn && (
                <div className="col-span-3 pb-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 w-9 shrink-0">Caixa</span>
                    <MultiSelect values={statusValues(prefs, 'inbox')} onChange={v => setStatusList('inbox', v)}
                      options={statusOpts} allLabel="Todos os status" className="flex-1" />
                  </div>
                  {pushOn && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400 w-9 shrink-0">Push</span>
                      <MultiSelect values={statusValues(prefs, 'push')} onChange={v => setStatusList('push', v)}
                        options={statusOpts} allLabel="Todos os status" className="flex-1" />
                    </div>
                  )}
                </div>
              )}
            </Fragment>
          )
        })}
      </div>

      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
        Push só chega para o que também estiver ligado na caixa de entrada — e nos aparelhos ativados abaixo.
        Mudar aqui vale para os avisos novos; os antigos ficam como estão.
      </p>

      {/* Resumo diário por e-mail (canal à parte — não passa pela grade) */}
      <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700">Resumo diário por e-mail</p>
          <p className="text-[12px] text-gray-400 mt-0.5">Todo dia às 8h30: o que ficou atrasado, o que fazer hoje e as próximas datas. Só chega se você tiver algo pendente.</p>
        </div>
        <Switch checked={digest} onChange={toggleDigest} label="Resumo diário por e-mail" />
      </div>

      {/* Push do aparelho (some sozinho se o servidor não tem chave VAPID) */}
      <div className="mt-4">
        <PushSettings />
      </div>
    </div>
  )
}
