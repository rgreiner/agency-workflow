import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintToolbar } from '@/components/ui/PrintToolbar'
import { AGENCY, DOC_NF_NOTES } from '@/lib/agency'
import { formatBRL, parseMoney } from '@/lib/midia'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
function dataExtenso(d?: string | null): string {
  const base = d && d.length >= 10 ? d.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const [y, m, dia] = base.split('-')
  return `${AGENCY.cidade}, ${Number(dia)} de ${MESES[Number(m) - 1]} de ${y}`
}

interface Opcao { fornecedor_id?: string; n_orc?: string; pgto?: string; quant?: string; valor_unit?: string; selecionado?: boolean }
interface ItemOrc { nome?: string; descricao?: string; opcoes?: Opcao[] }

export default async function OrcamentoPrintPage({
  params,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
}) {
  const { orgSlug, producaoId } = await params
  const supabase = await createClient()

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (supabase as any).from('workspaces')
    .select('name, legal_name, trade_name, tax_id, finance_email, phone, address_street, address_number, address_complement, address_district, address_city, address_state, address_zip')
    .eq('id', p.workspace_id).single()

  let campanha = ''
  if (p.campaign_id) {
    const { data: c } = await supabase.from('campaigns').select('name').eq('id', p.campaign_id).single()
    campanha = c?.name ?? ''
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fornRaw } = await (supabase as any).from('fornecedores').select('id, name').eq('org_id', org.id)
  const fornMap = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(fornRaw ?? []).forEach((f: any) => fornMap.set(f.id, f.name))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any).from('org_settings').select('logo_url').eq('org_id', org.id).single()
  const logoUrl: string | null = settings?.logo_url ?? null

  const itens: ItemOrc[] = Array.isArray(p.detalhe?.itens) ? p.detalhe.itens : []

  const enderecoCliente = [
    ws?.address_street, ws?.address_number ? `nº ${ws.address_number}` : '', ws?.address_complement,
    ws?.address_district, [ws?.address_city, ws?.address_state].filter(Boolean).join('/'),
    ws?.address_zip ? `CEP: ${ws.address_zip}` : '',
  ].filter(Boolean).join(' - ')

  return (
    <div className="min-h-screen bg-gray-200">
      <PrintToolbar backHref={`/${orgSlug}/producao/orcamento/${producaoId}`} />

      <div className="py-6 flex justify-center">
        <div id="print-doc" className="bg-white shadow-sm w-[210mm] max-w-full p-[16mm] text-[12px] text-gray-800">
          {/* Cabeçalho */}
          <div className="flex items-start justify-between border-b border-gray-300 pb-4">
            <div className="flex items-center gap-3">
              {logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoUrl} alt={AGENCY.nome} className="h-14 w-auto object-contain" />
                : <div className="h-14 w-14 bg-black text-[#fff] flex items-center justify-center font-bold rounded">1a1</div>}
            </div>
            <div className="text-right leading-tight">
              <p className="font-bold text-[13px] text-gray-900">{AGENCY.nome}</p>
              <p className="text-gray-600">{AGENCY.razao}</p>
              <p className="text-gray-600">{AGENCY.endereco}</p>
              <p className="text-gray-600">{AGENCY.cnpjFone}</p>
            </div>
          </div>

          <h1 className="text-2xl font-light text-gray-900 mt-5 mb-5">Orçamento nº {p.numero ?? ''}</h1>

          {/* Cliente / Campanha / Título */}
          <div className="space-y-3 mb-6">
            <div className="flex gap-4">
              <span className="w-24 text-right font-semibold text-gray-500 shrink-0">Cliente</span>
              <div>
                <p className="font-bold text-gray-900">{ws?.name ?? '—'}</p>
                {ws?.legal_name && <p className="text-gray-600">{ws.legal_name}</p>}
                {enderecoCliente && <p className="text-gray-600">{enderecoCliente}</p>}
                {ws?.tax_id && <p className="text-gray-600">CNPJ: {ws.tax_id}</p>}
                {(ws?.finance_email || ws?.phone) && <p className="text-gray-600">{[ws?.phone, ws?.finance_email].filter(Boolean).join('  ')}</p>}
              </div>
            </div>
            {campanha && (
              <div className="flex gap-4"><span className="w-24 text-right font-semibold text-gray-500 shrink-0">Campanha</span><span>{campanha}</span></div>
            )}
            <div className="flex gap-4"><span className="w-24 text-right font-semibold text-gray-500 shrink-0">Título</span><span>{p.titulo}</span></div>
          </div>

          {/* Itens */}
          <div className="border-l-2 border-gray-400 pl-2 mb-3"><span className="font-semibold text-gray-700">Itens</span></div>
          {itens.map((it, i) => {
            const opcoes = it.opcoes ?? []
            return (
              <div key={i} className="mb-6">
                <p className="font-bold text-gray-900 mb-1">{it.nome || '—'}</p>
                {it.descricao && <p className="text-gray-600 whitespace-pre-line mb-2">{it.descricao}</p>}
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-1.5 font-semibold">Fornecedor</th>
                      <th className="py-1.5 font-semibold">Nº Orç.</th>
                      <th className="py-1.5 font-semibold">Pgto.</th>
                      <th className="py-1.5 font-semibold">Quant.</th>
                      <th className="py-1.5 font-semibold">Valor Unit.</th>
                      <th className="py-1.5 font-semibold">Valor Total</th>
                      <th className="py-1.5 w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {opcoes.map((o, j) => {
                      const total = (parseInt(o.quant || '1', 10) || 0) * parseMoney(o.valor_unit || '')
                      return (
                        <tr key={j} className="border-b border-gray-100">
                          <td className="py-1.5">{o.fornecedor_id ? (fornMap.get(o.fornecedor_id) ?? '—') : '—'}</td>
                          <td className="py-1.5">{o.n_orc || ''}</td>
                          <td className="py-1.5">{o.pgto || ''}</td>
                          <td className="py-1.5">{o.quant || ''}</td>
                          <td className="py-1.5">{formatBRL(parseMoney(o.valor_unit || ''))}</td>
                          <td className="py-1.5 font-semibold">{formatBRL(total)}</td>
                          <td className="py-1.5 text-emerald-600">{o.selecionado ? '✔' : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {/* Rodapé NF */}
          <div className="mt-8 space-y-1">
            {DOC_NF_NOTES.map((n, i) => (
              <p key={i} className={n.highlight ? 'bg-yellow-200 inline-block px-0.5 font-medium' : 'text-gray-700'}>{n.text}</p>
            ))}
          </div>

          {/* Data + assinaturas */}
          <p className="mt-10 text-gray-700">{dataExtenso(p.emissao)}</p>
          <div className="grid grid-cols-2 gap-10 mt-16">
            <div className="text-center"><div className="border-t border-gray-400 pt-1 text-gray-700">{AGENCY.razao}</div></div>
            <div className="text-center"><div className="border-t border-gray-400 pt-1 text-gray-700">{ws?.legal_name || ws?.name || ''}</div></div>
          </div>
        </div>
      </div>
    </div>
  )
}
