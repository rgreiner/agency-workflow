/**
 * JWT HS256 próprio, assinado com o MESMO segredo do PostgREST (JWT_SECRET).
 * O token vira o "access token" que o supabase-js carrega (via opção
 * `accessToken`) em cada `.from()`/`.rpc()`; o PostgREST valida a assinatura,
 * popula `request.jwt.claims` e a RLS lê `auth.uid()` do claim `sub`.
 *
 * Usa Web Crypto (HMAC-SHA256) → funciona no proxy (edge) e no servidor (Node).
 * O segredo NUNCA vai pro browser — o browser só lê o token já assinado.
 */

export const COOKIE_TOKEN = "flow-jwt";
const VALIDADE_DIAS = 7;
export const MAX_AGE_SEG = VALIDADE_DIAS * 24 * 60 * 60;

const ALG = { name: "HMAC", hash: "SHA-256" } as const;

export type Claims = { sub: string; email: string };

function segredo(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error("Falta a variável de ambiente JWT_SECRET");
  return s;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(enc.encode(JSON.stringify(obj)));
}

function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function assinar(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(segredo()), ALG, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

/** Gera um JWT HS256 com claims { role: authenticated, sub, email, iat, exp }. */
export async function mintToken({ sub, email }: Claims): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({
    role: "authenticated",
    sub,
    email,
    iat: agora,
    exp: agora + MAX_AGE_SEG,
  });
  const data = `${header}.${payload}`;
  return `${data}.${await assinar(data)}`;
}

/** Valida assinatura + expiração e devolve os claims, ou null. */
export async function verifyToken(token: string | undefined): Promise<Claims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  const esperado = await assinar(`${h}.${p}`);
  if (sig.length !== esperado.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ esperado.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    if (!payload?.sub) return null;
    if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return { sub: String(payload.sub), email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}
