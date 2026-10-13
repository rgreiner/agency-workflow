import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { valoresItem } from '@/lib/pdf/producao-data'
import { PortalShell } from '../../PortalShell'
import { OrcamentoClient, type OrcamentoPortal } from './OrcamentoClient'

export const dynamic = 'force-dynamic'

interface Rpc {
  id: string; titulo: string; numero: number | null; serie: string | null
  campanha: string | null; emissao: string | null; validade_dias: number | null
  valor: number; honorarios_pct: number; observacao: string | null
  situacao: 'aguardando' | 'aprovado'
  itens: { nome: string; descricao: string | null; opcao: { quant: string; valor_unit: string; valor_total: string } | null }[]
  decisao: { kind: 'aprovado' | 'ajuste'; em: string | null; por: string | null } | null
  pode_decidir: boolean
}

/** Orçamento publicado pela agência: resumo, PDF e aceite (mig. 342). */
export default async function PortalOrcamentoPage({ params }: { params: Promise<{ producaoId: string }> }) {
  const claims = await sessaoPortal()
  if (!claims) redirect('/portal')
  const { producaoId } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_orcamento', { p_id: producaoId })
  if (error || !data) redirect('/portal/painel')
  const o = data as Rpc

  // Mesma régua do PDF: total digitado vence; senão quantidade × unitário.
  const itens = o.itens.map((it) => {
    const v = it.opcao ? valoresItem(it.opcao.quant, it.opcao.valor_unit, it.opcao.valor_total) : { total: 0 }
    return { nome: it.nome, descricao: it.descricao ?? '', quant: it.opcao?.quant ?? '', total: v.total }
  })

  // Mesma conta do PDF: soma das opções escolhidas + honorários sobre ela.
  const faturar = itens.reduce((acc, it) => acc + it.total, 0)
  const honorarios = Math.round(faturar * Number(o.honorarios_pct ?? 0)) / 100

  const orc: OrcamentoPortal = {
    id: o.id,
    titulo: o.titulo,
    numero: [o.serie, o.numero].filter(Boolean).join(' '),
    campanha: o.campanha,
    emissao: o.emissao,
    validadeDias: o.validade_dias,
    valor: faturar + honorarios,
    honorarios,
    honorariosPct: Number(o.honorarios_pct ?? 0),
    observacao: o.observacao,
    situacao: o.situacao,
    itens,
    decisao: o.decisao,
    podeDecidir: o.pode_decidir && !claims.preview,
  }

  return (
    <PortalShell wide>
      <OrcamentoClient orc={orc} preview={claims.preview === true} />
    </PortalShell>
  )
}
