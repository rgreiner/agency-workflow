// Carga dos dados dos documentos de Produção (Fee, Proposta, Pedido, Orçamento),
// separada do desenho — igual ao que a Mídia já faz (ver midia-data.ts). A rota
// /api/docs/producao usa isto para gerar o PDF; assim o PDF e a tela não divergem
// no que buscam do banco. Uma definição só do documento (lib/pdf/ProducaoDoc).

import { loadOrgDocs } from '@/lib/agency'
import { parseMoney } from '@/lib/midia'
import type { Agencia } from './kit'

const TIPO_LABEL: Record<string, string> = {
  fee: 'Fee', proposta: 'Proposta', pedido: 'Pedido de Produção', orcamento: 'Orçamento',
}
const ITEM_TIPO_LABEL: Record<string, string> = {
  midia: 'Mídia', producao: 'Produção', servico_interno: 'Serviço Interno', fee: 'Fee',
}
const FATURAR_LABEL: Record<string, string> = {
  contra_cliente: 'Contra o Cliente', contra_agencia: 'Contra a Agência',
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "Cascavel, 21 de julho de 2026" — só o Orçamento usa a data por extenso. */
function dataExtenso(cidade: string, d: string | null): string {
  const base = d && d.length >= 10 ? d.slice(0, 10) : ''
  if (!base) return cidade
  const [y, m, dia] = base.split('-')
  return `${cidade}, ${Number(dia)} de ${MESES[Number(m) - 1]} de ${y}`
}

interface Cliente { nome: string; razao: string; endereco: string; cnpj: string; contato: string }

interface Base {
  tipoLabel: string
  numero: number | null; serie: string | null
  nomeArquivo: string
  agencia: Agencia; logoUrl: string | null
  cliente: Cliente; campanha: string; titulo: string
  observacao: string; textoLegal: string
  emissao: string | null; emissaoExtenso: string; cidade: string
  assinaturas: { esquerda: string; direita: string }
}

export interface FeeParcela { vencimento: string | null; valor: number }
export interface PropostaItem { tipoLabel: string; nome: string; quantidade: string; total: number }
export interface PedidoItem { nome: string; descricao: string; nOrc: string; quant: string; valor: number }
export interface OrcOpcao { fornecedor: string; nOrc: string; pgto: string; quant: string; valorUnit: number; total: number; selecionado: boolean }
export interface OrcItem { nome: string; descricao: string; imagem: string | null; opcoes: OrcOpcao[] }
export interface LegalNote { text: string; highlight?: boolean }

export type ProducaoDocData = Base & (
  | { tipo: 'fee'; fee: { de: string | null; ate: string | null; numParcelas: string; valorMensal: number; parcelas: FeeParcela[]; total: number } }
  | { tipo: 'proposta'; proposta: { introducao: string; itens: PropostaItem[]; total: number } }
  | { tipo: 'pedido'; pedido: { fornecedor: { nome: string; cnpj: string }; entrega: string | null; faturarLabel: string; valorTotal: number; comissaoPct: number; comissao: number; itens: PedidoItem[]; notas: LegalNote[] } }
  | { tipo: 'orcamento'; orcamento: { itens: OrcItem[]; notas: LegalNote[] } }
)

const money = (v: unknown) => parseMoney(String(v ?? ''))

function enderecoDe(ws: Record<string, unknown> | null): string {
  if (!ws) return ''
  return [
    ws.address_street, ws.address_number ? `nº ${ws.address_number}` : '', ws.address_complement,
    ws.address_district, [ws.address_city, ws.address_state].filter(Boolean).join('/'),
    ws.address_zip ? `CEP: ${ws.address_zip}` : '',
  ].filter(Boolean).join(' - ')
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadProducaoDoc(supabase: any, orgId: string, producaoId: string): Promise<ProducaoDocData | null> {
  const { data: p } = await supabase.from('producao').select('*').eq('id', producaoId).single()
  if (!p) return null

  const [{ data: ws }, { data: settings }] = await Promise.all([
    supabase.from('workspaces')
      .select('name, legal_name, tax_id, finance_email, phone, address_street, address_number, address_complement, address_district, address_city, address_state, address_zip')
      .eq('id', p.workspace_id).single(),
    supabase.from('org_settings').select('logo_url').eq('org_id', orgId).single(),
  ])

  let campanha = ''
  if (p.campaign_id) {
    const { data: c } = await supabase.from('campaigns').select('name').eq('id', p.campaign_id).single()
    campanha = c?.name ?? ''
  }
  const { agency, nfNotes } = await loadOrgDocs(supabase, orgId)

  const cliente: Cliente = {
    nome: ws?.name ?? '—', razao: ws?.legal_name ?? '',
    endereco: enderecoDe(ws), cnpj: ws?.tax_id ? `CNPJ: ${ws.tax_id}` : '',
    contato: [ws?.phone, ws?.finance_email].filter(Boolean).join('  '),
  }

  const base: Base = {
    tipoLabel: TIPO_LABEL[p.tipo] ?? p.tipo,
    numero: p.numero ?? null, serie: p.serie ?? null,
    nomeArquivo: `${[p.serie, p.numero].filter(Boolean).join(' ')} | ${p.titulo ?? ''}`.trim(),
    agencia: agency, logoUrl: settings?.logo_url ?? null,
    cliente, campanha, titulo: p.titulo ?? '',
    observacao: (p.observacao ?? '').trim(), textoLegal: (p.texto_legal ?? '').trim(),
    emissao: p.emissao ?? null, emissaoExtenso: dataExtenso(agency.cidade, p.emissao ?? null), cidade: agency.cidade,
    assinaturas: { esquerda: agency.razao, direita: ws?.legal_name || ws?.name || '' },
  }

  const det = p.detalhe ?? {}

  if (p.tipo === 'fee') {
    const parcelas: FeeParcela[] = (Array.isArray(det.parcelas) ? det.parcelas : [])
      .map((pc: any) => ({ vencimento: pc?.vencimento ?? null, valor: money(pc?.valor) }))
    return {
      ...base, tipo: 'fee',
      fee: {
        de: det.de ?? null, ate: det.ate ?? null,
        numParcelas: String(det.num_parcelas ?? parcelas.length),
        valorMensal: money(det.valor_mensal),
        parcelas, total: parcelas.reduce((s, pc) => s + pc.valor, 0),
      },
    }
  }

  if (p.tipo === 'proposta') {
    const itens: PropostaItem[] = (Array.isArray(det.itens) ? det.itens : []).map((it: any) => {
      const qtd = parseInt(it?.quantidade || '1', 10) || 0
      const total = qtd * money(it?.valor_unit) * (1 - money(it?.desconto) / 100)
      return { tipoLabel: ITEM_TIPO_LABEL[it?.tipo ?? ''] ?? (it?.tipo ?? ''), nome: it?.nome ?? '', quantidade: String(it?.quantidade ?? ''), total }
    })
    return {
      ...base, tipo: 'proposta',
      proposta: { introducao: (det.introducao ?? '').trim(), itens, total: itens.reduce((s, it) => s + it.total, 0) },
    }
  }

  if (p.tipo === 'pedido') {
    let forn: { name?: string; tax_id?: string } | null = null
    if (det.fornecedor_id) {
      const { data } = await supabase.from('fornecedores').select('name, tax_id').eq('id', det.fornecedor_id).single()
      forn = data
    }
    const valor = Number(p.valor ?? 0)
    const bvPct = Number(p.bv_pct ?? 0)
    const itens: PedidoItem[] = (Array.isArray(det.itens) ? det.itens : []).map((it: any) => ({
      nome: it?.nome ?? '', descricao: it?.descricao ?? '', nOrc: it?.n_orc ?? '', quant: it?.quant ?? '', valor: money(it?.valor),
    }))
    return {
      ...base, tipo: 'pedido',
      pedido: {
        fornecedor: { nome: forn?.name ?? '—', cnpj: forn?.tax_id ? `CNPJ: ${forn.tax_id}` : '' },
        entrega: det.entrega ?? null,
        faturarLabel: FATURAR_LABEL[p.faturar] ?? p.faturar ?? '—',
        valorTotal: valor, comissaoPct: bvPct, comissao: Math.round(valor * bvPct) / 100,
        itens, notas: nfNotes,
      },
    }
  }

  // orçamento
  const { data: fornRaw } = await supabase.from('fornecedores').select('id, name').eq('org_id', orgId)
  const fornMap = new Map<string, string>((fornRaw ?? []).map((f: any) => [f.id, f.name]))
  const itens: OrcItem[] = (Array.isArray(det.itens) ? det.itens : []).map((it: any) => ({
    nome: it?.nome ?? '', descricao: it?.descricao ?? '', imagem: it?.imagem || null,
    opcoes: (Array.isArray(it?.opcoes) ? it.opcoes : []).map((o: any) => {
      const total = (parseInt(o?.quant || '1', 10) || 0) * money(o?.valor_unit)
      return {
        fornecedor: o?.fornecedor_id ? (fornMap.get(o.fornecedor_id) ?? '—') : '—',
        nOrc: o?.n_orc ?? '', pgto: o?.pgto ?? '', quant: o?.quant ?? '',
        valorUnit: money(o?.valor_unit), total, selecionado: !!o?.selecionado,
      }
    }),
  }))
  return { ...base, tipo: 'orcamento', orcamento: { itens, notas: nfNotes } }
}
