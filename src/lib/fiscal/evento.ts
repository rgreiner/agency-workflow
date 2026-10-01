import 'server-only'

/**
 * Eventos da NFS-e — hoje: o cancelamento (e101101).
 *
 * Emitida, a nota não se edita. Ou se CANCELA (este arquivo) ou se SUBSTITUI
 * (nova DPS com o grupo `subst`, em dps.ts — aí a própria Receita registra o
 * e105102 e cancela a antiga; mandar os dois cancelaria duas vezes).
 *
 * A ordem dos elementos de `infPedReg` é a do XSD oficial (pedRegEvento_v1.01 /
 * tiposEventos_v1.01, baixados do pacote de liberação em 01/10/2026):
 *   tpAmb · verAplic · dhEvento · CNPJAutor|CPFAutor · chNFSe · <evento>
 * Fora de ordem, o validador recusa — é a mesma armadilha da DPS.
 */

const esc = (t: string) => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

/** Motivos que a Receita aceita para cancelar (TSCodJustCanc). */
export const MOTIVOS_CANCELAMENTO = [
  { value: '1', label: 'Erro na emissão' },
  { value: '2', label: 'Serviço não prestado' },
  { value: '9', label: 'Outros' },
] as const

/**
 * Motivos de SUBSTITUIÇÃO (TSCodJustSubst) — lista própria, com zero à esquerda.
 * São perguntas diferentes: cancelar responde "por que a nota não devia existir",
 * substituir responde "por que outra nota entra no lugar desta".
 */
export const MOTIVOS_SUBSTITUICAO = [
  { value: '01', label: 'Desenquadramento do Simples Nacional' },
  { value: '02', label: 'Enquadramento no Simples Nacional' },
  { value: '03', label: 'Inclusão retroativa de imunidade/isenção' },
  { value: '04', label: 'Exclusão retroativa de imunidade/isenção' },
  { value: '05', label: 'Rejeição da NFS-e pelo tomador' },
  { value: '99', label: 'Outros' },
] as const

/** A Receita exige um texto de verdade: 15 caracteres é o mínimo do schema (TSMotivo). */
export const MOTIVO_MIN = 15
export const MOTIVO_MAX = 255

/**
 * Id do pedido: "PRE" + chave (50) + tipo do evento (6) = PRE + 56 dígitos.
 * O número do pedido saiu do Id na atualização de 27/12/2025 — somar um
 * sequencial aqui estoura o `pattern` do schema.
 */
export function idPedidoEvento(chave: string, tipoEvento: string): string {
  return 'PRE' + chave.replace(/\D/g, '') + tipoEvento
}

/** Mesmo fuso da DPS: gerar em UTC e carimbar -03:00 manda o evento 3h à frente. */
function agoraBrasilia(): string {
  return new Date(Date.now() - 3 * 3600_000 - 60_000).toISOString().replace(/\.\d+Z$/, '-03:00')
}

export function montarCancelamento(d: {
  chave: string
  cnpjAutor: string
  /** 1 = produção, 2 = produção restrita. */
  ambiente: 1 | 2
  cMotivo: string
  xMotivo: string
}): { xml: string; id: string } {
  const chave = d.chave.replace(/\D/g, '')
  const id = idPedidoEvento(chave, '101101')

  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">'
    + `<infPedReg Id="${id}">`
    + `<tpAmb>${d.ambiente}</tpAmb><verAplic>Flow-1.0</verAplic><dhEvento>${agoraBrasilia()}</dhEvento>`
    + `<CNPJAutor>${d.cnpjAutor.replace(/\D/g, '')}</CNPJAutor><chNFSe>${chave}</chNFSe>`
    // xDesc é enumerado no schema: tem que ser exatamente esta frase.
    + '<e101101><xDesc>Cancelamento de NFS-e</xDesc>'
    + `<cMotivo>${esc(d.cMotivo)}</cMotivo><xMotivo>${esc(d.xMotivo).slice(0, MOTIVO_MAX)}</xMotivo>`
    + '</e101101>'
    + '</infPedReg></pedRegEvento>'

  return { xml, id }
}
