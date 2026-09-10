/**
 * Preferências da casca (modo, recolhida, grupos abertos, Espaços) em COOKIE,
 * não em localStorage: o layout da org lê no servidor e a sidebar já nasce do
 * jeito certo no HTML. Com localStorage ela nascia expandida e no Trabalho e
 * mudava de forma depois do paint, em todo hard load (salto de 240px).
 * Valores curtos e sem caractere especial: nada de encode/decode.
 */
export const PREF_COOKIES = {
  modo: 'flow-sb-modo',
  recolhida: 'flow-sb-recolhida',
  grupos: 'flow-sb-grupos',
  espacos: 'flow-sb-espacos',
} as const

export interface SidebarPrefs {
  /** Último modo usado — a sidebar valida contra as permissões da pessoa. */
  modo: string | null
  /** null = nunca escolheu. */
  recolhida: boolean | null
  grupos: string[]
  /** null = nunca escolheu (aí abre sozinha dentro de um cliente). */
  espacos: boolean | null
}

/** Lado do servidor: recebe o leitor de cookie (`n => jar.get(n)?.value`). */
export function lerSidebarPrefs(get: (nome: string) => string | undefined): SidebarPrefs {
  const flag = (v: string | undefined) => (v === undefined ? null : v === '1')
  return {
    modo: get(PREF_COOKIES.modo) ?? null,
    recolhida: flag(get(PREF_COOKIES.recolhida)),
    grupos: (get(PREF_COOKIES.grupos) ?? '').split('|').filter(Boolean),
    espacos: flag(get(PREF_COOKIES.espacos)),
  }
}

/** Lado do cliente: 1 ano, Lax, Secure em https. */
export function gravarPref(nome: string, valor: string) {
  if (typeof document === 'undefined') return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${nome}=${valor}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}
