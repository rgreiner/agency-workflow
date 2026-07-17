import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintToolbar } from '@/components/ui/PrintToolbar'
import { loadOrgDocs } from '@/lib/agency'
import { formatBRL, formatDateBR } from '@/lib/midia'

interface ItemPed { nome?: string; descricao?: string; n_orc?: string; quant?: string; valor?: string }

const FATURAR_LABEL: Record<string, string> = { contra_cliente: 'Contra o Cliente', contra_agencia: 'Contra a Agência' }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4"><span className="w-24 text-right font-semibold text-gray-500 shrink-0">{label}</span><div className="flex-1">{children}</div></div>
  )
}

export default async function PedidoPrintPage({
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
    .select('name, legal_name, tax_id, finance_email, phone, address_street, address_number, address_complement, address_district, address_city, address_state, address_zip')
    .eq('id', p.workspace_id).single()

  const det = (p.detalhe ?? {}) as { fornecedor_id?: string; entrega?: string; itens?: ItemPed[] }
  let forn: { name?: string; tax_id?: string; notes?: string } | null = null
  if (det.fornecedor_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('fornecedores').select('name, tax_id, notes').eq('id', det.fornecedor_id).single()
    forn = data
  }
  let campanha = ''
  if (p.campaign_id) {
    const { data: c } = await supabase.from('campaigns').select('name').eq('id', p.campaign_id).single()
    campanha = c?.name ?? ''
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any).from('org_settings').select('logo_url').eq('org_id', org.id).single()
  const { agency: AGENCY, nfNotes: DOC_NF_NOTES } = await loadOrgDocs(supabase, org.id)
  const logoUrl: string | null = settings?.logo_url ?? null

  const valor = Number(p.valor ?? 0)
  const bvPct = Number(p.bv_pct ?? 0)
  const bv = Math.round(valor * bvPct) / 100
  const itens: ItemPed[] = Array.isArray(det.itens) ? det.itens : []
  const enderecoCliente = [
    ws?.address_street, ws?.address_number ? `nº ${ws.address_number}` : '', ws?.address_complement,
    ws?.address_district, [ws?.address_city, ws?.address_state].filter(Boolean).join('/'),
    ws?.address_zip ? `CEP: ${ws.address_zip}` : '',
  ].filter(Boolean).join(' - ')

  return (
    <div className="min-h-screen bg-gray-200">
      <PrintToolbar backHref={`/${orgSlug}/producao/pedido/${producaoId}`} />
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

          <h1 className="text-2xl font-light text-gray-900 mt-5 mb-5">Pedido de Produção nº {p.numero ?? ''}</h1>

          <div className="space-y-3 mb-5">
            <Row label="Fornecedor">
              <p className="font-bold text-gray-900">{forn?.name ?? '—'}</p>
              {forn?.tax_id && <p className="text-gray-600">CNPJ: {forn.tax_id}</p>}
            </Row>
            <Row label="Cliente">
              <p className="font-bold text-gray-900">{ws?.name ?? '—'}</p>
              {ws?.legal_name && <p className="text-gray-600">{ws.legal_name}</p>}
              {enderecoCliente && <p className="text-gray-600">{enderecoCliente}</p>}
              {ws?.tax_id && <p className="text-gray-600">CNPJ: {ws.tax_id}</p>}
            </Row>
            {campanha && <Row label="Campanha"><span>{campanha}</span></Row>}
            <Row label="Título"><span>{p.titulo}</span></Row>
          </div>

          <p className="text-gray-600 italic mb-3 border-l-2 border-gray-400 pl-2">Solicitamos por ordem e conta de nosso cliente acima descrito o seguinte trabalho:</p>

          {itens.map((it, i) => (
            <div key={i} className="mb-4">
              <p className="font-bold text-gray-900">{it.nome || '—'}</p>
              {it.descricao && <p className="text-gray-600 whitespace-pre-line">{it.descricao}</p>}
              <div className="flex gap-8 mt-1 text-gray-700">
                <span>Nº Orç.: {it.n_orc || '---'}</span>
                <span>Quantidade: {it.quant || '---'}</span>
                <span>Valor: {formatBRL(Number(it.valor ? it.valor.replace(/\./g, '').replace(',', '.') : 0) || 0)}</span>
              </div>
            </div>
          ))}

          <div className="bg-gray-50 border border-gray-200 rounded-lg grid grid-cols-4 gap-2 p-4 my-5 text-center">
            <div><p className="text-gray-500 text-[11px]">Valor Total</p><p className="font-semibold">{formatBRL(valor)}</p></div>
            <div><p className="text-gray-500 text-[11px]">Faturar</p><p className="font-semibold">{FATURAR_LABEL[p.faturar] ?? p.faturar ?? '—'}</p></div>
            <div><p className="text-gray-500 text-[11px]">Comissão</p><p className="font-semibold">{bvPct.toString().replace('.', ',')}% ({formatBRL(bv)})</p></div>
            <div><p className="text-gray-500 text-[11px]">Entrega</p><p className="font-semibold">{formatDateBR(det.entrega)}</p></div>
          </div>

          <ul className="list-disc pl-5 space-y-1 mb-2 text-gray-700">
            {DOC_NF_NOTES.map((n, i) => (<li key={i} className={n.highlight ? 'bg-yellow-200 inline-block px-0.5 font-medium' : ''}>{n.text}</li>))}
          </ul>

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
