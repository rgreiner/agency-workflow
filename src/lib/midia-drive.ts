import 'server-only'
import { getDriveClient, driveConfigured, folderLink } from '@/lib/google-drive'

/**
 * Pastas do Hub de Mídia — que vivem em OUTRO drive compartilhado ("Mídia"),
 * separado do "Clientes" que a pauta usa.
 *
 * Duas regras nascem do drive REAL, não de um padrão inventado (medido em
 * 14/08 lendo o drive inteiro com a conta de serviço):
 *
 *  1. A pasta do mês na casa chama-se "MM - Mês" — "08 - Agosto", "06 - Junho".
 *     Criar "2026-08" seria impor um padrão novo em cima de dois anos de
 *     histórico, e o time não acharia mais nada.
 *  2. A pasta da rotina tem GRAFIA VARIÁVEL por cliente: "Boletos Digitais",
 *     "Boletos digitais", "Boletos Digitais Mensais", "Boletos digitais
 *     mensais" — quatro formas do mesmo lugar. Por isso a busca é tolerante
 *     (exata → sem acento/caixa → prefixo) e só cria quando não existe nada
 *     parecido. Sem isso, o Flow criaria uma quinta grafia ao lado das outras.
 */

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

/** "09 - Setembro" — o padrão que já existe no drive. */
export function nomePastaMes(mes: number): string {
  return `${String(mes).padStart(2, '0')} - ${MESES[mes - 1]}`
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// "Relatórios Mensais" e "Relatório mensal de mídia e produção" são a MESMA
// pasta na cabeça de quem trabalha, e nenhum prefixo casa as duas. Comparar por
// palavras-chave (sem plural, sem preposição) casa; e continua não casando
// "Plano de Mídia" com "Planejamento de Mídia", que são coisas diferentes.
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'para'])
const raiz = (t: string) => t.replace(/(oes|ais|res|s)$/, m => (m === 'oes' ? 'ao' : m === 'ais' ? 'al' : m === 'res' ? 'r' : ''))
const tokens = (s: string) =>
  new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)).map(raiz))

/** Todos os termos do alvo aparecem no candidato? */
function casaPorTokens(alvo: string, candidato: string): boolean {
  const a = tokens(alvo), c = tokens(candidato)
  if (a.size === 0) return false
  for (const t of a) if (!c.has(t)) return false
  return true
}

let _driveId: string | null = null

/**
 * ID do drive compartilhado "Mídia", descoberto pelo nome. Guardado em memória
 * depois da primeira vez. É preferível a uma env var: não exige redeploy e não
 * quebra silenciosamente se alguém trocar o valor.
 */
export async function driveMidiaId(): Promise<string | null> {
  if (_driveId) return _driveId
  if (!driveConfigured()) return null
  const drive = getDriveClient()
  const r = await drive.drives.list({ pageSize: 100 })
  const achou = (r.data.drives ?? []).find(d => norm(d.name ?? '') === 'midia')
  _driveId = achou?.id ?? null
  return _driveId
}

interface Pasta { id: string; nome: string }

async function listarSubpastas(paiId: string, driveId: string): Promise<Pasta[]> {
  const drive = getDriveClient()
  const out: Pasta[] = []
  let pageToken: string | undefined
  do {
    const r = await drive.files.list({
      q: `'${paiId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 200, pageToken,
      corpora: 'drive', driveId,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    })
    out.push(...(r.data.files ?? []).map(f => ({ id: f.id!, nome: f.name ?? '' })))
    pageToken = r.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

/** Clientes do drive Mídia, para a pessoa vincular à mão (os nomes NÃO batem com
 *  os do Flow: "É O Amor" no Flow é "É o Amor - Condomínio Fazenda" no drive). */
export async function pastasDeClientes(): Promise<Pasta[]> {
  const driveId = await driveMidiaId()
  if (!driveId) return []
  const todas = await listarSubpastas(driveId, driveId)
  return todas
    .filter(p => !p.nome.startsWith('_'))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * Acha a subpasta pelo nome, aceitando as grafias que já existem; cria só se
 * não houver nada parecido. `prefixo` casa "02 - Fevereiro (Show Rural)" com
 * "02 - Fevereiro".
 */
/** Acha a pasta aceitando as grafias que já existem. Não cria nada. */
function acharPasta(existentes: Pasta[], nome: string, prefixo?: string): Pasta | undefined {
  const alvo = norm(nome)
  return existentes.find(p => p.nome === nome)
    ?? existentes.find(p => norm(p.nome) === alvo)
    // "Boletos Digitais" casa com "Boletos Digitais Mensais" (e vice-versa)
    ?? existentes.find(p => norm(p.nome).startsWith(alvo) || alvo.startsWith(norm(p.nome)))
    ?? existentes.find(p => casaPorTokens(nome, p.nome))
    ?? (prefixo ? existentes.find(p => p.nome.trim().startsWith(prefixo)) : undefined)
}

async function criarPasta(paiId: string, nome: string): Promise<string> {
  const drive = getDriveClient()
  const criada = await drive.files.create({
    requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [paiId] },
    fields: 'id', supportsAllDrives: true,
  })
  return criada.data.id!
}

async function acharOuCriar(
  paiId: string, driveId: string, nome: string, opts?: { prefixo?: string },
): Promise<{ id: string; criada: boolean }> {
  const existentes = await listarSubpastas(paiId, driveId)
  const achou = acharPasta(existentes, nome, opts?.prefixo)
  if (achou) return { id: achou.id, criada: false }
  return { id: await criarPasta(paiId, nome), criada: true }
}

/**
 * Resolve a pasta da ROTINA dentro do ano. Ela NUNCA é criada às cegas: quando
 * o casamento falha, devolve as opções para a pessoa escolher — criar uma quinta
 * grafia ao lado de "Relatório mensal de mídia e produção" seria a mesma deriva
 * que o Hub existe para acabar.
 */
export async function resolverPastaRotina(params: {
  clienteFolderId: string; ano: number; pastaCanonica: string
}): Promise<{ id: string } | { opcoes: Pasta[]; anoFolderId: string }> {
  const { clienteFolderId, ano, pastaCanonica } = params
  const driveId = await driveMidiaId()
  if (!driveId) throw new Error('Drive compartilhado "Mídia" não encontrado pela conta de serviço.')

  const anoFolder = await acharOuCriar(clienteFolderId, driveId, String(ano))
  const subs = await listarSubpastas(anoFolder.id, driveId)
  const achou = acharPasta(subs, pastaCanonica)
  if (achou) return { id: achou.id }
  return { opcoes: subs, anoFolderId: anoFolder.id }
}

/** Cria a pasta da rotina com o nome canônico (escolha explícita da pessoa). */
export async function criarPastaRotina(anoFolderId: string, nome: string): Promise<string> {
  return criarPasta(anoFolderId, nome)
}

export interface PastaDoMes {
  id: string
  link: string
  caminho: string
  criadas: string[]
}

/**
 * Garante `<cliente>/<ano>/<pastaRotina>/<MM - Mês>` e devolve o link.
 * Cada nível é find-or-create tolerante — rodar de novo no mesmo mês não cria
 * nada e devolve a mesma pasta.
 */
export async function garantirPastaDoMes(params: {
  rotinaFolderId: string
  mes: number
  /** Só para compor o texto do caminho mostrado à pessoa. */
  rotulo: string
}): Promise<PastaDoMes> {
  const { rotinaFolderId, mes, rotulo } = params
  const driveId = await driveMidiaId()
  if (!driveId) throw new Error('Drive compartilhado "Mídia" não encontrado pela conta de serviço.')

  const nomeMes = nomePastaMes(mes)
  // A pasta do MÊS pode ser criada sem perguntar: o padrão "MM - Mês" é
  // uniforme no drive inteiro, e o prefixo casa "02 - Fevereiro (Show Rural)".
  const r = await acharOuCriar(rotinaFolderId, driveId, nomeMes, { prefixo: `${String(mes).padStart(2, '0')} -` })

  return {
    id: r.id,
    link: folderLink(r.id),
    caminho: `${rotulo}/${nomeMes}`,
    criadas: r.criada ? [nomeMes] : [],
  }
}
