'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyHealthFix } from '@/app/actions/health'
import type { HealthCheck, HealthItem } from '@/lib/health/checks'

export function SaudeClient({ orgSlug, checks }: { orgSlug: string; checks: HealthCheck[] }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const totalPendencias = checks.reduce((n, c) => n + c.items.length, 0)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Verificações de consistência</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Divergências que ninguém percebeu (não são erros técnicos) — cada uma com a correção à mão.
          </p>
        </div>
        <button onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Reverificar
        </button>
      </div>

      {totalPendencias === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Tudo consistente</h3>
          <p className="text-gray-500 text-sm mt-1">Nenhuma divergência encontrada nas verificações.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {checks.map(c => <CheckCard key={c.id} orgSlug={orgSlug} check={c} />)}
        </div>
      )}
    </div>
  )
}

function CheckCard({ orgSlug, check }: { orgSlug: string; check: HealthCheck }) {
  const ok = check.items.length === 0
  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100 flex items-start gap-3">
        {ok
          ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
          : <span className="mt-0.5 shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">{check.items.length}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{check.label}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{check.description}</p>
        </div>
      </header>

      {ok ? (
        <p className="px-4 py-3 text-xs text-gray-400">Nenhuma pendência.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {check.items.map(item => (
            <ItemRow key={item.id} orgSlug={orgSlug} item={item} fixLabel={check.fixLabel} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ItemRow({ orgSlug, item, fixLabel }: { orgSlug: string; item: HealthItem; fixLabel?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)

  function corrigir() {
    if (!item.fix) return
    start(async () => {
      const res = await applyHealthFix(orgSlug, item.fix!)
      if (res?.error) { toast.error(res.error); return }
      // "Corrigido" só quando corrigiu mesmo. Se a subpasta não existe no Drive, o
      // item continua na lista — dizer que deu certo faria a pessoa clicar em loop.
      // Criou subpasta = corrigiu (sucesso). Continua faltando = alerta, e o item
      // permanece na lista — dizer "Corrigido" faria a pessoa clicar em loop.
      if (res?.aviso?.startsWith('Criei')) { setDone(true); toast.success(res.aviso); router.refresh(); return }
      if (res?.aviso) { toast.warning(res.aviso); router.refresh(); return }
      setDone(true)
      toast.success('Corrigido.')
      router.refresh()
    })
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {item.href
          ? <a href={item.href} className="text-sm text-gray-800 hover:text-orange-600 transition-colors truncate block">{item.label}</a>
          : <p className="text-sm text-gray-800 truncate">{item.label}</p>}
        {item.sublabel && <p className="text-xs text-gray-400 truncate">{item.sublabel}</p>}
      </div>

      {item.fix && (
        <button onClick={corrigir} disabled={pending || done}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors active:scale-[0.97]',
            done ? 'text-emerald-600 bg-emerald-50' : 'text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50',
          )}>
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Wrench className="w-3.5 h-3.5" />}
          {done ? 'Feito' : fixLabel ?? 'Corrigir'}
        </button>
      )}
    </li>
  )
}
