'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Settings2, ChevronDown, CalendarClock, Lock, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/Switch'
import { setPontoObrigatorio } from '@/app/actions/rh-ponto'
import { LocaisPonto } from '@/components/rh/LocaisPonto'
import { RedesDaEquipe, type RedeGrupo } from '@/components/rh/FilaForaLocal'
import type { LocalRh } from '@/app/actions/rh-local'
import { JornadaEditor, normalizar, type JornadaVals } from '../JornadaEditor'
import { ImportarPontomais } from './ImportarPontomais'

const DOW = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
function diasLabel(d: number[]): string {
  const k = [...d].sort((a, b) => a - b).join()
  if (k === '1,2,3,4,5') return 'seg a sex'
  if (k === '1,2,3,4,5,6') return 'seg a sáb'
  return d.map(x => DOW[x]).join(', ')
}

/**
 * Configuração do ponto, recolhida por padrão.
 *
 * A tela é de APROVAÇÃO: as filas eram o trabalho do dia e ficavam abaixo de
 * ~900px de parâmetros que se mexem uma vez por ano. Fechado, o painel vira uma
 * linha que ainda mostra o essencial (trava ligada? que jornada vale?) — dá para
 * conferir sem abrir. Começa aberto só quando falta configurar a jornada padrão.
 */
export function ConfiguracaoPonto({ orgSlug, pontoObrigatorio, jornadaPadrao, locais, ipAtual, redesGrupo }: {
  orgSlug: string
  pontoObrigatorio: boolean
  jornadaPadrao: Partial<JornadaVals> | null
  locais: LocalRh[]
  ipAtual: string | null
  redesGrupo: RedeGrupo[]
}) {
  const router = useRouter()
  const painelId = useId()
  const [aberto, setAberto] = useState(!jornadaPadrao)
  const [obrig, setObrig] = useState(pontoObrigatorio)
  const [pending, start] = useTransition()

  function trocarObrigatorio(v: boolean) {
    setObrig(v)
    start(async () => {
      const r = await setPontoObrigatorio(orgSlug, v)
      if (r?.error) { toast.error(r.error); setObrig(!v); return }
      toast.success(v ? 'A partir de agora o Flow exige ponto batido.' : 'Trava desligada.')
      router.refresh()
    })
  }

  // O resumo da linha fechada: só o que responde "está configurado certo?".
  const j = jornadaPadrao ? normalizar(jornadaPadrao) : null
  const carga = j ? (toMin(j.intervalo_ini) - toMin(j.entrada)) + (toMin(j.saida) - toMin(j.intervalo_fim)) : 0
  const ativos = locais.filter(l => l.ativo)
  const resumo: { txt: string; alerta?: boolean }[] = [
    { txt: obrig ? 'ponto obrigatório ligado' : 'ponto obrigatório desligado' },
    j
      ? { txt: `jornada ${j.entrada}–${j.saida}, ${hm(carga)} de ${diasLabel(j.dias_semana)}` }
      : { txt: 'jornada padrão não definida', alerta: true },
    { txt: ativos.length === 0 ? 'nenhum local' : ativos.length === 1 ? `local: ${ativos[0].nome}` : `${ativos.length} locais` },
    ...(redesGrupo.length ? [{ txt: `${redesGrupo.length} rede${redesGrupo.length > 1 ? 's' : ''} da equipe` }] : []),
  ]

  return (
    <section className="mb-8 rounded-2xl bg-gray-50">
      <button type="button" onClick={() => setAberto(a => !a)}
        aria-expanded={aberto} aria-controls={painelId}
        className={cn(
          'group w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
          aberto ? 'rounded-t-2xl' : 'rounded-2xl',
        )}>
        <Settings2 className="w-4 h-4 mt-px text-gray-400 shrink-0" />
        <span className="flex-1 min-w-0 text-xs leading-5 text-gray-500">
          <span className="font-semibold text-gray-700 mr-1.5">Configuração do ponto</span>
          {resumo.map((r, i) => (
            <span key={i} className={r.alerta ? 'text-amber-700 font-medium' : undefined}>
              {i > 0 && ' · '}{r.txt}
            </span>
          ))}
        </span>
        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium leading-5 text-gray-500 group-hover:text-gray-800 transition-colors">
          {aberto ? 'Recolher' : 'Editar'}
          <ChevronDown className={cn('w-4 h-4 transition-transform duration-200 ease-out motion-reduce:transition-none', aberto && 'rotate-180')} />
        </span>
      </button>

      {/* grid 0fr→1fr anima a altura real sem medir nada; `inert` tira o painel
          fechado do Tab e do leitor de tela. Os modais internos são `fixed`,
          então o overflow-hidden não os corta. */}
      <div id={painelId}
        className={cn('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          aberto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden" inert={!aberto || undefined}>
          <div className="px-4 pb-5 pt-2 space-y-7">

            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4" /> Jornada padrão da empresa
              </h2>
              <p className="text-xs text-gray-400 mb-3">
                O modelo aplicado a quem não tem jornada personalizada. Personalização por pessoa fica na ficha.
              </p>
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <JornadaEditor orgSlug={orgSlug} colaboradorId={null} inicial={jornadaPadrao} />
              </div>
            </section>

            {/* Mesmo interruptor das outras chaves do app (ficha, preferências). */}
            <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <Lock className="w-4 h-4" /> Exigir ponto batido para usar o Flow
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Ligada, quem tem ficha e jornada no dia vê uma tela de “bata o ponto para começar” — com o
                  botão que resolve ali mesmo. Não vale em feriado que abona, em dia fora da escala, nem para
                  quem não tem ficha.{!obrig && ' Ligue no dia em que o time sair do Pontomais de vez.'}
                </p>
              </div>
              <Switch checked={obrig} onChange={trocarObrigatorio} disabled={pending}
                label="Exigir ponto batido para usar o Flow" />
            </section>

            <LocaisPonto orgSlug={orgSlug} locais={locais} ipAtual={ipAtual} />
            <RedesDaEquipe orgSlug={orgSlug} redes={redesGrupo} locais={locais} />

            <section className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <Upload className="w-4 h-4" /> Histórico do Pontomais
                </h2>
                <p className="text-xs text-gray-400 mt-1">Traz os dias de um relatório em PDF do Pontomais.</p>
              </div>
              <ImportarPontomais orgSlug={orgSlug} />
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}
