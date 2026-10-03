/**
 * Pix copia-e-cola (BR Code estático com valor), montado pelo próprio Flow.
 *
 * Não depende de banco: o BR Code é o payload EMV®QRCPS do Banco Central, uma
 * string formatada com CRC no fim. Isso importa porque a alternativa — registrar
 * cobrança pela API do banco — custa plano mensal, e para a régua de cobrança o
 * que o cliente precisa é só colar o código e pagar o valor certo.
 *
 * O que ele NÃO faz: não avisa quando o pagamento cai. A baixa continua vindo da
 * conciliação do extrato (OFX), como hoje. Para baixa automática seria preciso o
 * Pix cobrança com txid registrado no banco — outro assunto, com outro custo.
 *
 * Referência: Manual de Padrões para Iniciação do Pix (BCB), payload estático.
 * Os limites de tamanho abaixo são os do manual, e truncar é melhor do que gerar
 * código que o app do banco recusa.
 */

/** CRC16/CCITT-FALSE — poly 0x1021, init 0xFFFF, sem reflexão, sem xor final. */
export function crc16(s: string): number {
  let crc = 0xFFFF
  for (const byte of Buffer.from(s, 'utf8')) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF
    }
  }
  return crc
}

/** Campo EMV: id + tamanho em 2 dígitos + valor. */
function campo(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`
}

/**
 * Nome e cidade vão sem acento e em maiúsculas: o padrão é ASCII, e app de banco
 * costuma recusar ou exibir lixo quando vem acentuado.
 */
function ascii(s: string, max: number): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim().toUpperCase().slice(0, max)
}

/** O txid aceita só letras e números (até 25); vazio vira "***", que é o padrão. */
function txidLimpo(s: string | undefined): string {
  const t = (s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)
  return t || '***'
}

export interface DadosPix {
  /** Chave Pix do recebedor: CNPJ, e-mail, telefone ou aleatória. */
  chave: string
  /** Nome do recebedor (até 25 caracteres no padrão). */
  nome: string
  /** Cidade do recebedor (até 15). */
  cidade: string
  /** Valor em reais. Sem valor, o pagador digita — o que a régua não quer. */
  valor?: number
  /** Identificador da cobrança, aparece no extrato de quem recebe. */
  txid?: string
}

/**
 * Normaliza a chave para o formato que o app do banco aceita.
 *
 * CPF/CNPJ vão SÓ com dígitos e telefone com +55 — chave digitada com ponto,
 * barra ou parêntese gera um código que o app recusa sem dizer por quê. E-mail
 * e chave aleatória passam como estão (e-mail em minúsculas).
 */
export function normalizarChavePix(chave: string): string {
  const bruta = (chave || '').trim()
  if (!bruta) return ''
  if (bruta.includes('@')) return bruta.toLowerCase()

  const digitos = bruta.replace(/\D/g, '')
  if (digitos.length === 11 && /^[\d.\-]+$/.test(bruta)) return digitos              // CPF
  if (digitos.length === 14) return digitos                                          // CNPJ
  if (digitos.length === 11 || digitos.length === 10) return `+55${digitos}`          // telefone
  if (digitos.length === 13 && digitos.startsWith('55')) return `+${digitos}`         // telefone com DDI
  return bruta                                                                       // aleatória (UUID)
}

export function brCode(d: DadosPix): string {
  const chave = normalizarChavePix(d.chave)
  if (!chave) throw new Error('Chave Pix vazia')

  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave)

  const partes = [
    campo('00', '01'),                       // formato do payload
    campo('26', conta),                      // conta do recebedor (Pix)
    campo('52', '0000'),                     // MCC genérico
    campo('53', '986'),                      // moeda: BRL
    // Valor com 2 casas e ponto decimal. Zero/ausente = pagador digita.
    ...(d.valor != null && d.valor > 0 ? [campo('54', d.valor.toFixed(2))] : []),
    campo('58', 'BR'),                       // país
    campo('59', ascii(d.nome, 25) || 'RECEBEDOR'),
    campo('60', ascii(d.cidade, 15) || 'BRASIL'),
    campo('62', campo('05', txidLimpo(d.txid))),
  ].join('')

  // O CRC é calculado sobre o payload JÁ com "6304" no fim — o próprio campo
  // entra no cálculo. Esquecer isso gera código que o app recusa sem explicar.
  const comCrc = `${partes}6304`
  return comCrc + crc16(comCrc).toString(16).toUpperCase().padStart(4, '0')
}
