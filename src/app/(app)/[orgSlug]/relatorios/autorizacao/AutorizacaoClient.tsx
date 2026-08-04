'use client'

import { useRouter } from 'next/navigation'
import { FileText, Download, AlertTriangle, Megaphone, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { formatBRL } from '@/lib/midia'
import type { AutorizacaoData, AutorizacaoLinha } from '@/lib/pdf/autorizacao-data'

export interface ClienteOpcao { id: string; nome: string }

const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

/** Notas de veiculação digital (Google, Meta) só chegam depois da virada do
 *  mês — por isso a agência espera o dia 5 antes de fechar o relatório. */
function antesDoDia5(competencia: string): boolean {
  const hoje = new Date()
  const [y, m] = competencia.split('-').map(Number)
  const mesSeguinte = new Date(Date.UTC(y, m, 1))
  const liberaEm = new Date(Date.UTC(y, m, 5))
  return hoje >= mesSeguinte && hoje < liberaEm
}

export function AutorizacaoClient({ orgSlug, clientes, clienteId, competencia, dados }: {
  orgSlug: string; clientes: ClienteOpcao[]; clienteId: string | null
  competencia: string; dados: AutorizacaoData | null
}) {
  const router = useRouter()

  const ir = (patch: { cliente?: string; comp?: string }) => {
    const p = new URLSearchParams()
    p.set('cliente', patch.cliente ?? clienteId ?? '')
    p.set('comp', patch.comp ?? competencia)
    router.push(`/${orgSlug}/relatorios/autorizacao?${p.toString()}`)
  }

  const pdfUrl = clienteId
    ? `/api/docs/autorizacao?org=${orgSlug}&cliente=${clienteId}&comp=${competencia}`
    : null
  const vazio = !dados || (dados.midias.length === 0 && dados.producoes.length === 0)

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <FileText className="w-5 h-5 text-orange-600" /> Relatório de autorização
        </h1>
        <p className="text-gray-500 text-sm">
          A lista do mês que vai ao financeiro do cliente: o que não está aqui, ele confirma com a
          agência antes de pagar. Mídia entra pela veiculação, produção pela emissão.
        </p>
      </div>

      <div className="flex items-end gap-3 mb-5 flex-wrap">
        <div className="w-72">
          <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
          <Select value={clienteId ?? ''} onChange={v => ir({ cliente: v })}
            options={clientes.map(c => ({ value: c.id, label: c.nome }))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Competência</label>
          <input type="month" value={competencia} onChange={e => ir({ comp: e.target.value })}
            className="px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        {pdfUrl && !vazio && (
          <a href={pdfUrl} download
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition active:scale-[0.97]">
            <Download className="w-4 h-4" /> Baixar PDF
          </a>
        )}
      </div>

      {antesDoDia5(competencia) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-5">
          <p className="text-sm font-medium text-amber-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Ainda não é dia 5
          </p>
          <p className="text-xs text-amber-800 mt-1">
            As notas de veiculação digital (Google, Meta) costumam chegar nos primeiros dias do mês
            seguinte. Gerando agora, elas podem ficar de fora.
          </p>
        </div>
      )}

      {/* O buraco do filtro "só faturado": documento da competência que não foi
        * faturado a tempo sumiria calado, e a competência dele não volta. */}
      {dados && dados.pendentes.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-5">
          <p className="text-sm font-medium text-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-gray-400" />
            {dados.pendentes.length} documento(s) desta competência ficaram de fora
          </p>
          <p className="text-xs text-gray-500 mt-1 mb-2">
            Só entra o que está faturado. Fature antes de gerar, ou eles não aparecerão em
            relatório nenhum — a competência não volta.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {dados.pendentes.map(p => (
              <span key={p.doc + p.titulo}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-100 text-xs text-gray-600">
                <strong className="text-gray-800">{p.doc}</strong>
                <span className="truncate max-w-[220px]">{p.titulo}</span>
                <span className="text-gray-400">{p.situacao.replace('_', ' ')}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!dados ? (
        <p className="text-sm text-gray-400 py-12 text-center bg-white rounded-2xl border border-gray-200">
          Escolha um cliente para ver o relatório.
        </p>
      ) : vazio ? (
        <p className="text-sm text-gray-400 py-12 text-center bg-white rounded-2xl border border-gray-200">
          Nada faturado para {dados.cliente} em {dados.competenciaLabel}.
        </p>
      ) : (
        <div className="space-y-5">
          <Secao titulo="Mídias veiculadas no mês" icone={<Megaphone className="w-4 h-4 text-gray-400" />}
            linhas={dados.midias} total={dados.totalMidia} coluna="veiculacao" />
          <Secao titulo="Produções emitidas no mês" icone={<ClipboardList className="w-4 h-4 text-gray-400" />}
            linhas={dados.producoes} total={dados.totalProducao} coluna="emissao" />

          <div className="flex items-center justify-end gap-4 px-4 py-3 rounded-2xl bg-gray-900 text-[#fff]">
            <span className="text-sm">Total de {dados.competenciaLabel}</span>
            <span className="text-lg font-semibold tabular-nums">{formatBRL(dados.total)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, icone, linhas, total, coluna }: {
  titulo: string; icone: React.ReactNode; linhas: AutorizacaoLinha[]
  total: number; coluna: 'veiculacao' | 'emissao'
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 py-3 border-b border-gray-100">
        {icone}
        <h2 className="text-sm font-semibold text-gray-700">{titulo}</h2>
        <span className="text-xs text-gray-400">{linhas.length} documento(s)</span>
        <span className="ml-auto text-sm font-medium text-gray-900 tabular-nums">{formatBRL(total)}</span>
      </div>
      {linhas.length === 0 ? (
        <p className="text-xs text-gray-400 px-4 py-6 text-center">Nada faturado nesta competência.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                <th className="py-2 pl-4 font-medium w-20">Doc.</th>
                <th className="py-2 px-2 font-medium">Título</th>
                <th className="py-2 px-2 font-medium w-40">{coluna === 'veiculacao' ? 'Veículo' : 'Fornecedor'}</th>
                <th className="py-2 px-2 font-medium w-20">Prazo</th>
                <th className="py-2 px-2 font-medium text-right w-28">Investimento</th>
                <th className="py-2 pr-4 font-medium text-right w-40">
                  {coluna === 'veiculacao' ? 'Veiculação' : 'Emissão'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {linhas.map(l => (
                <tr key={l.id}>
                  <td className="py-2 pl-4"><span className="text-xs font-medium text-gray-900">{l.doc}</span></td>
                  <td className="py-2 px-2 text-gray-800">{l.titulo}</td>
                  <td className="py-2 px-2 text-gray-500">{l.parceiro}</td>
                  <td className="py-2 px-2 text-gray-500 text-xs">{l.prazo}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-gray-900">{formatBRL(l.valor)}</td>
                  <td className={cn('py-2 pr-4 text-right tabular-nums text-xs text-gray-500')}>
                    {coluna === 'veiculacao'
                      ? `${dataBR(l.primeira)} a ${dataBR(l.ultima)}`
                      : dataBR(l.emissao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
