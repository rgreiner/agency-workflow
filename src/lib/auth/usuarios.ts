/**
 * Acesso à tabela de usuários do auth próprio (`auth.users`, criada no
 * bootstrap do VPS). Login e criação de usuário usam a conexão Postgres direta.
 * O trigger `handle_new_user` cria o `public.profiles` correspondente.
 */
import { sql } from "@/lib/db";
import { hashSenha } from "./password";

export type Usuario = {
  id: string;
  email: string;
  senha_hash: string | null;
  nome: string | null;
};

/** Busca um usuário pelo e-mail (case-insensitive). */
export async function buscarUsuarioPorEmail(email: string): Promise<Usuario | null> {
  const rows = await sql<Usuario[]>`
    select u.id, u.email, u.encrypted_password as senha_hash, p.full_name as nome
    from auth.users u
    left join public.profiles p on p.id = u.id
    where lower(u.email) = lower(${email})
    limit 1
  `;
  return rows[0] ?? null;
}

/**
 * Erro de digitação em domínio conhecido. Devolve a correção sugerida, ou null.
 *
 * Em 03/08/2026 alguém entrou pelo link de convite digitando o próprio e-mail e
 * gravou "@hotmai.com". O acesso funciona — mas "Esqueci a senha" manda o link pra
 * um domínio que não existe, então essa pessoa NUNCA consegue se recuperar sozinha:
 * toda vez depende do administrador. Barrar na entrada é o único momento barato.
 */
const TYPOS: Record<string, string> = {
  'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'hotmil.com': 'hotmail.com', 'homtail.com': 'hotmail.com',
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com',
  'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'yaho.com': 'yahoo.com', 'yahho.com': 'yahoo.com',
  'oneaone.com': 'oneaone.com.br', 'oneaone.co.br': 'oneaone.com.br',
}

export function dominioComTypo(email: string): string | null {
  const dominio = email.split('@')[1]?.toLowerCase().trim()
  if (!dominio) return null
  const certo = TYPOS[dominio]
  return certo ? email.replace(new RegExp(`${dominio}$`, 'i'), certo) : null
}

/** Cria um usuário (e, via trigger, seu profile). Devolve o id. */
export async function criarUsuario(email: string, senha: string, nome: string): Promise<string> {
  const hash = await hashSenha(senha);
  const rows = await sql<{ id: string }[]>`
    insert into auth.users (email, encrypted_password, raw_user_meta_data)
    values (${email.toLowerCase()}, ${hash}, ${sql.json({ full_name: nome })})
    returning id
  `;
  return rows[0].id;
}
