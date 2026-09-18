'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPinOff, Check, X, ExternalLink, Wifi, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { decidirMarcacaoFora } from '@/app/actions/rh-ponto'
import { salvarLocal, type LocalRh } from '@/app/actions/rh-local'
import { Select } from '@/components/ui/Select'

export interface MarcacaoFora {
  marcacao_id: string; data: string; hora: string; seq: number
  colaborador_id: string; nome: string; cargo: string | null
  lat: number | null; lon: number | null; ip: string | null
  motivo: string | null; status: string
}

export interface RedeGrupo {
  ip: string; primeira: string; ultima: string
  marcacoes: number; pessoas: number; cadastrado: boolean
}

const dataBR = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }
const faixa = (de: string, ate: string) => (de === ate ? dataBR(de) : `${dataBR(de)} a ${dataBR(ate)}`)

/** "25/08" ou "25/08 a 27/08" — o período que aquele IP apareceu. */
function periodo(lista: MarcacaoFora[]) {
  const datas = lista.map(l => l.data).sort()
  const de = dataBR(datas[0]), ate = dataBR(datas[datas.length - 1])
  return de === ate ? de : `${de} a ${ate}`
}

/** Cadastra um IP num local ativo: as próximas batidas dessa rede entram como
 *  dentro. Compartilhado pela fila (IP de duas pessoas) e pelas redes da equipe. */
function useCadastrarIp(orgSlug: string, locais: LocalRh[]) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const ativos = useMemo(() => locais.filter(l => l.ativo), [locais])
  const [destinoId, setDestinoId] = useState('')
  const destino = ativos.find(l => l.id === destinoId) ?? ativos[0]

  function cadastrarIp(ip: string) {
    if (!destino) return
    if (destino.ips.includes(ip)) { toast.info(`${ip} já está em ${destino.nome}.`); return }
    start(async () => {
      const r = await salvarLocal(orgSlug, destino.id, {
        nome: destino.nome, ips: [...destino.ips, ip],
        lat: destino.lat, lon: destino.lon, raio_m: destino.raio_m, ativo: destino.ativo,
      })
      if (r?.error) { toast.error(r.error); return }
      toast.success(`${ip} cadastrado em ${destino.nome}.`, {
        description: 'As próximas batidas dessa rede já entram como dentro.',
      })
      router.refresh()
    })
  }

  return { ativos, destino, setDestinoId, cadastrarIp, pending }
}

/**
 * Redes que a própria equipe provou ser o escritório (3+ pessoas no mesmo IP no
 * mesmo dia, mig. 284). É configuração, não fila: mora no painel recolhível.
 */
export function RedesDaEquipe({ orgSlug, redes, locais = [] }: {
  orgSlug: string; redes: RedeGrupo[]; locais?: LocalRh[]
}) {
  const { destino, cadastrarIp, pending } = useCadastrarIp(orgSlug, locais)
  if (redes.length === 0) return null
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
        <Wifi className="w-4 h-4" /> Redes reconhecidas pela equipe <span className="text-gray-400">{redes.length}</span>
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Três pessoas ou mais batendo do mesmo IP no mesmo dia contam como escritório, mesmo sem cadastro.
        É o que segura o dia em que o provedor troca o IP. Se alguma dessas redes <b>não</b> for a agência
        (um time inteiro num cliente, por exemplo), é aqui que dá pra ver.
      </p>
      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
        {redes.map(r => (
          <div key={r.ip} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 tabular-nums">
              <Wifi className="w-3.5 h-3.5 text-gray-400" /> {r.ip}
            </span>
            <span className="text-xs text-gray-500">
              {r.marcacoes} marcaç{r.marcacoes === 1 ? 'ão' : 'ões'} · {r.pessoas} pessoas · {faixa(r.primeira, r.ultima)}
            </span>
            <div className="flex-1" />
            {r.cadastrado ? (
              <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded-lg px-2 py-1">no cadastro</span>
            ) : destino && (
              <button onClick={() => cadastrarIp(r.ip)} disabled={pending}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 active:scale-[0.97] disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                Fixar em {destino.nome}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export function FilaForaLocal({ orgSlug, itens, locais = [] }: {
  orgSlug: string; itens: MarcacaoFora[]
  /** Locais cadastrados — para cadastrar de uma vez o IP que trocou. */
  locais?: LocalRh[]
}) {
  const router = useRouter()
  const { ativos, destino, setDestinoId, cadastrarIp, pending: cadastrando } = useCadastrarIp(orgSlug, locais)
  const [decidindo, start] = useTransition()
  const pending = cadastrando || decidindo

  /**
   * Agrupa por IP, e só mostra IP com mais de uma pessoa. Uma pessoa só é home
   * office; várias no mesmo IP é o IP público do escritório que mudou — aí a
   * rede deixa de ser reconhecida e o time inteiro cai nesta fila. Foi o que
   * aconteceu em 25/08, 31/08 e 08/09 (medido em produção, 11/09/2026).
   */
  const gruposIp = useMemo(() => {
    const porIp = new Map<string, MarcacaoFora[]>()
    for (const it of itens) {
      if (!it.ip) continue
      porIp.set(it.ip, [...(porIp.get(it.ip) ?? []), it])
    }
    return [...porIp.entries()]
      .map(([ip, lista]) => ({ ip, lista, pessoas: new Set(lista.map(l => l.colaborador_id)).size }))
      .filter(g => g.pessoas > 1)
      .sort((a, b) => b.lista.length - a.lista.length)
  }, [itens])

  function decidir(id: string, status: string) {
    start(async () => {
      const r = await decidirMarcacaoFora(orgSlug, id, status)
      if (r?.error) toast.error(r.error)
      else { toast.success(status === 'aprovado' ? 'Marcação validada.' : 'Marcação marcada como irregular.'); router.refresh() }
    })
  }

  /** Valida em lote as marcações de um IP (em blocos, pra não abrir 60 chamadas de uma vez). */
  function validarLote(lista: MarcacaoFora[]) {
    start(async () => {
      let erro: string | null = null
      for (let i = 0; i < lista.length; i += 8) {
        const rs = await Promise.all(lista.slice(i, i + 8).map(m => decidirMarcacaoFora(orgSlug, m.marcacao_id, 'aprovado')))
        erro ??= rs.find(r => r?.error)?.error ?? null
      }
      if (erro) toast.error(erro)
      else toast.success(`${lista.length} marcações validadas.`)
      router.refresh()
    })
  }

  const escolherLocal = ativos.length > 1 && (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Cadastrar em</span>
      <Select value={destino?.id ?? ''} onChange={setDestinoId} size="sm" className="w-44"
        options={ativos.map(l => ({ value: l.id, label: l.nome }))} />
    </div>
  )

  return (
    <section>
      {itens.length === 0 ? (
        <h2 className="text-sm font-medium text-gray-400 flex items-center gap-1.5">
          <MapPinOff className="w-4 h-4" /> Batidas fora dos locais · nada pendente
        </h2>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <MapPinOff className="w-4 h-4" /> Batidas fora dos locais <span className="text-gray-400">{itens.length}</span>
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            As horas <b>já contam</b> — isto aqui é conferência, não liberação. Para corrigir o horário
            de fato, use o editor no espelho da pessoa.
          </p>

          {gruposIp.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 mb-3">
              <p className="text-xs text-amber-900">
                <b>Duas pessoas bateram do mesmo IP.</b> Costuma ser o IP público do escritório que mudou.
                A partir de três pessoas o Flow reconhece sozinho; com duas, a chamada é sua.
              </p>
              {escolherLocal && <div className="mt-3">{escolherLocal}</div>}
              <div className="mt-3 space-y-2">
                {gruposIp.map(g => (
                  <div key={g.ip} className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 tabular-nums">
                      <Wifi className="w-3.5 h-3.5 text-amber-700" /> {g.ip}
                    </span>
                    <span className="text-xs text-gray-600">
                      {g.lista.length} marcaç{g.lista.length === 1 ? 'ão' : 'ões'} · {g.pessoas} pessoas · {periodo(g.lista)}
                    </span>
                    <div className="flex-1" />
                    {destino && (
                      <button onClick={() => cadastrarIp(g.ip)} disabled={pending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-[#fff] hover:bg-amber-700 disabled:opacity-50 transition-colors">
                        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                        Cadastrar em {destino.nome}
                      </button>
                    )}
                    <button onClick={() => validarLote(g.lista)} disabled={pending}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                      <Check className="w-3.5 h-3.5" /> Validar as {g.lista.length}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-amber-800/80 mt-3">
                Cadastrar vale para as próximas batidas. As que já estão na fila continuam aqui até
                serem validadas. O editor do local aceita faixa (/24), se o provedor trocar o número final.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {itens.map(m => (
              <div key={m.marcacao_id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {m.nome} <span className="text-gray-400 font-normal tabular-nums">{dataBR(m.data)} às {m.hora}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                    {m.lat != null && m.lon != null ? (
                      <a href={`https://www.google.com/maps?q=${m.lat},${m.lon}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-orange-700 hover:text-orange-800 transition-colors">
                        ver no mapa <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-gray-400">sem localização (permissão negada)</span>
                    )}
                    {m.ip && <span className="tabular-nums text-gray-400">IP {m.ip}</span>}
                    {m.motivo && <span className="text-gray-600">· {m.motivo}</span>}
                  </div>
                </div>
                <button onClick={() => decidir(m.marcacao_id, 'aprovado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  <Check className="w-3.5 h-3.5" /> Validar
                </button>
                <button onClick={() => decidir(m.marcacao_id, 'rejeitado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  <X className="w-3.5 h-3.5" /> Irregular
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
