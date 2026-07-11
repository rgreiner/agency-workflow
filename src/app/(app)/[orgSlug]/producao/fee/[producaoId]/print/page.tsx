import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintToolbar } from '@/components/ui/PrintToolbar'
import { loadOrgDocs } from '@/lib/agency'
import { formatBRL, formatDateBR, parseMoney } from '@/lib/midia'

interface ParcelaFee { vencimento?: string; valor?: string }

export default async function FeePrintPage({
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any).from('org_settings').select('logo_url').eq('org_id', org.id).single()
  const { agency: AGENCY } = await loadOrgDocs(supabase, org.id)
  const logoUrl: string | null = settings?.logo_url ?? null

  const det = (p.detalhe ?? {}) as { de?: string; ate?: string; num_parcelas?: string; valor_mensal?: string; parcelas?: ParcelaFee[] }
  const parcelas: ParcelaFee[] = Array.isArray(det.parcelas) ? det.parcelas : []
  const total = parcelas.reduce((s, pc) => s + parseMoney(pc.valor || ''), 0)

  return (
    <div className="min-h-screen bg-gray-200">
      <PrintToolbar backHref={`/${orgSlug}/producao/fee/${producaoId}`} />
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

          <h1 className="text-2xl font-light text-gray-900 mt-5 mb-1">Fee nº {p.numero ?? ''}</h1>
          <p className="text-gray-700 mb-5">{ws?.name} — {p.titulo}</p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg grid grid-cols-4 gap-2 p-4 mb-5 text-center">
            <div><p className="text-gray-500 text-[11px]">De</p><p className="font-semibold">{formatDateBR(det.de)}</p></div>
            <div><p className="text-gray-500 text-[11px]">Até</p><p className="font-semibold">{formatDateBR(det.ate)}</p></div>
            <div><p className="text-gray-500 text-[11px]">Parcelas</p><p className="font-semibold">{det.num_parcelas ?? parcelas.length}</p></div>
            <div><p className="text-gray-500 text-[11px]">Valor mensal</p><p className="font-semibold">{formatBRL(parseMoney(det.valor_mensal || ''))}</p></div>
          </div>

          <div className="border-l-2 border-gray-400 pl-2 mb-2"><span className="font-semibold text-gray-700">Parcelas</span></div>
          <table className="w-full sm:w-2/3 border-collapse mb-5">
            <thead><tr className="text-left text-gray-500 border-b border-gray-200"><th className="py-1.5 font-semibold">Vencimento</th><th className="py-1.5 font-semibold text-right">Valor</th></tr></thead>
            <tbody>
              {parcelas.map((pc, i) => (
                <tr key={i} className="border-b border-gray-100"><td className="py-1.5">{formatDateBR(pc.vencimento)}</td><td className="py-1.5 text-right">{formatBRL(parseMoney(pc.valor || ''))}</td></tr>
              ))}
              <tr className="font-semibold"><td className="py-2">Total do contrato</td><td className="py-2 text-right">{formatBRL(total)}</td></tr>
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
