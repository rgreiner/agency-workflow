import 'server-only'

/**
 * Traduz a falha do provedor de IA para uma frase que a pessoa entende.
 *
 * O SDK da Anthropic joga o corpo cru da resposta dentro de `message` — do tipo
 * `400 {"type":"error","error":{...}}` — e as rotas de extração repassavam esse
 * texto pra tela. Quem subia uma guia no Financeiro levava um dump de API no
 * rosto. Aqui vira recado em pt-BR; o técnico vai pro system_errors (só admin).
 */
export function mensagemErroIA(e: unknown, oQue = 'o documento'): string {
  const bruto = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  const status = typeof (e as { status?: unknown } | null)?.status === 'number'
    ? (e as { status: number }).status
    : null

  // Saldo/billing: o mais comum, e o único que tem ação clara pro Rafael.
  if (bruto.includes('credit balance') || bruto.includes('billing') || bruto.includes('quota')) {
    return 'A IA está sem créditos. Um administrador precisa recarregar a conta da Anthropic (console.anthropic.com → Plans & Billing) e tentar de novo.'
  }
  if (status === 401 || status === 403 || bruto.includes('authentication_error') || bruto.includes('invalid x-api-key')) {
    return 'A chave da IA foi recusada. Um administrador precisa revisar a ANTHROPIC_API_KEY.'
  }
  if (status === 429 || bruto.includes('rate_limit')) {
    return 'A IA atingiu o limite de uso agora há pouco. Espere um minuto e tente de novo.'
  }
  if (status === 529 || status === 503 || bruto.includes('overloaded')) {
    return 'A IA está sobrecarregada no momento. Tente de novo em instantes.'
  }
  if (bruto.includes('timeout') || bruto.includes('timed out') || bruto.includes('fetch failed') || bruto.includes('econnreset') || bruto.includes('connection error')) {
    return 'Não consegui falar com a IA (falha de rede). Tente de novo.'
  }
  return `Não consegui ler ${oQue}. O erro foi registrado para o administrador.`
}
