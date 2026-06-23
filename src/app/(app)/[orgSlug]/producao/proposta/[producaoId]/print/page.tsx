import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintToolbar } from '@/components/ui/PrintToolbar'
import { AGENCY } from '@/lib/agency'
import { formatBRL, formatDateBR, parseMoney } from '@/lib/midia'

const TIPO_LABEL: Record<string, string> = { midia: 'Mídia', producao: 'Produção', servico_interno: 'Serviço Interno', fee: 'Fee' }
interface ItemP { tipo?: string; nome?: string; quantidade?: string; valor_unit?: string; desconto?: string; situacao?: string }
const itemValor = (it: ItemP) => (parseInt(it.quantidade || '1', 10) || 0) * parseMoney(it.valor_unit || '') * (1 - parseMoney(it.desconto || '') / 100)

export default async function PropostaPrintPage({
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
  const { data: ws } = await (supabase as any).from('workspaces').select('name, legal_name, tax_id').eq('id', p.workspace_id).single()
  let campanha = ''
  if (p.campaign_id) { const { data: c } = await supabase.from('campaigns').select('name').eq('id', p.campaign_id).single(); campanha = c?.name ?? '' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any).from('org_settings').select('logo_url').eq('org_id', org.id).single()
  const logoUrl: string | null = settings?.logo_url ?? null

  const det = (p.detalhe ?? {}) as { introducao?: string; itens?: ItemP[] }
  const itens: ItemP[] = Array.isArray(det.itens) ? det.itens : []
  const total = itens.reduce((s, it) => s + itemValor(it), 0)

  return (
    <div className="min-h-screen bg-gray-200">
      <PrintToolbar backHref={`/${orgSlug}/producao/proposta/${producaoId}`} />
      <div className="py-6 flex justify-center">
        <div id="print-doc" className="bg-white shadow-sm w-[210mm] max-w-full p-[16mm] text-[12px] text-gray-800">
          <div className="flex items-start justify-between border-b border-gray-300 pb-4">
            {logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logoUrl} alt={AGENCY.nome} className="h-14 w-auto object-contain" />
              : <div className="h-14 w-14 bg-black text-[#fff] flex items-center justify-center font-bold rounded">1a1</div>}
            <div className="text-right leading-tight">
              <p className="font-bold text-[13px] text-gray-900">{AGENCY.nome}</p>
              <p className="text-gray-600">{AGENCY.razao}</p>
              <p className="text-gray-600">{AGENCY.endereco}</p>
              <p className="text-gray-600">{AGENCY.cnpjFone}</p>
            </div>
          </div>

          <h1 className="text-2xl font-light text-gray-900 mt-5 mb-1">Proposta nº {p.numero ?? ''}</h1>
          <p className="text-gray-700 mb-5">{ws?.name}{campanha ? ` · ${campanha}` : ''} — {p.titulo}</p>

          {det.introducao && <p className="text-gray-700 whitespace-pre-line mb-6">{det.introducao}</p>}

          <div className="border-l-2 border-gray-400 pl-2 mb-2"><span className="font-semibold text-gray-700">Itens</span></div>
          <table className="w-full border-collapse mb-5">
            <thead><tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-1.5 font-semibold">Tipo</th><th className="py-1.5 font-semibold">Item</th>
              <th className="py-1.5 font-semibold text-right">Qtd.</th><th className="py-1.5 font-semibold text-right">Total</th>
            </tr></thead>
            <tbody>
              {itens.map((it, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1.5">{TIPO_LABEL[it.tipo ?? ''] ?? it.tipo}</td>
                  <td className="py-1.5">{it.nome}</td>
                  <td className="py-1.5 text-right">{it.quantidade}</td>
                  <td className="py-1.5 text-right font-medium">{formatBRL(itemValor(it))}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2" colSpan={3}>Total</td><td className="py-2 text-right">{formatBRL(total)}</td></tr>
            </tbody>
          </table>

          {p.observacao && <p className="text-gray-600 whitespace-pre-line mb-2">{p.observacao}</p>}
          {p.texto_legal && <p className="text-gray-500 whitespace-pre-line text-[11px] mb-2">{p.texto_legal}</p>}

          <p className="mt-8 text-gray-700">{AGENCY.cidade}, {formatDateBR(p.emissao)}</p>
          <div className="grid grid-cols-2 gap-10 mt-16">
            <div className="text-center"><div className="border-t border-gray-400 pt-1 text-gray-700">{AGENCY.razao}</div></div>
            <div className="text-center"><div className="border-t border-gray-400 pt-1 text-gray-700">{ws?.legal_name || ws?.name || ''}</div></div>
          </div>
        </div>
      </div>
    </div>
  )
}
