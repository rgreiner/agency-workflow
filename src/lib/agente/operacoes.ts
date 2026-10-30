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
import { notaIdDoAnexo } from '@/lib/fiscal/anexo'
import { danfsePdf, lerNotaParaPdf } from '@/lib/pdf/danfse-render'
import { lerAnexosFaturamento } from '@/lib/email/faturamento'

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

interface Anexo { url?: string; nome?: string; tipo?: string; numero?: string; emitente?: string }

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
  // Cliente: o vínculo (contato_id) manda. O workspace_id é só para entrada antiga sem
  // vínculo — valendo sempre, o FEE cobrado da T2D num projeto da Di Napoli aparecia nas
  // duas (financeiro de grupo via "dois faturamentos de R$ 6.200", 28/10), e conta a
  // pagar de fornecedor do projeto entraria como título do cliente.
  q = c.tipo === 'cliente'
    ? q.or(`and(contato_tipo.eq.cliente,contato_id.eq.${c.id}),and(contato_id.is.null,tipo.eq.entrada,workspace_id.eq.${c.id})`)
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

// ── Rotina diária (mig. 359): régua e documentos do mês pelo WhatsApp ────────

/** Hoje é dia útil (seg–sex, fora de rh_feriado)? E qual é o 1º dia útil do mês? */
export async function agenda(a: AgenteFlow) {
  const { data: hoje, error: e0 } = await a.supabase.rpc('fin_hoje')
  if (e0) throw new Error(e0.message)
  const [util, primeiro] = await Promise.all([
    a.supabase.rpc('fin_dia_util', { p_org: a.orgId, p_data: hoje }),
    a.supabase.rpc('fin_primeiro_dia_util', { p_org: a.orgId, p_mes: hoje }),
  ])
  if (util.error || primeiro.error) throw new Error((util.error ?? primeiro.error)!.message)
  return { hoje: hoje as string, dia_util: !!util.data, primeiro_dia_util: primeiro.data as string }
}

interface ItemRegua {
  lancamento_id: string; bucket: string; passo: number; workspace_id: string; cliente: string
  contato_nome: string; telefone: string; descricao: string; valor: number; vencimento: string; dias: number
}

/** Degraus da régua devidos hoje, com o telefone do financeiro do cliente. */
export async function regua(a: AgenteFlow): Promise<(ItemRegua & { pix_copia_cola: string | null })[]> {
  const { data, error } = await a.supabase.rpc('fin_regua_whatsapp', { p_org: a.orgId })
  if (error) throw new Error(error.message)
  // Pix com o valor em toda cobrança (decisão do Rafael: sempre oferecer o Pix).
  const pix = await criarBuscadorPix(a.supabase)(a.orgId)
  return ((data ?? []) as ItemRegua[]).map(i => ({
    ...i, pix_copia_cola: pixDoTitulo(pix, Number(i.valor), i.lancamento_id.replace(/-/g, '').slice(0, 25)) || null,
  }))
}

/** Cobranças do mês com NF e boleto prontos, ainda não enviadas — já com os links de 72 h. */
export async function documentos(a: AgenteFlow, base: string) {
  const { data, error } = await a.supabase.rpc('fin_documentos_whatsapp', { p_org: a.orgId })
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as (Omit<ItemRegua, 'bucket' | 'passo' | 'dias'> & { nf_numero: string | null; anexos: Anexo[] })[]
  const pix = await criarBuscadorPix(a.supabase)(a.orgId)
  return linhas.flatMap(({ anexos, ...l }) => {
    const link = (tipo: string) => {
      const x = (anexos ?? []).find(an => an.tipo === tipo && an.url && caminhoDoAnexo(an.url))
      return x?.url ? linkAssinado(base, caminhoDoAnexo(x.url)!) : null
    }
    // Boleto é opcional até a integração com o BTG: sem ele, vai NF + Pix.
    const nf = link('NF'), boleto = link('Boleto')
    if (!nf) return []
    const nfNumero = l.nf_numero ?? (anexos ?? []).find(x => x.tipo === 'NF' && x.numero)?.numero ?? null
    return [{
      ...l, nf_numero: nfNumero, nf_url: nf, boleto_url: boleto,
      pix_copia_cola: pixDoTitulo(pix, Number(l.valor), l.lancamento_id.replace(/-/g, '').slice(0, 25)) || null,
    }]
  })
}

export async function registrarEnvio(a: AgenteFlow, tituloId: string, bucket: string, telefone: string) {
  await lancamento(a, tituloId)
  const { error } = await a.supabase.rpc('fin_registrar_envio_whatsapp', { p_lancamento_id: tituloId, p_bucket: bucket, p_telefone: telefone })
  if (error) throw new ErroAgente(error.message)
  return { ok: true as const }
}

// ── NF de fornecedor/veículo que não chegou (mig. 361) ───────────────────────

/** PP e MX/PI sem a NF do fornecedor, no degrau de cobrança de hoje (e-mail → WhatsApp → lembrete). */
export async function nfFornecedor(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_nf_fornecedor_pendente', { p_org: a.orgId })
  if (error) throw new Error(error.message)
  return (data ?? []) as {
    lancamento_id: string; contato_tipo: 'fornecedor' | 'veiculo'; contato_id: string; fornecedor: string
    contato_nome: string | null; email: string | null; telefone: string | null; documento: string | null
    descricao: string; valor: number; vencimento: string; dias: number; bucket: string; canal: 'email' | 'whatsapp'
  }[]
}

/** Registro genérico de envio do agente (e-mail ou WhatsApp), para não repetir o degrau. */
export async function registrarEnvioAgente(a: AgenteFlow, tituloId: string, bucket: string, canal: string, destino: string) {
  await lancamento(a, tituloId)
  const { error } = await a.supabase.rpc('fin_registrar_envio_agente', { p_lancamento_id: tituloId, p_bucket: bucket, p_canal: canal, p_destino: destino })
  if (error) throw new ErroAgente(error.message)
  return { ok: true as const }
}

// ── Documento cancelado: avisar o veículo/fornecedor (mig. 384) ─────────────

/**
 * MX/PP canceladas com lançamento removido, ainda sem o aviso em algum canal
 * (e-mail e WhatsApp, cada um uma vez). O lançamento já não existe: o rastro é
 * documento_cancelamentos, com a foto do que foi removido.
 */
export async function cancelamentos(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_cancelamentos_avisar', { p_org: a.orgId })
  if (error) throw new Error(error.message)
  return (data ?? []) as {
    id: string; origem_tipo: 'midia' | 'producao'; documento: string | null; titulo: string | null; cliente: string | null
    contato_tipo: 'veiculo' | 'fornecedor'; contato_id: string; contato: string; contato_nome: string | null
    email: string | null; telefone: string | null; valor: number
    lancamentos: { descricao: string; valor: number; vencimento: string | null }[]
    cancelado_em: string; email_feito: boolean; whats_feito: boolean
  }[]
}

/** Marca o aviso de cancelamento como enviado naquele canal (não repete). */
export async function cancelamentoAvisado(a: AgenteFlow, id: string, canal: string, destino: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAgente('cancelamento inválido')
  if (canal !== 'email' && canal !== 'whatsapp') throw new ErroAgente('canal inválido')
  const { error } = await a.supabase.rpc('fin_cancelamento_avisado', { p_id: id, p_canal: canal, p_destino: destino })
  if (error) throw new ErroAgente(error.message)
  return { ok: true as const }
}

// ── Documento do fornecedor recebido por e-mail (mig. 362) ──────────────────

/** PP/MX em aberto de um fornecedor/veículo, dizendo o que já tem de NF/boleto dele. */
export async function documentosFornecedor(a: AgenteFlow, tipo: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAgente('contato inválido')
  const { data, error } = await a.supabase.rpc('fin_documentos_fornecedor', { p_org: a.orgId, p_contato_tipo: tipo, p_contato_id: id })
  if (error) throw new ErroAgente(error.message)
  return data as {
    lancamento_id: string; documento: string | null; descricao: string; valor: number; vencimento: string | null
    tem_nf: boolean; tem_boleto: boolean; numeros: string | null
  }[]
}

const MAX_PDF = 10 * 1024 * 1024

/** Grava o PDF no volume (mesmo lugar do upload da tela) e devolve a URL pública. */
async function gravarPdf(base64: string): Promise<string> {
  const buf = Buffer.from(base64 || '', 'base64')
  if (!buf.length || buf.length > MAX_PDF) throw new ErroAgente('arquivo vazio ou maior que 10 MB')
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroAgente('só PDF')
  const { writeFile, mkdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const { randomUUID } = await import('node:crypto')
  const nomeArq = `${randomUUID()}.pdf`
  const dir = path.join(process.env.UPLOAD_DIR || '/app/uploads', 'lancamentos')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, nomeArq), buf)
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://flow.oneaone.com.br').replace(/\/$/, '')
  return `${base}/uploads/lancamentos/${nomeArq}`
}

/**
 * Grava o PDF no volume (mesmo lugar do upload da tela) e ACRESCENTA ao título
 * como documento do fornecedor. Só PDF; nada é removido ou trocado.
 */
export async function anexarDocumento(a: AgenteFlow, b: { titulo_id: string; tipo: string; numero: string; nome: string; conteudo_base64: string }) {
  await lancamento(a, b.titulo_id)
  if (b.tipo !== 'NF' && b.tipo !== 'Boleto') throw new ErroAgente('tipo deve ser NF ou Boleto')
  const url = await gravarPdf(b.conteudo_base64)
  const { data, error } = await a.supabase.rpc('fin_anexar_documento_fornecedor', {
    p_lancamento_id: b.titulo_id,
    p_anexo: { url, nome: (b.nome || 'documento.pdf').slice(0, 200), tipo: b.tipo, numero: (b.numero || '').slice(0, 40) },
  })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: true; repetido?: boolean }
}

// ── Conta da agência recebida por e-mail (mig. 363) ─────────────────────────

/** Contas a pagar em aberto (60 dias para trás, 75 para a frente) para casar com a guia/boleto. */
export async function despesasAbertas(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_despesas_abertas', { p_org: a.orgId })
  if (error) throw new Error(error.message)
  return data as { lancamento_id: string; descricao: string; contato_nome: string | null; categoria: string | null; valor: number; vencimento: string; anexos: string | null }[]
}

/** Atualiza valor/vencimento e (opcional) anexa o PDF numa conta a pagar em aberto. Só depois do Sim. */
export async function atualizarDespesa(a: AgenteFlow, b: { titulo_id: string; valor?: number | null; vencimento?: string | null; tipo?: string; numero?: string; nome?: string; conteudo_base64?: string }) {
  await lancamento(a, b.titulo_id)
  if (b.vencimento && !/^\d{4}-\d{2}-\d{2}$/.test(b.vencimento)) throw new ErroAgente('vencimento inválido (AAAA-MM-DD)')
  const anexo = b.conteudo_base64
    ? { url: await gravarPdf(b.conteudo_base64), nome: (b.nome || 'documento.pdf').slice(0, 200), tipo: b.tipo === 'NF' || b.tipo === 'Invoice' || b.tipo === 'Outro' ? b.tipo : 'Boleto', numero: (b.numero || '').slice(0, 40) }
    : null
  const { data, error } = await a.supabase.rpc('fin_atualizar_despesa_agente', {
    p_lancamento_id: b.titulo_id, p_valor: b.valor ?? null, p_vencimento: b.vencimento || null, p_anexo: anexo,
  })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: true; mudancas?: string[]; sem_mudanca?: boolean }
}

// ── Despesa que o Rafael manda para a Flávia (mig. 364) ─────────────────────
// Mesmo leitor da tela "Lançar despesa" (lerNfFornecedor): o agente não tem um
// leitor paralelo — o que a tela lê, a Flávia lê igual.

const MIME_DESPESA: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Opções para classificar: categorias de despesa, centros e contas (com a padrão). */
export async function opcoesDespesa(a: AgenteFlow) {
  const { categoriaNomes } = await import('@/lib/finance-categorias')
  const [cfg, contas] = await Promise.all([
    a.supabase.from('org_settings').select('finance_categorias, finance_centros_custo').eq('org_id', a.orgId).maybeSingle(),
    a.supabase.from('contas_financeiras').select('id, nome, ativo, favorita').eq('org_id', a.orgId),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const centros = ((cfg.data?.finance_centros_custo ?? []) as any[]).filter(c => !c.arquivado)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ativas = ((contas.data ?? []) as any[]).filter(c => c.ativo)
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categorias: categoriaNomes((cfg.data?.finance_categorias ?? []) as any, 'saida'),
    centros: centros.map(c => String(c.nome)),
    centro_padrao: (centros.find(c => c.padrao)?.nome as string | undefined) ?? null,
    contas: ativas.map(c => ({ id: c.id as string, nome: c.nome as string })),
    conta_padrao: ((ativas.find(c => c.favorita) ?? ativas[0])?.id as string | undefined) ?? null,
  }
}

/** Lê o(s) documento(s) com o leitor da tela, guarda no volume e devolve a leitura + os anexos prontos. */
export async function lerDespesa(a: AgenteFlow, arquivos: { base64: string; mime: string; nome: string }[]) {
  const { lerNfFornecedor } = await import('@/lib/ai/nf-fornecedor')
  const { chaveNome } = await import('@/lib/nomes')
  const opcoes = await opcoesDespesa(a)
  const validos = arquivos.slice(0, 5).filter(f => MIME_DESPESA[f.mime])
  if (!validos.length) return { opcoes, lido: null, anexos: [] }
  const bufs = validos.map(f => ({ bytes: Buffer.from(f.base64, 'base64'), mimeType: f.mime }))
  if (bufs.some(b => !b.bytes.length || b.bytes.length > MAX_PDF)) throw new ErroAgente('arquivo vazio ou maior que 10 MB')

  const { writeFile, mkdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const { randomUUID } = await import('node:crypto')
  const dir = path.join(process.env.UPLOAD_DIR || '/app/uploads', 'lancamentos')
  await mkdir(dir, { recursive: true })
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://flow.oneaone.com.br').replace(/\/$/, '')
  const anexos = []
  for (let i = 0; i < validos.length; i++) {
    const nomeArq = `${randomUUID()}.${MIME_DESPESA[validos[i].mime]}`
    await writeFile(path.join(dir, nomeArq), bufs[i].bytes)
    anexos.push({ url: `${base}/uploads/lancamentos/${nomeArq}`, nome: (validos[i].nome || nomeArq).slice(0, 200), tipo: 'Outro', numero: '' })
  }

  const lido = await lerNfFornecedor(a.orgId, bufs, opcoes.categorias)
  if (!lido) return { opcoes, lido: null, anexos }
  const { data: forns } = await a.supabase.from('fornecedores').select('id, name, legal_name, tax_id').eq('org_id', a.orgId).eq('archived', false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lista = (forns ?? []) as any[]
  let achado = lido.cnpj ? lista.find(f => String(f.tax_id ?? '').replace(/\D/g, '') === lido.cnpj) : null
  if (!achado && lido.emitente) {
    const k = chaveNome(lido.emitente)
    achado = lista.find(f => chaveNome(f.legal_name ?? '') === k || chaveNome(f.name ?? '') === k) ?? null
  }
  // O tipo do anexo segue o que foi lido (cupom/NF → NF; boleto → Boleto).
  const tipoAnexo = lido.numero ? 'NF' : 'Outro'
  return {
    opcoes,
    lido: { ...lido, fornecedor_id: achado?.id ?? null, fornecedor_nome: achado?.name ?? null },
    anexos: anexos.map(x => ({ ...x, tipo: tipoAnexo, numero: lido.numero ?? '' })),
  }
}

/** Lança a despesa aprovada (mesmas réguas da tela). */
export async function lancarDespesa(a: AgenteFlow, d: Record<string, unknown>) {
  const { data, error } = await a.supabase.rpc('fin_lancar_despesa_agente', { p_org: a.orgId, p_data: d })
  if (error) throw new ErroAgente(error.message)
  return { lancamento_id: data as string }
}

/** Cliente da PP/MX (para repassar a NF/boleto do fornecedor) — mig. 366. */
export async function clienteDoTitulo(a: AgenteFlow, tituloId: string) {
  await lancamento(a, tituloId)
  const { data, error } = await a.supabase.rpc('fin_cliente_do_titulo', { p_lancamento_id: tituloId })
  if (error) throw new ErroAgente(error.message)
  return data as { workspace_id: string; cliente: string; email: string | null; contato_nome: string | null; documento: string | null } | null
}

/**
 * Dados oficiais da agência que o agente pode informar (razão social, CNPJ,
 * endereço, banco/agência/conta e Pix) — vêm das Configurações da org, sem cópia.
 */
export async function empresa(a: AgenteFlow) {
  const { data, error } = await a.supabase.from('org_settings')
    .select('agency_info, payment_info, pix_chave, pix_nome').eq('org_id', a.orgId).maybeSingle()
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info = (data?.agency_info ?? {}) as any
  const cnpj = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/.exec(String(info.cnpjFone ?? ''))?.[1] ?? null
  return {
    nome: info.nome ?? null, razao: info.razao ?? null, cnpj, endereco: info.endereco ?? null, cidade: info.cidade ?? null,
    pagamento: data?.payment_info ?? null, pix_chave: data?.pix_chave ?? null, pix_nome: data?.pix_nome ?? null,
  }
}

/**
 * Busca contatos por nome/razão social (cliente, fornecedor, veículo) com os
 * telefones e e-mails cadastrados — para o agente achar "a Gi do financeiro do
 * É O Amor" quando o Rafael pede para falar com ela.
 */
export async function buscarContatos(a: AgenteFlow, termo: string) {
  const t = termo.trim()
  if (t.length < 2) throw new ErroAgente('termo curto demais')
  const padrao = `%${t.replace(/[%_]/g, '')}%`
  // CNPJ (14 dígitos): acha pelo cadastro, com ou sem máscara — é como a Flávia
  // reconhece o emitente de uma NF que chega de um e-mail fora do cadastro.
  const d = t.replace(/\D/g, '')
  const filtro = d.length === 14 && d.length === t.replace(/[\s./-]/g, '').length
    ? `tax_id.eq.${d},tax_id.eq.${d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`
    : `name.ilike.${padrao},legal_name.ilike.${padrao}`
  const tipos: TipoContato[] = ['cliente', 'fornecedor', 'veiculo']
  const listas = await Promise.all(tipos.map(async tipo => {
    const extra = tipo === 'cliente' ? ', phone, finance_email' : ''
    const { data, error } = await a.supabase.from(TABELA[tipo])
      .select(`id, name, legal_name, telefones, emails${extra}`)
      .eq('org_id', a.orgId).eq('archived', false)
      .or(filtro).limit(5)
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map(c => ({
      tipo, id: c.id as string, nome: c.name as string, empresa: (c.legal_name || c.name) as string,
      telefones: [...(c.telefones ?? []), ...(c.phone ? [{ tipo: 'Principal', numero: c.phone }] : [])] as { tipo?: string; numero?: string }[],
      emails: [...(c.emails ?? []), ...(c.finance_email ? [{ tipo: 'Financeiro', email: c.finance_email }] : [])] as { tipo?: string; email?: string }[],
    }))
  }))
  return listas.flat().slice(0, 8)
}

/**
 * Detalhe de títulos para a MESA do Rafael decidir sem abrir o Flow: documento
 * (PP/MX), contato, cliente da PP, valor, vencimento, situação e o que já está anexado.
 */
export async function titulosDetalhe(a: AgenteFlow, ids: string[]) {
  const validos = ids.filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 30)
  if (!validos.length) return []
  const { data, error } = await a.supabase.from('lancamentos_doc')
    .select('id, org_id, doc_serie, doc_numero, tipo, contato_tipo, contato_nome, descricao, valor, vencimento, situacao, anexos, origem_tipo')
    .in('id', validos)
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = ((data ?? []) as any[]).filter(l => l.org_id === a.orgId)
  return Promise.all(linhas.map(async l => {
    const cliente = l.origem_tipo === 'producao' || l.origem_tipo === 'midia'
      ? ((await a.supabase.rpc('fin_cliente_do_titulo', { p_lancamento_id: l.id })).data as { cliente?: string } | null)?.cliente ?? null
      : null
    return {
      id: l.id as string,
      documento: [l.doc_serie, l.doc_numero].filter(Boolean).join(' ') || null,
      tipo: l.tipo as string, contato_tipo: l.contato_tipo as string | null, contato_nome: l.contato_nome as string | null,
      cliente, descricao: l.descricao as string | null, valor: Math.abs(Number(l.valor)), vencimento: l.vencimento as string | null,
      situacao: l.situacao as string,
      anexos: ((l.anexos ?? []) as Anexo[]).map(x => ({ tipo: x.tipo ?? 'Outro', numero: x.numero ?? '', nome: x.nome ?? '', emitente: (x as { emitente?: string }).emitente ?? null })),
    }
  }))
}

/**
 * Clientes com cobrança automática que ficam FORA da régua por não ter telefone
 * marcado como Financeiro (mig. 367) — a lista de de-para do Rafael, com o link
 * do cadastro no Flow.
 */
export async function clientesSemFinanceiro(a: AgenteFlow) {
  const [lista, org] = await Promise.all([
    a.supabase.rpc('fin_clientes_sem_financeiro', { p_org: a.orgId }),
    a.supabase.from('organizations').select('slug').eq('id', a.orgId).maybeSingle(),
  ])
  if (lista.error) throw new ErroAgente(lista.error.message)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://flow.oneaone.com.br').replace(/\/$/, '')
  const slug = (org.data as { slug: string } | null)?.slug
  return ((lista.data ?? []) as { id: string; cliente: string; em_aberto: number }[]).map((c) => ({
    ...c, link: slug ? `${base}/${slug}/workspaces/${c.id}` : null,
  }))
}

/**
 * Comissões de PP/MX (mig. 368): as que esperam a NFS-e do Rafael (a_emitir) e
 * as já emitidas que ainda não foram ao fornecedor/veículo (a_enviar).
 */
export async function comissoesNf(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_comissoes_nf', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data as {
    a_emitir: { titulo_id: string; documento: string | null; fornecedor: string; valor: number; vencimento: string | null }[]
    a_enviar: { titulo_id: string; documento: string | null; fornecedor: string; contato_nome: string | null; email: string; valor: number; vencimento: string | null; nota_numero: string | null }[]
  }
}

/**
 * Os PDFs da AGÊNCIA no título, para mandar ao fornecedor: a NFS-e emitida pelo
 * Flow (DANFSe gerado na hora, com o estado atual da nota) e o boleto da agência,
 * se houver. Documento do fornecedor não vai — ele já tem.
 */
export async function comissaoDocumentos(a: AgenteFlow, tituloId: string) {
  const l = await lancamento(a, tituloId)
  // Boleto sem emitente também é da agência: o que chega do fornecedor pela Flávia já vem
  // marcado 'fornecedor' (mig. 362), e o anexado à mão costuma ficar sem o campo (ME 1578, 30/10).
  const daAgencia = (l.anexos ?? []).filter(x => x.url && (x.emitente === 'agencia' || (x.tipo === 'Boleto' && !x.emitente)))
  const arquivos: { nome: string; base64: string }[] = []
  const notasVistas = new Set<string>()
  const pdfDaNota = async (notaId: string, nome?: string) => {
    if (notasVistas.has(notaId)) return
    notasVistas.add(notaId)
    const nota = await lerNotaParaPdf(notaId, a.supabase)
    if (nota && !nota.cancelada) arquivos.push({ nome: nome || `${nota.baseNome}.pdf`, base64: (await danfsePdf(nota)).toString('base64') })
  }
  for (const x of daAgencia) {
    const notaId = notaIdDoAnexo(x.url!)
    if (notaId) { await pdfDaNota(notaId, x.nome); continue }
    for (const f of await lerAnexosFaturamento([x as never])) arquivos.push({ nome: f.filename, base64: f.content.toString('base64') })
  }
  // Só a tela de faturamento pendura a NFS-e como anexo; emitida pela tela do lançamento
  // ou pela Flávia (emitirNfse) ela fica só em nota_fiscal — e é por lá que o
  // fin_comissoes_nf a põe em "a enviar". Sem isto o Sim falhava com "não está no título".
  const { data: notas, error } = await a.supabase.from('nota_fiscal').select('id')
    .eq('org_id', a.orgId).eq('lancamento_id', tituloId).eq('status', 'autorizada').eq('ambiente', 'producao')
  if (error) throw new Error(error.message)
  for (const n of (notas ?? []) as { id: string }[]) await pdfDaNota(n.id)
  return { arquivos }
}

/** Régua da comissão em atraso com fornecedor/veículo (mig. 369): degrau de hoje e as que já são do Rafael. */
export async function reguaComissao(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_regua_comissao', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data as {
    a_cobrar: { titulo_id: string; documento: string | null; fornecedor: string; contato_nome: string | null; email: string; valor: number; vencimento: string; dias: number; bucket: string }[]
    com_rafael: { titulo_id: string; documento: string | null; fornecedor: string; valor: number; vencimento: string; dias: number; motivo: string }[]
  }
}

// ── NFS-e emitidas pelo Flow: consulta e cancelamento (só depois do Sim do Rafael) ──

/**
 * Notas autorizadas de um título ou de um cliente, dizendo até quando ainda dá para
 * cancelar (regra da casa: só dentro do mês da competência).
 */
export async function notasFiscais(a: AgenteFlow, filtro: { titulo_id?: string; cliente_id?: string }) {
  let ids: string[] = []
  if (filtro.titulo_id) {
    await lancamento(a, filtro.titulo_id)
    ids = [filtro.titulo_id]
  } else if (filtro.cliente_id && /^[0-9a-f-]{36}$/i.test(filtro.cliente_id)) {
    const { data, error } = await a.supabase.from('lancamentos').select('id')
      .eq('org_id', a.orgId).eq('workspace_id', filtro.cliente_id).limit(1000)
    if (error) throw new ErroAgente(error.message)
    ids = ((data ?? []) as { id: string }[]).map(l => l.id)
  } else {
    throw new ErroAgente('informe titulo_id ou cliente_id')
  }
  if (!ids.length) return []
  const { data, error } = await a.supabase.from('nota_fiscal')
    .select('id, lancamento_id, numero, status, ambiente, valor, competencia, emitido_em, tomador_nome')
    .eq('org_id', a.orgId).in('lancamento_id', ids).order('emitido_em')
  if (error) throw new ErroAgente(error.message)
  const { data: ls } = await a.supabase.from('lancamentos')
    .select('id, descricao, vencimento, situacao').in('id', ids)
  const porId = new Map(((ls ?? []) as { id: string; descricao: string | null; vencimento: string | null; situacao: string }[]).map(l => [l.id, l]))
  const { limiteDeCancelamento, podeCancelarAinda } = await import('@/lib/fiscal/cancelamento')
  return ((data ?? []) as { id: string; lancamento_id: string; numero: string | null; status: string; ambiente: string; valor: number | null; competencia: string | null; emitido_em: string; tomador_nome: string | null }[]).map(n => ({
    nota_id: n.id, numero: n.numero, status: n.status, ambiente: n.ambiente,
    valor: n.valor != null ? Number(n.valor) : null, competencia: n.competencia, tomador: n.tomador_nome,
    titulo_id: n.lancamento_id, titulo: porId.get(n.lancamento_id)?.descricao ?? null,
    vencimento: porId.get(n.lancamento_id)?.vencimento ?? null, situacao_titulo: porId.get(n.lancamento_id)?.situacao ?? null,
    cancelavel_ate: limiteDeCancelamento(n.competencia, n.emitido_em),
    cancelavel: n.status === 'autorizada' && podeCancelarAinda(n.competencia, n.emitido_em),
  }))
}

/** Cancela na Receita uma NFS-e emitida pelo Flow. Quem chama já tem o Sim do Rafael. */
export async function cancelarNotaFiscal(a: AgenteFlow, notaId: string, motivo: string) {
  if (!/^[0-9a-f-]{36}$/i.test(notaId)) throw new ErroAgente('nota inválida')
  const { cancelarNotaNaReceita } = await import('@/lib/fiscal/cancelamento')
  const r = await cancelarNotaNaReceita(a.supabase, a.orgId, a.userId, notaId, { cMotivo: '9', xMotivo: motivo })
  if (r.error) throw new ErroAgente(r.error)
  if (r.lancamentoId) {
    await a.supabase.rpc('lancamento_anotar', { p_lancamento_id: r.lancamentoId, p_texto: `NFS-e cancelada — ${motivo} — via ${a.nome}` })
  }
  return { ok: true as const }
}

/** Rescisões em andamento (mig. 370): só datas e cargo, nada de CPF/salário. */
export async function rescisoes(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_rescisoes', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data as {
    colaborador_id: string; nome: string; cargo: string | null; status: string; aviso_modo: string | null
    aviso_ini: string | null; aviso_fim: string | null; demissao: string | null; ultimo_dia: string | null; dias_uteis_ate_ultimo: number | null
  }[]
}

export async function btgConciliado(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_btg_conciliado', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: boolean; motivo: string | null; extrato_ate: string | null; exigido_ate: string; pendentes: number }
}

/** Envio que a Meta não entregou: tira o degrau do histórico para a régua refazer (mig. 377). */
export async function desfazerEnvio(a: AgenteFlow, tituloId: string, bucket: string) {
  await lancamento(a, tituloId)
  const { data, error } = await a.supabase.rpc('fin_desfazer_envio_agente', { p_lancamento_id: tituloId, p_bucket: bucket })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: true; removidos: number }
}

// ── Folha: fechamento do ponto conduzido pela agente (mig. 378) ─────────────

/** Ciclo que acabou de terminar: quem falta fechar, aprovações de ponto pendentes, dias úteis do mês por pessoa. Sem CPF nem salário. */
export async function folhaSituacao(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_folha_situacao', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data
}

/** Fecha o ciclo das pessoas escolhidas (sócio/estagiário: sem envio). Só depois do Sim do Rafael. */
export async function folhaFechar(a: AgenteFlow, competencia: string, pessoas: string[], semEnvio: boolean) {
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new ErroAgente('competência inválida')
  if (!pessoas.length) throw new ErroAgente('nenhuma pessoa para fechar')
  const { data, error } = await a.supabase.rpc('rh_fechar_ciclo', {
    p_org_id: a.orgId, p_competencia: `${competencia}-01`, p_pessoas: pessoas.map((id) => ({ id })),
  })
  if (error) throw new ErroAgente(error.message)
  const runId = (data as { run_id: string }).run_id
  if (semEnvio) {
    const { error: e2 } = await a.supabase.rpc('rh_fechamento_sem_envio', { p_run: runId, p_sem_envio: true })
    if (e2) throw new ErroAgente(e2.message)
  }
  return { run_id: runId }
}

/** Envia à contabilidade o pacote do fechamento (o mesmo da tela). O CPF fica aqui dentro: a resposta não leva. */
export async function folhaEnviar(a: AgenteFlow, runId: string, dados: { vr: number | null; vt: number | null; corpo: string }) {
  const { data, error } = await a.supabase.rpc('fin_folha_pacote', { p_run: runId })
  if (error) throw new ErroAgente(error.message)
  const p = data as { org_id: string; id: string; competencia: string; ini: string; fim: string; status: string; enviado_em: string | null; sem_envio: boolean
    linhas: import('@/app/actions/rh-fechamento').RunRhLinha[]; destinatarios: string[] | null; logo_url: string | null }
  if (p.org_id !== a.orgId) throw new ErroAgente('fechamento de outra organização', 403)
  if (p.sem_envio) throw new ErroAgente('ciclo interno (sem envio)')
  const { enviarPacoteFechamento } = await import('@/lib/rh/envio-fechamento')
  const r = await enviarPacoteFechamento(a.supabase, a.orgId, a.userId,
    { run: p, linhas: p.linhas, destinatarios: p.destinatarios ?? [], logoUrl: p.logo_url }, dados)
  if (r.error) throw new ErroAgente(r.error)
  return { ok: true as const, destinatarios: r.destinatarios ?? [] }
}

/** Férias programadas e admissões recentes (mig. 380): nome, datas e cargo — sem CPF nem salário. */
export async function dpAgenda(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_dp_agenda', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data
}

/** Todos os contatos ativos (só tipo, id, nome e razão) — para o de-para das conversas importadas. */
export async function contatosNomes(a: AgenteFlow) {
  const tipos: TipoContato[] = ['cliente', 'fornecedor', 'veiculo']
  const listas = await Promise.all(tipos.map(async tipo => {
    const { data, error } = await a.supabase.from(TABELA[tipo])
      .select('id, name, legal_name').eq('org_id', a.orgId).eq('archived', false).limit(2000)
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map(c => ({ tipo, id: c.id as string, nome: c.name as string, empresa: (c.legal_name || c.name) as string }))
  }))
  return listas.flat()
}

/** Totais do caixa para a mesa (mig. 381): em atraso, recebido hoje, semana a receber × a pagar. */
export async function resumoMesa(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_resumo_mesa', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data
}

/** Recebimentos do mês × mesmo mês do ano anterior, por dia (mig. 382) — gráfico da mesa. */
export async function recebimentosComparados(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_recebimentos_comparados', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data
}

// ── Consulta financeira ampla (assistente financeira do Rafael) ────────────────
// Só leitura, com a RLS de financeiro da usuária do agente. Usada no chat com o
// Rafael ("quais cobranças estão atrasadas?") — nunca no atendimento a contato.

const hojeBRT = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const doc = (l: { doc_serie?: string | null; doc_numero?: number | null }) => [l.doc_serie, l.doc_numero].filter(Boolean).join(' ') || null
const LANC = 'id, doc_serie, doc_numero, tipo, contato_tipo, contato_nome, descricao, valor, vencimento, situacao, origem_tipo, data_liquidacao, categoria, anexos'

type Linha = { id: string; doc_serie: string | null; doc_numero: number | null; tipo: string; contato_tipo: string | null; contato_nome: string | null
  descricao: string | null; valor: number; vencimento: string | null; situacao: string; origem_tipo: string | null; data_liquidacao: string | null
  categoria: string | null; anexos: Anexo[] | null }

const item = (l: Linha, hoje: string) => ({
  id: l.id, documento: doc(l), contato: l.contato_nome ?? '(sem contato)', contato_tipo: l.contato_tipo, descricao: l.descricao,
  valor: Math.abs(Number(l.valor)), vencimento: l.vencimento, situacao: l.situacao,
  dias_atraso: l.vencimento && l.vencimento < hoje && l.situacao === 'em_aberto'
    ? Math.round((Date.parse(hoje) - Date.parse(l.vencimento)) / 86_400_000) : 0,
  categoria: l.categoria, liquidado_em: l.data_liquidacao,
})

/**
 * Clientes em atraso para a mesa da Flávia, um por cliente, com a promessa de cada
 * título (promessa_data em dia segura a régua — mig. 189/359). É de onde o Rafael
 * informa "nova data combinada", "aguardar uma semana" ou o que o cliente disse.
 */
export async function cobrancaClientes(a: AgenteFlow) {
  const hoje = hojeBRT()
  const { data, error } = await a.supabase.from('lancamentos_doc').select(LANC).eq('org_id', a.orgId).eq('tipo', 'entrada')
    .eq('situacao', 'em_aberto').eq('contato_tipo', 'cliente').is('transferencia_id', null).lt('vencimento', hoje)
    .not('contato_nome', 'is', null).order('vencimento').limit(300)
  if (error) throw new ErroAgente(error.message)
  const ls = (data ?? []) as unknown as Linha[]
  const ids = ls.map(l => l.id)
  const { data: pr, error: e2 } = ids.length
    ? await a.supabase.from('lancamentos').select('id, promessa_data, promessa_obs').in('id', ids)
    : { data: [], error: null }
  if (e2) throw new ErroAgente(e2.message)
  const promessa = new Map(((pr ?? []) as { id: string; promessa_data: string | null; promessa_obs: string | null }[]).map(p => [p.id, p]))
  const porCliente = new Map<string, { cliente: string; total: number; titulos: (ReturnType<typeof item> & { promessa_data: string | null; promessa_obs: string | null })[] }>()
  for (const l of ls) {
    const i = item(l, hoje)
    const p = promessa.get(l.id)
    const g = porCliente.get(i.contato) ?? { cliente: i.contato, total: 0, titulos: [] }
    g.titulos.push({ ...i, promessa_data: p?.promessa_data ?? null, promessa_obs: p?.promessa_obs ?? null })
    g.total = Math.round((g.total + i.valor) * 100) / 100
    porCliente.set(i.contato, g)
  }
  return { hoje, clientes: [...porCliente.values()].sort((x, y) => y.total - x.total) }
}

export async function financeiroConsulta(a: AgenteFlow, consulta: string, p: Record<string, unknown>) {
  const hoje = hojeBRT()
  const texto = typeof p.texto === 'string' ? p.texto.trim().replace(/[%_,()]/g, ' ') : ''
  const dias = p.dias === undefined || p.dias === null || p.dias === "" || Number.isNaN(Number(p.dias)) ? 30 : Math.min(Math.max(Math.round(Number(p.dias)), 0), 180)  // 0 = só hoje

  if (consulta === 'a_receber' || consulta === 'a_pagar') {
    const tipo = consulta === 'a_receber' ? 'entrada' : 'saida'
    const filtro = (p.situacao as string) || 'todos'   // vencidos | a_vencer | todos
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder reatribuído estoura a inferência do supabase-js
    let q: any = a.supabase.from('lancamentos_doc').select(LANC).eq('org_id', a.orgId).eq('tipo', tipo)
      .eq('situacao', 'em_aberto').is('transferencia_id', null).not('vencimento', 'is', null)
    if (filtro === 'vencidos') q = q.lt('vencimento', hoje)
    else if (filtro === 'a_vencer') q = q.gte('vencimento', hoje).lte('vencimento', somaDias(hoje, dias))
    else q = q.lte('vencimento', somaDias(hoje, dias))
    // a receber: "clientes" = cliente; "comissoes" = comissão de fornecedor/veículo (PP/MX)
    if (p.origem === 'clientes') q = q.eq('contato_tipo', 'cliente')
    else if (p.origem === 'comissoes') q = q.in('contato_tipo', ['fornecedor', 'veiculo'])
    if (!p.incluir_sem_contato) q = q.not('contato_nome', 'is', null)
    if (texto) q = q.or(`contato_nome.ilike.%${texto}%,descricao.ilike.%${texto}%`)
    const { data, error } = await q.order('vencimento').limit(200)
    if (error) throw new ErroAgente(error.message)
    const itens = ((data ?? []) as unknown as Linha[]).map(l => item(l, hoje))
    const vencidos = itens.filter(i => i.dias_atraso > 0)
    const soma = (xs: { valor: number }[]) => Math.round(xs.reduce((s, x) => s + x.valor, 0) * 100) / 100
    return {
      hoje, filtro, total: { n: itens.length, valor: soma(itens) },
      vencidos: { n: vencidos.length, valor: soma(vencidos) },
      a_vencer: { n: itens.length - vencidos.length, valor: soma(itens.filter(i => i.dias_atraso === 0)) },
      itens: itens.slice(0, 60), cortado: itens.length > 60,
    }
  }

  if (consulta === 'caixa') {
    const [contas, resumo, btg] = await Promise.all([
      a.supabase.from('contas_saldo').select('nome, tipo, saldo_atual, saldo_banco, saldo_banco_data, ativo').eq('org_id', a.orgId),
      a.supabase.rpc('fin_resumo_mesa', { p_org: a.orgId }),
      a.supabase.rpc('fin_btg_conciliado', { p_org: a.orgId }),
    ])
    if (contas.error) throw new ErroAgente(contas.error.message)
    return {
      hoje,
      contas: ((contas.data ?? []) as { nome: string; tipo: string; saldo_atual: number; saldo_banco: number | null; saldo_banco_data: string | null; ativo: boolean }[])
        .filter(c => c.ativo !== false).map(c => ({ conta: c.nome, saldo_flow: Number(c.saldo_atual), saldo_banco: c.saldo_banco, extrato_ate: c.saldo_banco_data })),
      resumo: resumo.data, btg: btg.data,
    }
  }

  if (consulta === 'realizado') {
    const de = /^\d{4}-\d{2}-\d{2}$/.test(String(p.de)) ? String(p.de) : `${hoje.slice(0, 7)}-01`
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.ate)) ? String(p.ate) : hoje
    const { data, error } = await a.supabase.from('lancamentos_doc').select(LANC).eq('org_id', a.orgId)
      .in('situacao', ['recebido', 'pago']).is('transferencia_id', null).gte('data_liquidacao', de).lte('data_liquidacao', ate)
      .order('data_liquidacao').limit(1000)
    if (error) throw new ErroAgente(error.message)
    const ls = (data ?? []) as unknown as Linha[]
    const agrupa = (tipo: string) => {
      const xs = ls.filter(l => l.tipo === tipo)
      const por = new Map<string, number>()
      for (const l of xs) { const k = l.contato_nome ?? l.categoria ?? l.descricao ?? '—'; por.set(k, (por.get(k) ?? 0) + Math.abs(Number(l.valor))) }
      return {
        total: Math.round(xs.reduce((s, l) => s + Math.abs(Number(l.valor)), 0) * 100) / 100, n: xs.length,
        maiores: [...por].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([quem, valor]) => ({ quem, valor: Math.round(valor * 100) / 100 })),
      }
    }
    return { de, ate, recebido: agrupa('entrada'), pago: agrupa('saida') }
  }

  if (consulta === 'buscar') {
    if (texto.length < 2) throw new ErroAgente('informe o que procurar (documento, cliente, fornecedor ou descrição)')
    const m = /^([A-Za-z]{1,4})\s*0*(\d{1,7})$/.exec(texto)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder reatribuído estoura a inferência do supabase-js
    let q: any = a.supabase.from('lancamentos_doc').select(LANC).eq('org_id', a.orgId).is('transferencia_id', null)
    q = m ? q.ilike('doc_serie', m[1]).eq('doc_numero', Number(m[2]))
      : q.or(`contato_nome.ilike.%${texto}%,descricao.ilike.%${texto}%`)
    const { data, error } = await q.order('vencimento', { ascending: false }).limit(25)
    if (error) throw new ErroAgente(error.message)
    return ((data ?? []) as unknown as Linha[]).map(l => ({
      ...item(l, hoje), tipo: l.tipo === 'entrada' ? 'a receber' : 'a pagar',
      anexos: (l.anexos ?? []).map(x => `${x.tipo ?? 'Outro'}${x.numero ? ` ${x.numero}` : ''}${(x as { emitente?: string }).emitente ? ` (${(x as { emitente?: string }).emitente})` : ''}`),
    }))
  }

  if (consulta === 'nf_pendentes') {
    // PP/MX (comissão a receber de fornecedor/veículo) em aberto sem a NF do fornecedor anexada
    const { data, error } = await a.supabase.from('lancamentos_doc').select(LANC).eq('org_id', a.orgId)
      .eq('tipo', 'entrada').eq('situacao', 'em_aberto').in('origem_tipo', ['producao', 'midia'])
      .in('contato_tipo', ['fornecedor', 'veiculo']).order('vencimento').limit(300)
    if (error) throw new ErroAgente(error.message)
    const sem = ((data ?? []) as unknown as Linha[]).filter(l => !(l.anexos ?? []).some(x => x.tipo === 'NF' && (x as { emitente?: string }).emitente === 'fornecedor'))
    return { n: sem.length, itens: sem.slice(0, 60).map(l => item(l, hoje)) }
  }

  if (consulta === 'previsao_mes') {
    // "Quanto do que está em aberto vira caixa até o fim do mês?" — títulos a receber vencidos
    // ou vencendo até o último dia do mês, com a promessa registrada e o último contato de cobrança.
    const fim = somaDias(`${somaDias(`${hoje.slice(0, 7)}-01`, 32).slice(0, 7)}-01`, -1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder reatribuído estoura a inferência do supabase-js
    let q: any = a.supabase.from('lancamentos_doc').select(LANC).eq('org_id', a.orgId).eq('tipo', 'entrada')
      .eq('situacao', 'em_aberto').is('transferencia_id', null).lte('vencimento', fim)
    if (!p.incluir_sem_contato) q = q.not('contato_nome', 'is', null)
    const [abertos, recebidos] = await Promise.all([
      q.order('vencimento').limit(300),
      a.supabase.from('lancamentos_doc').select('valor').eq('org_id', a.orgId).eq('tipo', 'entrada').eq('situacao', 'recebido')
        .is('transferencia_id', null).gte('data_liquidacao', `${hoje.slice(0, 7)}-01`).lte('data_liquidacao', hoje),
    ])
    if (abertos.error) throw new ErroAgente(abertos.error.message)
    const ls = (abertos.data ?? []) as unknown as Linha[]
    const ids = ls.map(l => l.id)
    const [prom, avisos] = ids.length ? await Promise.all([
      a.supabase.from('lancamentos').select('id, promessa_data, promessa_obs').in('id', ids),
      a.supabase.from('cobranca_avisos').select('lancamento_id, bucket, canal, sent_at').in('lancamento_id', ids).order('sent_at', { ascending: false }),
    ]) : [{ data: [] }, { data: [] }]
    const pm = new Map(((prom.data ?? []) as { id: string; promessa_data: string | null; promessa_obs: string | null }[]).map(x => [x.id, x]))
    const ult = new Map<string, { bucket: string; canal: string; sent_at: string }>()
    for (const x of (avisos.data ?? []) as { lancamento_id: string; bucket: string; canal: string; sent_at: string }[]) if (!ult.has(x.lancamento_id)) ult.set(x.lancamento_id, x)
    const itens = ls.map(l => {
      const pr = pm.get(l.id), av = ult.get(l.id)
      const i = item(l, hoje)
      const grupo = pr?.promessa_data ? (pr.promessa_data <= fim ? 'prometido_no_mes' : 'prometido_depois')
        : i.dias_atraso > 0 ? 'vencido_sem_promessa' : 'a_vencer'
      return { ...i, grupo, promessa: pr?.promessa_data ?? null, promessa_obs: pr?.promessa_obs ?? null,
        ultimo_contato: av ? `${av.sent_at.slice(0, 10)} · ${av.canal} · ${av.bucket}` : null }
    })
    const soma = (g: string) => Math.round(itens.filter(i => i.grupo === g).reduce((s2, i) => s2 + i.valor, 0) * 100) / 100
    const recebido = Math.round(((recebidos.data ?? []) as { valor: number }[]).reduce((s2, x) => s2 + Math.abs(Number(x.valor)), 0) * 100) / 100
    return {
      hoje, fim_do_mes: fim, recebido_no_mes: recebido,
      prometido_no_mes: soma('prometido_no_mes'), a_vencer: soma('a_vencer'),
      vencido_sem_promessa: soma('vencido_sem_promessa'), prometido_depois: soma('prometido_depois'),
      itens: itens.slice(0, 80),
    }
  }

  throw new ErroAgente('consulta desconhecida (a_receber, a_pagar, caixa, realizado, buscar, nf_pendentes, previsao_mes)')
}


/** Promessa de pagamento num título a receber (silencia a régua até a data). data null = tira a promessa. */
export async function registrarPromessa(a: AgenteFlow, tituloId: string, data: string | null, obs: string | null) {
  await lancamento(a, tituloId)
  if (data !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroAgente('data inválida (AAAA-MM-DD)')
  const { error } = await a.supabase.rpc('set_lancamento_promessa', { p_user_id: a.userId, p_lancamento_id: tituloId, p_data: data, p_obs: obs })
  if (error) throw new ErroAgente(error.message)
  return { ok: true as const }
}

/** Acordo parcelado (mig. 384): os títulos viram 'renegociado' e nascem N parcelas sem juros. */
export async function renegociar(a: AgenteFlow, titulos: string[], parcelas: number, primeiroVenc: string, obs: string | null) {
  const ids = titulos.filter(id => /^[0-9a-f-]{36}$/i.test(id))
  if (!ids.length) throw new ErroAgente('informe os títulos')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiroVenc)) throw new ErroAgente('primeiro vencimento inválido (AAAA-MM-DD)')
  const { data, error } = await a.supabase.rpc('fin_renegociar', { p_org: a.orgId, p_titulos: ids, p_parcelas: parcelas, p_primeiro_venc: primeiroVenc, p_obs: obs })
  if (error) throw new ErroAgente(error.message)
  return data
}

// ── Folha da Ocvel lida pela agente (mig. 385) — o mesmo caminho da tela RH → Folha ──

/**
 * Lê o PDF da folha (geral ou recibos) com a IA da org, importa a competência no RH
 * (sem criar ficha nova: quem não casar volta como pendente) e devolve o plano de
 * conciliação com os lançamentos de pagamento. Não mexe no financeiro.
 */
export async function folhaLer(a: AgenteFlow, pdfBase64: string) {
  const { pdfToText, extrairFolha } = await import('@/lib/ai/folha')
  const { iaDaOrg } = await import('@/lib/ai/provedor')
  const bytes = Buffer.from(pdfBase64, 'base64')
  if (bytes.length < 500) throw new ErroAgente('PDF vazio')
  const texto = await pdfToText(bytes)
  if (texto.trim().length < 50) throw new ErroAgente('não consegui ler texto do PDF (digitalizado?)')
  const folha = await extrairFolha(texto, await iaDaOrg(a.orgId))
  if (!folha) throw new ErroAgente('IA da org não configurada', 503)
  if (!folha.competencia || !folha.linhas.length) throw new ErroAgente('não reconheci a competência ou os trabalhadores neste PDF')
  const comp = `${folha.competencia}-01`
  const imp = await a.supabase.rpc('rh_importar_folha', { p_org_id: a.orgId, p_competencia: comp, p_linhas: folha.linhas, p_auto_criar: false })
  if (imp.error) throw new ErroAgente(imp.error.message)
  const plano = await a.supabase.rpc('rh_folha_plano', { p_org_id: a.orgId, p_competencia: comp })
  if (plano.error) throw new ErroAgente(plano.error.message)
  return { competencia: folha.competencia, importacao: imp.data, plano: plano.data }
}

/** Aplica os salários do plano nos lançamentos (vincular = valor vira o líquido; criar = lançamento novo). Só após o Sim. */
export async function folhaAplicar(a: AgenteFlow, competencia: string, salarios: unknown[]) {
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new ErroAgente('competência inválida')
  const { data, error } = await a.supabase.rpc('rh_folha_aplicar', {
    p_org_id: a.orgId, p_competencia: `${competencia}-01`, p_salarios: salarios,
    p_inss: 0, p_venc_inss: null, p_fgts: 0, p_venc_fgts: null, p_inss_lanc: null, p_fgts_lanc: null,
  })
  if (error) throw new ErroAgente(error.message)
  return data
}

// ── Fila do Faturamento pela Flávia (mig. 386) ──────────────────────────────
// Decisão do Rafael (28/10): duas vezes ao dia ela confere a fila e FATURA
// SOZINHA o que está completo; o que falta vira pendência. A NFS-e da agência
// sai no faturamento quando a NF do veículo já veio; sem ela, no mês do vencimento.

export interface ItemFila {
  tipo: 'midia' | 'producao'; id: string; numero: number | null; documento: string | null; titulo: string | null
  cliente_id: string | null; cliente: string | null
  contraparte_tipo: string | null; contraparte_id: string | null; contraparte: string | null
  valor: number; a_receber: number; quem_paga: string
  vencimento_contraparte: string | null; vencimento_agencia: string | null
  tem_nf: boolean; tem_boleto: boolean; numeros: string | null
  faltas: string[]; liberado_em: string
}

export async function faturamentoFila(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_faturamento_fila', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data as ItemFila[]
}

export async function faturar(a: AgenteFlow, tipo: string, id: string) {
  if (tipo !== 'midia' && tipo !== 'producao') throw new ErroAgente('tipo deve ser midia ou producao')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAgente('documento inválido')
  const { data, error } = await a.supabase.rpc('fin_faturar_agente', { p_org: a.orgId, p_tipo: tipo, p_id: id })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: true; lancamentos: { lancamento_id: string; contato_tipo: string; contato: string; descricao: string; valor: number; vencimento: string; nf_fornecedor: boolean }[] }
}

/** NF/boleto do veículo/fornecedor para um documento ainda na fila: grava o PDF e acrescenta aos anexos dele. */
export async function anexarDocumentoFila(a: AgenteFlow, b: { tipo: string; id: string; tipo_anexo: string; numero: string; nome: string; conteudo_base64: string }) {
  if (b.tipo_anexo !== 'NF' && b.tipo_anexo !== 'Boleto') throw new ErroAgente('tipo_anexo deve ser NF ou Boleto')
  if (!/^[0-9a-f-]{36}$/i.test(b.id)) throw new ErroAgente('documento inválido')
  const url = await gravarPdf(b.conteudo_base64)
  const { data, error } = await a.supabase.rpc('fin_anexar_documento_fila', {
    p_org: a.orgId, p_tipo: b.tipo, p_id: b.id,
    p_anexo: { url, nome: (b.nome || 'documento.pdf').slice(0, 200), tipo: b.tipo_anexo, numero: (b.numero || '').slice(0, 40) },
  })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: true; repetido?: boolean }
}

export async function nfseAEmitir(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_nfse_a_emitir', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return data as { lancamento_id: string; contato_tipo: string | null; contato: string | null; documento: string | null; descricao: string; valor: number; vencimento: string; parcela_num: number | null; parcela_total: number | null; nf_fornecedor: boolean; pronto: boolean }[]
}

/**
 * Emite a NFS-e da agência para um lançamento — o MESMO código da tela
 * (lib/fiscal/emitir.ts). Tomador = o contato vinculado ao lançamento;
 * descrição = a sugestão da tela ("PP 1924 | Fornecedor").
 */
export async function emitirNfse(a: AgenteFlow, lancamentoId: string) {
  await lancamento(a, lancamentoId)
  const [{ data: org }, { data: doc }, { data: lanc }, { data: cfg }] = await Promise.all([
    a.supabase.from('organizations').select('slug').eq('id', a.orgId).single(),
    a.supabase.from('lancamentos_doc').select('doc_serie, doc_numero').eq('id', lancamentoId).maybeSingle(),
    a.supabase.from('lancamentos').select('contato_nome, contato_id').eq('id', lancamentoId).maybeSingle(),
    a.supabase.from('org_nfse_config').select('descricao_padrao').eq('org_id', a.orgId).maybeSingle(),
  ])
  if (!org) throw new ErroAgente('organização não encontrada')
  if (!lanc?.contato_id) throw new ErroAgente('lançamento sem contato vinculado — sem tomador não há nota')
  const docRef = doc?.doc_serie && doc?.doc_numero ? `${doc.doc_serie} ${doc.doc_numero}` : ''
  const descricao = (docRef && lanc.contato_nome ? `${docRef} | ${lanc.contato_nome}` : docRef) || (cfg?.descricao_padrao as string | null) || undefined
  const { emitirNotaComo } = await import('@/lib/fiscal/emitir')
  const r = await emitirNotaComo({ supabase: a.supabase as never, orgId: a.orgId, userId: a.userId, orgSlug: org.slug as string }, lancamentoId, { descricao })
  if (r.error) throw new ErroAgente(r.error)
  return r.nota
}

/** E-mail novo de veículo/fornecedor reconhecido pela Flávia (mig. 387): só soma ao cadastro. */
export async function adicionarEmailContato(a: AgenteFlow, tipo: string, id: string, email: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAgente('contato inválido')
  const { data, error } = await a.supabase.rpc('fin_contato_adicionar_email', { p_org: a.orgId, p_tipo: tipo, p_id: id, p_email: email })
  if (error) throw new ErroAgente(error.message)
  return data as { ok: true; ja_tinha?: boolean; rotulo?: string }
}

// ── Fornecedor atualiza o próprio cadastro (mig. 388) ───────────────────────

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://flow.oneaone.com.br').replace(/\/$/, '')

/** Público da campanha: onda 1 = trabalhou com a agência nos últimos 18 meses; 2 = o resto com contato. */
export async function cadastroPublico(a: AgenteFlow, onda: number) {
  const { data, error } = await a.supabase.rpc('fin_cadastro_publico', { p_org: a.orgId, p_onda: onda === 2 ? 2 : 1 })
  if (error) throw new ErroAgente(error.message)
  return data as { fornecedor_id: string; nome: string; tipo: string | null; email: string | null; whatsapp: string | null; contato_nome: string | null; ativo: boolean }[]
}

/** Cria/reaproveita o convite de cada fornecedor e devolve o link pronto. */
export async function cadastroConvitesGerar(a: AgenteFlow, ids: string[]) {
  const validos = ids.filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500)
  const { data, error } = await a.supabase.rpc('fin_cadastro_convites_gerar', { p_org: a.orgId, p_ids: validos })
  if (error) throw new ErroAgente(error.message)
  return (data as { convite_id: string; fornecedor_id: string; token: string; enviado_em: string | null; respondido_em: string | null }[])
    .map(c => ({ ...c, link: `${SITE()}/cadastro-fornecedor/${c.token}` }))
}

export async function cadastroMarcarEnvio(a: AgenteFlow, conviteId: string, canal: string, lembrete: boolean) {
  if (!/^[0-9a-f-]{36}$/i.test(conviteId)) throw new ErroAgente('convite inválido')
  if (canal !== 'email' && canal !== 'whatsapp') throw new ErroAgente('canal inválido')
  const { error } = await a.supabase.rpc('fin_cadastro_marcar_envio', { p_org: a.orgId, p_convite: conviteId, p_canal: canal, p_lembrete: lembrete })
  if (error) throw new ErroAgente(error.message)
  return { ok: true as const }
}

export async function cadastroConvites(a: AgenteFlow) {
  const { data, error } = await a.supabase.rpc('fin_cadastro_convites', { p_org: a.orgId })
  if (error) throw new ErroAgente(error.message)
  return (data as { convite_id: string; fornecedor_id: string; nome: string; token: string; email: string | null; whatsapp: string | null; contato_nome: string | null; enviado_em: string | null; canais: string[]; lembrete_em: string | null; aberto_em: string | null; respondido_em: string | null; lembrar: boolean }[])
    .map(c => ({ ...c, link: `${SITE()}/cadastro-fornecedor/${c.token}` }))
}
