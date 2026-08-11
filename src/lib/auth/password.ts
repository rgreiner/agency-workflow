/**
 * Hash de senha com scrypt (nativo do Node, sem dependência externa).
 * Formato armazenado: "<saltHex>:<hashHex>". Usado só no servidor (login
 * e criação de usuário), nunca no proxy/edge.
 */
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  senha: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivado = await scryptAsync(senha, salt, KEYLEN);
  return `${salt}:${derivado.toString("hex")}`;
}

export async function verificarSenha(senha: string, armazenado: string): Promise<boolean> {
  const [salt, hashHex] = armazenado.split(":");
  if (!salt || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const derivado = await scryptAsync(senha, salt, esperado.length);
  return esperado.length === derivado.length && timingSafeEqual(esperado, derivado);
}

/**
 * Senha como ela deve ser GRAVADA: sem espaço nas pontas.
 *
 * O caminho normal de uma senha nova aqui é o administrador definir e mandar por
 * WhatsApp — e copiar de mensagem traz espaço no fim com frequência. Gravado com o
 * espaço, o hash passa a exigir esse espaço para sempre: a pessoa digita a senha
 * certa, na mão, e é recusada. Some do jeito mais confuso possível, porque a senha
 * "está certa". Cortar na hora de gravar fecha a porta.
 */
export function normalizarSenha(senha: string): string {
  return senha.trim();
}

/**
 * Confere a senha tolerando espaço acidental nas pontas do que foi DIGITADO
 * (mesma origem: colar de mensagem). Só tenta a segunda forma se ela for
 * diferente da primeira — sem custo quando não há espaço.
 */
export async function conferirSenha(digitada: string, armazenado: string): Promise<boolean> {
  if (await verificarSenha(digitada, armazenado)) return true;
  const limpa = digitada.trim();
  return limpa !== digitada ? verificarSenha(limpa, armazenado) : false;
}
