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
