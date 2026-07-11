import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintToolbar } from '@/components/ui/PrintToolbar'
import { loadOrgDocs } from '@/lib/agency'
import {
  formatBRL, formatDateBR, labelOf, parseMoney,
  MIDIA_TIPO_OPTIONS, MIDIA_PRAZO_OPTIONS, MIDIA_FATURAMENTO_OPTIONS,
} from '@/lib/midia'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4"><span className="w-28 text-right font-semibold text-gray-500 shrink-0">{label}</span><div className="flex-1">{children}</div></div>
  )
}
function lastDayOfMonth(d: string): string {
  const [y, m] = d.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
function vencimentoVeiculo(prazo: string | null, dataBase: string | null): string | null {
  if (!dataBase) return null
  if (!prazo || prazo === 'a_vista') return dataBase
  const m = prazo.match(/^(\d+)_dfm$/)
  if (m) return addDays(lastDayOfMonth(dataBase), Number(m[1]))
  return dataBase
}

export async function MidiaPrint({ orgSlug, midiaId }: { orgSlug: string; midiaId: string }) {
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any).from('midias').select('*').eq('id', midiaId).single()
  if (!m) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (supabase as any).from('workspaces')
    .select('name, legal_name, tax_id, finance_email, phone, address_street, address_number, address_complement, address_district, address_city, address_state, address_zip')
    .eq('id', m.workspace_id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: veic } = await (supabase as any).from('veiculos').select('name, tax_id, notes').eq('id', m.veiculo_id).single()

  let campanha = ''
  if (m.campaign_id) {
    const { data: c } = await supabase.from('campaigns').select('name').eq('id', m.campaign_id).single()
    campanha = c?.name ?? ''
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any).from('org_settings').select('logo_url').eq('org_id', org.id).single()
  const { agency: AGENCY, midiaNotes: DOC_MIDIA_NOTES } = await loadOrgDocs(supabase, org.id)
  const logoUrl: string | null = settings?.logo_url ?? null

  const valor = Number(m.valor ?? 0)
  const descPct = Number(m.desconto_pct ?? 0)
  const desc = Math.round(valor * descPct) / 100
  const tipoLabel = labelOf(MIDIA_TIPO_OPTIONS, m.tipo).replace('Mídia ', '')
  const venc = vencimentoVeiculo(m.prazo, m.data_base)

  // Produção na PI (só Mídia Externa, quando informada)
  const det = m.detalhe ?? {}
  const prodValor = parseMoney(String(det.producao_valor ?? ''))
  const prodQtd = parseInt(String(det.producao_quantidade ?? '1'), 10) || 1
  const prodTotal = prodValor * prodQtd
  const prodComissao = prodTotal * (parseMoney(String(det.producao_comissao_pct ?? '')) / 100)
  const showProducao = m.tipo === 'externa' && prodTotal > 0
  const enderecoCliente = [
    ws?.address_street, ws?.address_number ? `nº ${ws.address_number}` : '', ws?.address_complement,
    ws?.address_district, [ws?.address_city, ws?.address_state].filter(Boolean).join('/'),
    ws?.address_zip ? `CEP: ${ws.address_zip}` : '',
  ].filter(Boolean).join(' - ')

  return (
    <div className="min-h-screen bg-gray-200">
      <PrintToolbar />
      <div className="py-6 flex justify-center">
        <div id="print-doc" className="bg-white shadow-sm w-[210mm] max-w-full p-[16mm] text-[12px] text-gray-800">
          {/* Cabeçalho */}
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

          <h1 className="text-2xl font-light text-gray-900 mt-5 mb-5">Autorização de Mídia {tipoLabel} nº {m.numero ?? ''}</h1>

          <div className="space-y-3 mb-6">
            <Row label="Veículo">
              <p className="font-bold text-gray-900">{veic?.name ?? '—'}</p>
              {veic?.tax_id && <p className="text-gray-600">CNPJ: {veic.tax_id}</p>}
              {veic?.notes && <p className="text-gray-600">{veic.notes}</p>}
            </Row>
            <Row label="Cliente">
              <p className="font-bold text-gray-900">{ws?.name ?? '—'}</p>
              {ws?.legal_name && <p className="text-gray-600">{ws.legal_name}</p>}
              {enderecoCliente && <p className="text-gray-600">{enderecoCliente}</p>}
              {ws?.tax_id && <p className="text-gray-600">CNPJ: {ws.tax_id}</p>}
              {(ws?.finance_email || ws?.phone) && <p className="text-gray-600">{[ws?.phone, ws?.finance_email].filter(Boolean).join('  ')}</p>}
            </Row>
            <Row label="Título"><span>{m.titulo}</span></Row>
            {campanha && <Row label="Campanha"><span>{campanha}</span></Row>}
            {(m.praca || m.abrangencia) && <Row label="Praça"><span>{[m.praca, m.abrangencia].filter(Boolean).join(' · ')}</span></Row>}
            {m.pecas && <Row label="Peças"><span className="whitespace-pre-line">{m.pecas}</span></Row>}
          </div>

          {/* Preços */}
          <div className="border-l-2 border-gray-400 pl-2 mb-2"><span className="font-semibold text-gray-700">Preços</span></div>
          <table className="w-full sm:w-2/3 mb-6">
            <tbody className="[&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-gray-100">
              <tr><td className="text-gray-500">Valor</td><td className="text-right">{formatBRL(valor)}</td></tr>
              <tr><td className="text-gray-500">Desc. Padrão Ag.</td><td className="text-right">{descPct.toString().replace('.', ',')}% ({formatBRL(desc)})</td></tr>
              <tr><td className="text-gray-500">Prazo</td><td className="text-right">{labelOf(MIDIA_PRAZO_OPTIONS, m.prazo)}{venc ? ` (${formatDateBR(venc)})` : ''}</td></tr>
              <tr><td className="text-gray-500">{labelOf(MIDIA_FATURAMENTO_OPTIONS, m.faturamento)}</td><td className="text-right font-semibold">{formatBRL(valor)}</td></tr>
            </tbody>
          </table>

          {/* Produção (Mídia Externa) */}
          {showProducao && (
            <>
              <div className="border-l-2 border-gray-400 pl-2 mb-2"><span className="font-semibold text-gray-700">Produção</span></div>
              <table className="w-full sm:w-2/3 mb-6">
                <tbody className="[&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-gray-100">
                  <tr><td className="text-gray-500">Tipo</td><td className="text-right">{det.producao_tipo === 'no_veiculo' ? 'No veículo' : det.producao_tipo === 'de_terceiros' ? 'De terceiros' : '—'}</td></tr>
                  <tr><td className="text-gray-500">Quantidade</td><td className="text-right">{prodQtd}</td></tr>
                  <tr><td className="text-gray-500">Valor unitário</td><td className="text-right">{formatBRL(prodValor)}</td></tr>
                  <tr><td className="text-gray-500">Total produção</td><td className="text-right font-semibold">{formatBRL(prodTotal)}</td></tr>
                  {prodComissao > 0 && <tr><td className="text-gray-500">Comissão produção</td><td className="text-right">{formatBRL(prodComissao)}</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {/* Texto legal / observações de faturamento */}
          <div className="border-l-2 border-gray-400 pl-2 mb-2"><span className="font-semibold text-gray-700">Observações sobre faturamento</span></div>
          <ul className="list-disc pl-5 space-y-1 mb-2 text-gray-700">
            {DOC_MIDIA_NOTES.map((n, i) => (
              <li key={i}><span className={n.highlight ? 'bg-yellow-200 px-0.5 font-medium' : ''}>{n.text}</span></li>
            ))}
          </ul>
          {m.texto_legal && <p className="text-gray-600 whitespace-pre-line mb-2">{m.texto_legal}</p>}

          {/* Datas */}
          <div className="grid grid-cols-2 gap-6 mt-6">
            <div><Row label="Local"><span>{AGENCY.cidade}</span></Row></div>
            <div><Row label="Emissão"><span>{formatDateBR(m.emissao)}</span></Row></div>
            <div><Row label="1ª Veiculação"><span>{formatDateBR(m.primeira_veiculacao)}</span></Row></div>
            <div><Row label="Última Veiculação"><span>{formatDateBR(m.ultima_veiculacao)}</span></Row></div>
          </div>

          <div className="grid grid-cols-2 gap-10 mt-16">
            <div className="text-center"><div className="border-t border-gray-400 pt-1 text-gray-700">{AGENCY.razao}</div></div>
            <div className="text-center"><div className="border-t border-gray-400 pt-1 text-gray-700">{ws?.legal_name || ws?.name || ''}</div></div>
          </div>
        </div>
      </div>
    </div>
  )
}
