// Detecção do erro de "skew de deploy": o ID de cada Server Action é um hash gerado
// por build. Depois de um deploy, a aba que ficou aberta continua com o bundle antigo
// e pede uma ação que não existe mais no servidor novo. Não é bug de dado — só o
// navegador desatualizado. O "Tentar de novo" do error boundary re-executa a MESMA
// ação morta e falha igual, então o caminho certo é recarregar de verdade.

const PADROES = [
  'failed to find server action',
  'was not found on the server',
  'from an older or newer deployment',
]

export function isStaleDeployError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  return PADROES.some(p => msg.includes(p))
}

const CHAVE = 'flow:stale-deploy-reload'
const JANELA_MS = 15_000

/** Recarrega a página, no máximo uma vez a cada 15s. A trava é por TEMPO, não por
 *  sessão: se o erro voltar logo após o reload é porque não era skew (aí a tela
 *  aparece em vez de entrar em loop), mas um deploy mais tarde na mesma aba ainda
 *  se recupera sozinho. */
export function tentarRecarregarUmaVez(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const ultimo = Number(sessionStorage.getItem(CHAVE) ?? 0)
    if (ultimo && Date.now() - ultimo < JANELA_MS) return false
    sessionStorage.setItem(CHAVE, String(Date.now()))
  } catch {
    return false // sessionStorage bloqueada — melhor mostrar a tela que arriscar loop
  }
  window.location.reload()
  return true
}
