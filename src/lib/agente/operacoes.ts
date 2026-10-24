/**
 * Operações da API de agentes v1 — contrato em rgreiner/digitais,
 * docs/contrato-flow-v1.md. Tudo roda com o supabase da USUÁRIA do agente
 * (RLS de membro do financeiro); aqui não há conexão direta nem bypass.
 *
 * Regra que atravessa todas: na dúvida, não responde. Telefone que casa com
 * dois cadastros devolve null; título de outra empresa não aparece.
 */
import 'server-only'
import { criarBuscadorPix, pixDoTitulo } from '@/lib/pix/cobranca'
import { caminhoDoAnexo, linkAssinado } from './arquivo'
import type { AgenteFlow } from './auth'

export class ErroAgente extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

type TipoContato = 'cliente' | 'fornecedor' | 'veiculo'

export interface ContatoFlow {
  tipo: TipoContato
  id: string
  nome: string
  empresa: string
  cnpj: string | null
  /**
   * Mesmo telefone/e-mail cadastrado em MAIS de uma empresa (ex.: T2D, Di Napoli
   * e Kyoto, do mesmo grupo, com um financeiro só). Cada cadastro é autorização
   * própria, então a pessoa responde por todas. O contato principal é o 1º.
   */
  grupo?: ContatoFlow[]
}

export interface TituloFlow {
  id: string
  documento: string | null
  descricao: string
  valor: number
  vencimento: string | null
  situacao: 'em_aberto' | 'atrasado' | 'pago' | 'recebido'
  nf_numero: string | null
  tem_pix: boolean
  tem_boleto: boolean
  prorrogacoes: number
}

interface Anexo { url?: string; nome?: string; tipo?: string; numero?: string }

interface Cadastro {
  id: string; name: string; legal_name: string | null; trade_name?: string | null; tax_id: string | null
  finance_email?: string | null; phone?: string | null
  telefones: { numero?: string }[] | null; emails: { email?: string }[] | null
}

const TABELA: Record<TipoContato, string> = { cliente: 'workspaces', fornecedor: 'fornecedores', veiculo: 'veiculos' }

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** DDD + últimos 8 dígitos: casa "45 99826-0294", "+5545998260294" e o número sem o 9. */
export function chaveTelefone(s: string | null | undefined): string | null {
  let d = soDigitos(s)
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length < 10) return null
  return d.slice(0, 2) + d.slice(-8)
}

function contatoDe(tipo: TipoContato, c: Cadastro): ContatoFlow {
  return {
    tipo, id: c.id, nome: c.name,
    empresa: c.legal_name || c.trade_name || c.name,
    cnpj: soDigitos(c.tax_id) || null,
  }
}

async function cadastros(a: AgenteFlow, tipo: TipoContato): Promise<Cadastro[]> {
  const extra = tipo === 'cliente' ? ', trade_name, finance_email, phone' : ''
  const { data, error } = await a.supabase.from(TABELA[tipo])
    .select(`id, name, legal_name, tax_id, telefones, emails${extra}`)
    .eq('org_id', a.orgId).eq('archived', false)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Cadastro[]
}

async function todosCadastros(a: AgenteFlow): Promise<[TipoContato, Cadastro][]> {
  const tipos: TipoContato[] = ['cliente', 'fornecedor', 'veiculo']
  const listas = await Promise.all(tipos.map(t => cadastros(a, t)))
  return listas.flatMap((l, i) => l.map(c => [tipos[i], c] as [TipoContato, Cadastro]))
}

/** Só devolve quando exatamente UM cadastro casa — ambíguo é null. */
function unico(achados: ContatoFlow[]): ContatoFlow | null {
  const ids = new Set(achados.map(c => `${c.tipo}:${c.id}`))
  return ids.size === 1 ? achados[0] : null
}

/**
 * Telefone/e-mail: o dado está EXATO em cada cadastro achado, então todos valem
 * (financeiro de grupo). Diferente do CNPJ do `verificar`, onde dois cadastros
 * com o mesmo documento seria erro de cadastro — lá continua `unico`.
 */
function doGrupo(achados: ContatoFlow[]): ContatoFlow | null {
  const vistos = new Map<string, ContatoFlow>()
  for (const c of achados) vistos.set(`${c.tipo}:${c.id}`, c)
  const todos = [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  if (!todos.length) return null
  return todos.length === 1 ? todos[0] : { ...todos[0], grupo: todos }
}

export async function identificar(a: AgenteFlow, canal: string, endereco: string): Promise<ContatoFlow | null> {
  const todos = await todosCadastros(a)
  if (canal === 'email') {
    const alvo = endereco.trim().toLowerCase()
    if (!alvo.includes('@')) throw new ErroAgente('e-mail inválido')
    return doGrupo(todos.filter(([, c]) =>
      [c.finance_email, ...(c.emails ?? []).map(e => e.email)].some(e => e?.trim().toLowerCase() === alvo),
    ).map(([t, c]) => contatoDe(t, c)))
  }
  const alvo = chaveTelefone(endereco)
  if (!alvo) throw new ErroAgente('telefone inválido')
  return doGrupo(todos.filter(([, c]) =>
    [c.phone, ...(c.telefones ?? []).map(t => t.numero)].some(n => chaveTelefone(n) === alvo),
  ).map(([t, c]) => contatoDe(t, c)))
}

async function contatoPorId(a: AgenteFlow, tipo: string, id: string): Promise<ContatoFlow> {
  if (!(tipo in TABELA)) throw new ErroAgente('tipo de contato inválido')
  const c = (await cadastros(a, tipo as TipoContato)).find(x => x.id === id)
  if (!c) throw new ErroAgente('contato não encontrado', 404)
  return contatoDe(tipo as TipoContato, c)
}

interface LinhaLanc {
  id: string; descricao: string | null; valor: number; vencimento: string | null; situacao: string
  tipo: string; anexos: Anexo[] | null; org_id: string
}

const SELECT_LANC = 'id, descricao, valor, vencimento, situacao, tipo, anexos, org_id'

function hojeBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

async function lancamentosDoContato(a: AgenteFlow, c: ContatoFlow, abertos: boolean): Promise<LinhaLanc[]> {
  let q = a.supabase.from('lancamentos').select(SELECT_LANC).eq('org_id', a.orgId)
  // Cliente: o vínculo novo (contato_id) ou o resolvido pelo trigger (workspace_id).
  q = c.tipo === 'cliente'
    ? q.or(`and(contato_tipo.eq.cliente,contato_id.eq.${c.id}),workspace_id.eq.${c.id}`)
    : q.eq('contato_tipo', c.tipo).eq('contato_id', c.id)
  if (abertos) q = q.eq('situacao', 'em_aberto')
  const { data, error } = await q.order('vencimento', { ascending: !abertos }).limit(abertos ? 60 : 30)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaLanc[]
}

async function montarTitulos(a: AgenteFlow, linhas: LinhaLanc[]): Promise<TituloFlow[]> {
  if (!linhas.length) return []
  const ids = linhas.map(l => l.id)
  const [notas, hist, pix] = await Promise.all([
    a.supabase.from('nota_fiscal').select('lancamento_id, numero').in('lancamento_id', ids).eq('status', 'autorizada'),
    a.supabase.from('lancamento_historico').select('lancamento_id').in('lancamento_id', ids).eq('tipo', 'prorrogacao'),
    criarBuscadorPix(a.supabase)(a.orgId),
  ])
  const nfPorLanc = new Map<string, string>()
  for (const n of (notas.data ?? []) as { lancamento_id: string; numero: string }[]) nfPorLanc.set(n.lancamento_id, n.numero)
  const prorrog = new Map<string, number>()
  for (const h of (hist.data ?? []) as { lancamento_id: string }[]) prorrog.set(h.lancamento_id, (prorrog.get(h.lancamento_id) ?? 0) + 1)
  const hoje = hojeBR()

  return linhas.map(l => {
    const anexos = l.anexos ?? []
    const nfAnexo = anexos.find(x => x.tipo === 'NF' && x.numero)?.numero ?? null
    const nf = nfPorLanc.get(l.id) ?? nfAnexo
    const situacao: TituloFlow['situacao'] = l.situacao === 'em_aberto'
      ? (l.vencimento && l.vencimento < hoje ? 'atrasado' : 'em_aberto')
      : (l.situacao === 'recebido' ? 'recebido' : 'pago')
    return {
      id: l.id,
      documento: nf ? `NF ${nf}` : null,
      descricao: l.descricao ?? '',
      valor: Math.abs(Number(l.valor)),
      vencimento: l.vencimento,
      situacao,
      nf_numero: nf,
      tem_pix: l.tipo === 'entrada' && l.situacao === 'em_aberto' && !!pix?.chave,
      tem_boleto: anexos.some(x => x.tipo === 'Boleto' && x.url && caminhoDoAnexo(x.url)),
      prorrogacoes: prorrog.get(l.id) ?? 0,
    }
  })
}

export async function titulos(a: AgenteFlow, tipo: string, id: string, situacao?: string): Promise<TituloFlow[]> {
  const c = await contatoPorId(a, tipo, id)
  return montarTitulos(a, await lancamentosDoContato(a, c, situacao !== 'todos'))
}

/**
 * Quem não está no cadastro prova quem é com CNPJ + um documento DA PRÓPRIA
 * empresa (nº de NF ou de boleto de um título dela). Nada de "parecido": o
 * número tem que bater inteiro. Zeros à esquerda não contam — a NFS-e nacional
 * recomeçou do 1 em 2026, então "019" e "19" são a NF 19 (decisão do Rafael,
 * 24/10). Mínimo de 2 dígitos significativos.
 */
const numeroDoc = (s: string | null | undefined) => soDigitos(s).replace(/^0+/, '')

export async function verificar(a: AgenteFlow, cnpj: string, documento: string): Promise<ContatoFlow | null> {
  const alvo = soDigitos(cnpj)
  const doc = numeroDoc(documento)
  if (alvo.length !== 14 && alvo.length !== 11) throw new ErroAgente('CNPJ/CPF inválido')
  if (doc.length < 2) throw new ErroAgente('documento inválido')
  const c = unico((await todosCadastros(a)).filter(([, x]) => soDigitos(x.tax_id) === alvo).map(([t, x]) => contatoDe(t, x)))
  if (!c) return null
  const linhas = await lancamentosDoContato(a, c, false)
  const ts = await montarTitulos(a, linhas)
  const bate = ts.some(t => numeroDoc(t.nf_numero) === doc)
    || linhas.some(l => (l.anexos ?? []).some(x => numeroDoc(x.numero) === doc))
  return bate ? c : null
}

async function lancamento(a: AgenteFlow, id: string): Promise<LinhaLanc> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAgente('título inválido')
  const { data, error } = await a.supabase.from('lancamentos').select(SELECT_LANC).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || (data as LinhaLanc).org_id !== a.orgId) throw new ErroAgente('título não encontrado', 404)
  return data as LinhaLanc
}

export async function cobranca(a: AgenteFlow, tituloId: string, base: string) {
  const l = await lancamento(a, tituloId)
  const pix = l.tipo === 'entrada' && l.situacao === 'em_aberto'
    ? pixDoTitulo(await criarBuscadorPix(a.supabase)(a.orgId), Math.abs(Number(l.valor)), l.id.replace(/-/g, '').slice(0, 25))
    : ''
  const link = (tipo: string) => {
    const x = (l.anexos ?? []).find(an => an.tipo === tipo && an.url && caminhoDoAnexo(an.url))
    return x?.url ? linkAssinado(base, caminhoDoAnexo(x.url)!) : null
  }
  return { pix_copia_cola: pix || null, nf_url: link('NF'), boleto_url: link('Boleto') }
}

export async function prorrogar(a: AgenteFlow, tituloId: string, novaData: string, motivo: string) {
  await lancamento(a, tituloId)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(novaData)) throw new ErroAgente('data inválida (use AAAA-MM-DD)')
  const { data, error } = await a.supabase.rpc('lancamento_prorrogar', {
    p_lancamento_id: tituloId, p_nova_data: novaData, p_motivo: `${motivo} — via ${a.nome}`,
  })
  if (error) throw new ErroAgente(error.message)
  return data as { titulo_id: string; vencimento: string; prorrogacoes: number }
}

export async function anotar(a: AgenteFlow, tituloId: string, texto: string) {
  await lancamento(a, tituloId)
  const { error } = await a.supabase.rpc('lancamento_anotar', { p_lancamento_id: tituloId, p_texto: `${texto} — via ${a.nome}` })
  if (error) throw new ErroAgente(error.message)
  return { ok: true as const }
}
