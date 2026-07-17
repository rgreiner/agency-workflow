// Parser de OFX (extrato bancário). Cobre OFX 1.x (SGML, tags sem fechamento — padrão
// dos bancos BR como Cresol/BTG) e 2.x (XML). Extrai as transações (STMTTRN) e a conta.

export interface OfxTxn {
  fitid: string       // id único da transação no banco (dedup)
  data: string        // ISO YYYY-MM-DD
  valor: number       // sempre positivo
  tipo: 'credit' | 'debit'
  descricao: string
}

export interface OfxParsed {
  acctId: string | null   // número da conta no OFX (BANKACCTFROM/ACCTID)
  bankId: string | null   // código do banco (BANKID)
  txns: OfxTxn[]
}

/** Pega o valor de <TAG>valor (até o próximo `<` ou quebra de linha). */
function field(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i'))
  return m ? m[1].trim() : null
}

function parseAmount(raw: string): number {
  const s = raw.trim()
  // OFX usa ponto decimal; alguns bancos exportam vírgula. Normaliza.
  const norm = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '')
  return Number(norm)
}

function parseDate(raw: string): string | null {
  const d = raw.replace(/[^\d]/g, '').slice(0, 8) // YYYYMMDD
  if (d.length < 8) return null
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

export function parseOfx(text: string): OfxParsed {
  const acctId = field(text, 'ACCTID')
  const bankId = field(text, 'BANKID')
  const txns: OfxTxn[] = []

  // Cada transação começa em <STMTTRN>. Fecha em </STMTTRN> (2.x) ou no próximo <STMTTRN>.
  const parts = text.split(/<STMTTRN>/i).slice(1)
  for (const part of parts) {
    const block = part.split(/<\/STMTTRN>/i)[0]
    const fitid = field(block, 'FITID')
    const dtRaw = field(block, 'DTPOSTED')
    const amtRaw = field(block, 'TRNAMT')
    if (!fitid || !dtRaw || amtRaw == null) continue
    const data = parseDate(dtRaw)
    const amt = parseAmount(amtRaw)
    if (!data || isNaN(amt)) continue
    const memo = field(block, 'MEMO') || field(block, 'NAME') || ''
    txns.push({
      fitid,
      data,
      valor: Math.abs(amt),
      tipo: amt < 0 ? 'debit' : 'credit',
      descricao: memo,
    })
  }

  return { acctId, bankId, txns }
}
