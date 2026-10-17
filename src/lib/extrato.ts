// Classificação das linhas do extrato importado da Conta Azul (extrato_importado).
//
// A IMPORTAÇÃO acabou (17/10/2026): o Flow lê o banco pelo OFX de cada conta e
// a Conta Azul não é mais usada. O histórico que já entrou continua valendo —
// é a fonte do saldo e do fluxo até 16/07/2026 — e estas regras são as que as
// telas usam para lê-lo. Funções puras.

// Realizado = Conciliado/Quitado/Transferido (entrou/saiu de fato).
// Previsto  = Em aberto/Atrasado (a receber/pagar).
// Ignorar   = Perdido/Desconsiderado.
export const isRealizado = (s: string | null) =>
  s === 'Conciliado' || s === 'Quitado' || s === 'Transferido'
export const isPrevisto = (s: string | null) =>
  s === 'Em aberto' || s === 'Atrasado'
export const isIgnorado = (s: string | null) =>
  s === 'Perdido/Desconsiderado' || s == null
// Transferência entre contas: não é receita nem despesa (zero-soma).
export const isTransferencia = (origem: string | null, categoria: string | null) =>
  origem === 'Transferência' || (categoria?.startsWith('Transferência') ?? false)
