// Carga dos dados da Autorização de Mídia, separada do desenho.
//
// Existe porque o documento passou a ser gerado como PDF de verdade
// (@react-pdf/renderer, rota /api/docs/...): a rota precisa dos dados sem
// renderizar HTML. Manter a leitura aqui evita que o PDF e a tela divirjam no
// que buscam do banco.

import { loadOrgDocs } from '@/lib/agency'
import { labelOf, parseMoney, MIDIA_TIPO_OPTIONS, MIDIA_PRAZO_OPTIONS, MIDIA_FATURAMENTO_OPTIONS } from '@/lib/midia'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function lastDayOfMonth(d: string): string {
  const [y, m] = d.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
/** Vencimento do veículo: à vista = data base; N DFM = N dias após o fim do mês. */
function vencimentoVeiculo(prazo: string | null, dataBase: string | null): string | null {
  if (!dataBase) return null
  if (!prazo || prazo === 'a_vista') return dataBase
  const m = prazo.match(/^(\d+)_dfm$/)
  return m ? addDays(lastDayOfMonth(dataBase), Number(m[1])) : dataBase
}

export interface MidiaDocData {
  numero: number | null; serie: string | null; tipoLabel: string
  nomeArquivo: string
  agencia: { nome: string; razao: string; endereco: string; cnpjFone: string; cidade: string }
  logoUrl: string | null
  veiculo: { nome: string; endereco: string; cnpjFone: string; notas: string }
  cliente: { nome: string; razao: string; endereco: string; cnpj: string }
  titulo: string; campanha: string
  pares: { label: string; valor: string }[]
  localizacoes: { endereco: string; cidade: string }[]
  producao: { mostrar: boolean; tipo: string; pedido: string; qtd: number; unitario: number; total: number; comissao: number }
  exibicao: { custo: number; descPct: number; desconto: number }
  precos: { prazoLabel: string; faturamentoLabel: string; valor: number }
  legal: { titulo: string; itens: { text: string; highlight?: boolean }[]; textoProprio: string }
  datas: { local: string; emissao: string | null; primeira: string | null; ultima: string | null }
  assinaturas: { esquerda: string; direita: string }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadMidiaDoc(supabase: any, orgId: string, midiaId: string): Promise<MidiaDocData | null> {
  const { data: m } = await supabase.from('midias').select('*').eq('id', midiaId).single()
  if (!m) return null

  const [{ data: ws }, { data: veic }, { data: settings }] = await Promise.all([
    supabase.from('workspaces')
      // Sem finance_email/phone: contato do cliente não vai no documento (o
      // financeiro da agência é quem intermedeia — está no próprio texto legal).
      .select('name, legal_name, tax_id, address_street, address_number, address_complement, address_district, address_city, address_state, address_zip')
      .eq('id', m.workspace_id).single(),
    supabase.from('veiculos').select('name, tax_id, notes, enderecos, telefones').eq('id', m.veiculo_id).single(),
    supabase.from('org_settings').select('logo_url').eq('org_id', orgId).single(),
  ])

  let campanha = ''
  if (m.campaign_id) {
    const { data: c } = await supabase.from('campaigns').select('name').eq('id', m.campaign_id).single()
    campanha = c?.name ?? ''
  }
  const { agency, midiaNotes } = await loadOrgDocs(supabase, orgId)

  const det = m.detalhe ?? {}
  const valor = Number(m.valor ?? 0)
  const descPct = Number(m.desconto_pct ?? 0)
  const prodValor = parseMoney(String(det.producao_valor ?? ''))
  const prodQtd = parseInt(String(det.producao_quantidade ?? '1'), 10) || 1
  const prodTotal = prodValor * prodQtd

  const vEnd = Array.isArray(veic?.enderecos) ? veic.enderecos[0] : null
  const enderecoVeiculo = vEnd ? [
    vEnd.logradouro, vEnd.numero ? `nº ${vEnd.numero}` : '', vEnd.complemento, vEnd.bairro,
    [vEnd.cidade, vEnd.uf ?? vEnd.estado].filter(Boolean).join('/'), vEnd.cep ? `CEP: ${vEnd.cep}` : '',
  ].filter(Boolean).join(' - ') : ''
  const foneVeiculo = (Array.isArray(veic?.telefones) ? veic.telefones[0]?.numero : '') ?? ''

  const mesAno = det.mes ? `${MESES[Number(det.mes) - 1] ?? det.mes}/${det.ano ?? ''}` : ''
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const tipoLabel = labelOf(MIDIA_TIPO_OPTIONS, m.tipo).replace('Mídia ', '')
  const padrao = midiaNotes.map(n => n.text).join('\n').trim()
  const tl = (m.texto_legal ?? '').trim()

  return {
    numero: m.numero ?? null, serie: m.serie ?? null, tipoLabel,
    nomeArquivo: `${[m.serie, m.numero].filter(Boolean).join(' ')} | ${m.titulo ?? ''}`.trim(),
    agencia: agency,
    logoUrl: settings?.logo_url ?? null,
    veiculo: {
      nome: veic?.name ?? '—',
      endereco: enderecoVeiculo,
      cnpjFone: [veic?.tax_id ? `CNPJ: ${veic.tax_id}` : '', foneVeiculo ? `Fone: ${foneVeiculo}` : ''].filter(Boolean).join('  '),
      notas: veic?.notes ?? '',
    },
    cliente: {
      nome: ws?.name ?? '—', razao: ws?.legal_name ?? '',
      endereco: [
        ws?.address_street, ws?.address_number ? `nº ${ws.address_number}` : '', ws?.address_complement,
        ws?.address_district, [ws?.address_city, ws?.address_state].filter(Boolean).join('/'),
        ws?.address_zip ? `CEP: ${ws.address_zip}` : '',
      ].filter(Boolean).join(' - '),
      cnpj: ws?.tax_id ? `CNPJ: ${ws.tax_id}` : '',
    },
    titulo: m.titulo ?? '', campanha,
    // Só os pares que EXISTEM: campo vazio vira buraco e empurra o documento.
    pares: [
      m.praca ? { label: 'Praça', valor: String(m.praca) } : null,
      det.especie ? { label: 'Espécie', valor: String(det.especie) } : null,
      mesAno ? { label: 'Mês', valor: mesAno } : null,
      det.bisemana && det.bisemana !== 'outro' ? { label: 'Bisemana', valor: String(det.bisemana) } : null,
      det.periodo ? { label: 'Período', valor: String(det.periodo) } : null,
      m.abrangencia ? { label: 'Abrangência', valor: cap(String(m.abrangencia)) } : null,
    ].filter((p): p is { label: string; valor: string } => p !== null),
    localizacoes: (Array.isArray(det.localizacoes) ? det.localizacoes : [])
      .filter((l: any) => l && typeof l === 'object')
      .map((l: any) => ({ endereco: String(l.endereco ?? ''), cidade: String(l.cidade ?? '') }))
      .filter((l: { endereco: string; cidade: string }) => l.endereco.trim() || l.cidade.trim()),
    producao: {
      mostrar: m.tipo === 'externa' && prodTotal > 0,
      tipo: det.producao_tipo === 'no_veiculo' ? 'No veículo' : det.producao_tipo === 'de_terceiros' ? 'De terceiros' : '—',
      pedido: String(det.pedido_producao ?? ''),
      qtd: prodQtd, unitario: prodValor, total: prodTotal,
      comissao: prodTotal * (parseMoney(String(det.producao_comissao_pct ?? '')) / 100),
    },
    exibicao: {
      custo: parseMoney(String(det.custo ?? '')) || valor,
      descPct, desconto: Math.round(valor * descPct) / 100,
    },
    precos: {
      prazoLabel: (() => {
        const v = vencimentoVeiculo(m.prazo, m.data_base)
        const base = labelOf(MIDIA_PRAZO_OPTIONS, m.prazo)
        return v ? `${base} (${v.split('-').reverse().join('/')})` : base
      })(),
      faturamentoLabel: labelOf(MIDIA_FATURAMENTO_OPTIONS, m.faturamento),
      valor,
    },
    legal: {
      titulo: 'Observações sobre faturamento:',
      // Documento não editado (vazio ou = padrão) imprime as notas da config com
      // o destaque; editado imprime o texto próprio.
      itens: !tl || tl === padrao ? midiaNotes : [],
      textoProprio: !tl || tl === padrao ? '' : m.texto_legal,
    },
    datas: {
      local: agency.cidade,
      emissao: m.emissao ?? null, primeira: m.primeira_veiculacao ?? null, ultima: m.ultima_veiculacao ?? null,
    },
    assinaturas: { esquerda: agency.razao, direita: ws?.legal_name || ws?.name || '' },
  }
}
