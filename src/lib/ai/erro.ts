import 'server-only'

/**
 * Traduz a falha da IA para uma frase que a pessoa entende.
 *
 * O Gemini devolve o erro como JSON cru no corpo — do tipo
 * `{"error":{"code":429,"message":"Your prepayment credits are depleted…"}}` — e as
 * rotas de extração repassavam esse texto pra tela. Quem subia uma guia no
 * Financeiro levava um dump de API no rosto. Aqui vira recado em pt-BR; o técnico
 * vai pro system_errors (só admin).
 *
 * Distinguir SEM SALDO de LIMITE POR MINUTO importa: os dois chegam como 429 e a
 * ação é oposta — um exige recarga, o outro só esperar.
 */
export function mensagemErroIA(
  e: unknown,
  fallback = 'Não consegui concluir a leitura com a IA. O erro foi registrado para o administrador.',
): string {
  const bruto = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  const status = typeof (e as { status?: unknown } | null)?.status === 'number'
    ? (e as { status: number }).status
    : null

  // Saldo/billing: o mais comum, e o único que tem ação clara pro administrador.
  if (bruto.includes('credit') || bruto.includes('billing') || bruto.includes('quota') || bruto.includes('exceeded')) {
    return 'A IA está sem créditos. Um administrador precisa recarregar a conta do Google AI Studio (aistudio.google.com → Billing) — ou habilitar o faturamento do projeto, se estivermos usando o Vertex — e tentar de novo.'
  }
  // 403 "project has been denied access" NÃO é chave errada: a chave autentica
  // (listar modelos responde 200) e só o generateContent é negado — quem bloqueou
  // foi o Google, no projeto. Mandar o admin conferir a chave manda pro lugar errado.
  if (bruto.includes('denied access')) {
    return 'O projeto de IA no Google AI Studio está bloqueado (acesso negado pelo Google). Um administrador precisa resolver com o Google — ou apontar o Flow para o Vertex.'
  }
  if (status === 401 || status === 403 || bruto.includes('api key not valid') || bruto.includes('permission_denied')) {
    return 'A chave da IA foi recusada. Um administrador precisa revisar a GEMINI_API_KEY (ou a conta de serviço do Vertex).'
  }
  if (status === 404 || bruto.includes('no longer available') || bruto.includes('not found for api version')) {
    return 'O modelo de IA configurado não existe mais. Um administrador precisa apontar GEMINI_MODEL para um modelo disponível.'
  }
  if (status === 429 || bruto.includes('rate limit') || bruto.includes('resource_exhausted')) {
    return 'A IA atingiu o limite de uso agora há pouco. Espere um minuto e tente de novo.'
  }
  if (status === 500 || status === 503 || bruto.includes('overloaded') || bruto.includes('unavailable')) {
    return 'A IA está sobrecarregada no momento. Tente de novo em instantes.'
  }
  if (bruto.includes('timeout') || bruto.includes('timed out') || bruto.includes('fetch failed') || bruto.includes('econnreset') || bruto.includes('falha de rede')) {
    return 'Não consegui falar com a IA (falha de rede). Tente de novo.'
  }
  return fallback
}
