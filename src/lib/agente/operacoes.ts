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
    ? { url: await gravarPdf(b.conteudo_base64), nome: (b.nome || 'documento.pdf').slice(0, 200), tipo: b.tipo === 'NF' ? 'NF' : b.tipo === 'Outro' ? 'Outro' : 'Boleto', numero: (b.numero || '').slice(0, 40) }
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
