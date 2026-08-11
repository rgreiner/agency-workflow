/**
 * Limite de tentativa + lockout + registro nos pontos de autenticação.
 *
 * Antes disso não havia NADA: login de membro, login do portal, magic link e
 * reset de senha aceitavam tentativa infinita e não deixavam rastro — força
 * bruta contra uma senha de 8 caracteres era só questão de tempo, e não haveria
 * como saber depois que aconteceu.
 *
 * Janela deslizante em duas chaves ao mesmo tempo: por IDENTIFICADOR (e-mail),
 * que trava o ataque contra uma conta específica, e por IP, que trava a
 * varredura de vários e-mails da mesma origem. Vale a primeira que estourar.
 *
 * Escreve pela conexão direta (auth.login_attempts): tudo aqui roda ANTES de
 * existir sessão, e o schema `auth` não é exposto pelo PostgREST.
 */
import 'server-only'
import { headers } from 'next/headers'
import { sql } from '@/lib/db'

export type TentativaKind = 'login' | 'portal' | 'portal_magic' | 'reset'

interface Regra {
  janelaMin: number
  porEmail: number
  porIp: number
  /** Se true, tentativa BEM-SUCEDIDA também conta pro limite. */
  contaSucesso: boolean
}

const REGRAS: Record<TentativaKind, Regra> = {
  // Senha: só o erro conta — quem acerta na primeira nunca é atrapalhado.
  login: { janelaMin: 15, porEmail: 8, porIp: 40, contaSucesso: false },
  portal: { janelaMin: 15, porEmail: 8, porIp: 40, contaSucesso: false },
  // Magic link e reset respondem sempre "enviado" (não revelam se o e-mail
  // existe), então não existe "falha" pra contar: o limite é sobre TODO pedido.
  // Sem isso o formulário vira uma máquina de mandar e-mail em nome da agência.
  portal_magic: { janelaMin: 60, porEmail: 5, porIp: 25, contaSucesso: true },
  reset: { janelaMin: 60, porEmail: 5, porIp: 25, contaSucesso: true },
}

/** IP de origem atrás do Traefik. '-' quando não dá pra determinar. */
async function ipDoPedido(): Promise<string> {
  try {
    const h = await headers()
    const xff = h.get('x-forwarded-for')
    const ip = xff?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim()
    return ip ? ip.slice(0, 64) : '-'
  } catch {
    return '-'
  }
}

const chave = (identifier: string) => (identifier || '-').trim().toLowerCase().slice(0, 200)

/**
 * Já estourou o limite? Nunca lança — falha de banco não pode virar porta
 * fechada no login (fail-open é a escolha certa aqui: o risco de trancar a
 * equipe inteira por um erro de query é maior que o de uma janela sem limite).
 */
export async function limiteEstourado(kind: TentativaKind, identifier: string): Promise<boolean> {
  const r = REGRAS[kind]
  const id = chave(identifier)
  const ip = await ipDoPedido()
  try {
    const rows = await sql<{ por_email: number; por_ip: number }[]>`
      select
        count(*) filter (where identifier = ${id})::int as por_email,
        count(*) filter (where ip = ${ip} and ${ip} <> '-')::int as por_ip
      from auth.login_attempts
      where kind = ${kind}
        and bloqueado = false
        and created_at > now() - make_interval(mins => ${r.janelaMin})
        and (ok = false or ${r.contaSucesso})
        and (identifier = ${id} or ip = ${ip})
    `
    const { por_email = 0, por_ip = 0 } = rows[0] ?? {}
    return por_email >= r.porEmail || por_ip >= r.porIp
  } catch (e) {
    console.error('[rate-limit] falha ao consultar tentativas:', e)
    return false
  }
}

/**
 * Registra o pedido BARRADO pelo limite. Fica fora da contagem (migration 233):
 * se contasse, cada tentativa barrada renovaria a janela e o bloqueio não acabaria.
 * Existe só para o histórico mostrar o que aconteceu — sem isto, quem foi bloqueado
 * simplesmente sumia do log, e o incidente ficava impossível de reconstituir.
 */
export async function registrarBloqueio(kind: TentativaKind, identifier: string): Promise<void> {
  try {
    await sql`
      insert into auth.login_attempts (kind, identifier, ip, ok, bloqueado)
      values (${kind}, ${chave(identifier)}, ${await ipDoPedido()}, false, true)
    `
  } catch (e) {
    console.error('[rate-limit] falha ao registrar bloqueio:', e)
  }
}

/** Registra a tentativa (é também o log de auditoria). Nunca lança. */
export async function registrarTentativa(
  kind: TentativaKind, identifier: string, ok: boolean,
): Promise<void> {
  try {
    await sql`
      insert into auth.login_attempts (kind, identifier, ip, ok, bloqueado)
      values (${kind}, ${chave(identifier)}, ${await ipDoPedido()}, ${ok}, false)
    `
  } catch (e) {
    console.error('[rate-limit] falha ao registrar tentativa:', e)
  }
}

/** Descarta tentativas antigas (chamado pelo cron). Devolve quantas saíram. */
export async function limparTentativasAntigas(dias = 30): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    with d as (
      delete from auth.login_attempts where created_at < now() - make_interval(days => ${dias})
      returning 1
    ) select count(*)::int as n from d
  `
  return rows[0]?.n ?? 0
}
