import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { certificadoParaUso, certificadoPublico } from './certificado'
import { chamarNfse } from './nfse-conexao'
import { assinarXml, chavesDoPfx, empacotar } from './dps'
import { montarCancelamento, MOTIVO_MIN } from './evento'
import { logSystemError } from '@/lib/system-error'

/**
 * Cancelamento da NFS-e (evento e101101) — o miolo, usado pela tela
 * (`cancelarNota`, com cookie) e pela API de agentes (token da Flávia).
 *
 * REGRA DA CASA (Rafael, 26/10/2026): nota NÃO se cancela depois do mês da
 * competência. A nota é do mês em que o serviço foi tomado; cancelar depois
 * mexe em apuração já fechada. Passou o mês, a nota fica e se reaproveita
 * (ex.: o contrato muda e a nota segue valendo com o cliente).
 */

type Sb = SupabaseClient<any> // eslint-disable-line @typescript-eslint/no-explicit-any

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** Último dia (AAAA-MM-DD) em que a nota ainda pode ser cancelada: o fim do mês da competência. */
export function limiteDeCancelamento(competencia: string | null, emitidoEm: string): string {
  const base = (competencia ?? emitidoEm).slice(0, 7)
  const [a, m] = base.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

export const podeCancelarAinda = (competencia: string | null, emitidoEm: string): boolean =>
  hojeBR() <= limiteDeCancelamento(competencia, emitidoEm)

/** Junta os erros da Receita numa frase que a pessoa consegue agir. */
export function mensagemDaReceita(corpo: string): string {
  try {
    const j = JSON.parse(corpo) as { erros?: { Codigo?: string; Descricao?: string; Complemento?: string }[]; erro?: { codigo?: string; descricao?: string } }
    const lista = j.erros ?? (j.erro ? [{ Codigo: j.erro.codigo, Descricao: j.erro.descricao }] : [])
    if (lista.length === 0) return 'A Receita recusou a nota sem detalhar o motivo.'
    return lista.map(e => `${e.Descricao ?? ''}${'Complemento' in e && e.Complemento ? ` (${e.Complemento})` : ''}`.trim() || e.Codigo).join(' · ')
  } catch {
    return 'A Receita recusou a nota.'
  }
}

export async function cancelarNotaNaReceita(
  supabase: Sb, orgId: string, userId: string, notaId: string,
  motivo: { cMotivo: string; xMotivo: string },
): Promise<{ ok?: true; error?: string; lancamentoId?: string | null }> {
  const texto = (motivo.xMotivo ?? '').trim()
  if (texto.length < MOTIVO_MIN) {
    return { error: `O motivo precisa de pelo menos ${MOTIVO_MIN} caracteres — a Receita recusa textos curtos.` }
  }

  const { data: nota } = await supabase.from('nota_fiscal')
    .select('id, org_id, chave, status, ambiente, lancamento_id, competencia, emitido_em').eq('id', notaId).maybeSingle()
  if (!nota || nota.org_id !== orgId) return { error: 'Nota não encontrada.' }
  if (nota.status !== 'autorizada') return { error: 'Esta nota já está cancelada.' }

  const limite = limiteDeCancelamento(nota.competencia, nota.emitido_em)
  if (hojeBR() > limite) {
    const [a, m] = limite.split('-')
    return { error: `Esta nota é da competência ${m}/${a} e já passou o mês: não se cancela depois do mês da competência. Ela fica e pode ser reaproveitada com o cliente.` }
  }

  const cert = await certificadoParaUso(orgId)
  if (!cert) return { error: 'Nenhum certificado digital cadastrado.' }
  if (cert.ambiente !== nota.ambiente) {
    return { error: `A nota foi emitida em ${nota.ambiente === 'producao' ? 'produção' : 'produção restrita'} e o certificado está apontando para o outro ambiente. Troque o ambiente antes de cancelar.` }
  }
  const info = await certificadoPublico(orgId)
  const cnpjAutor = String(info?.cnpj ?? '').replace(/\D/g, '')
  if (cnpjAutor.length !== 14) return { error: 'Não foi possível ler o CNPJ do certificado.' }

  try {
    const { xml, id } = montarCancelamento({
      chave: nota.chave, cnpjAutor, ambiente: cert.ambiente === 'producao' ? 1 : 2,
      cMotivo: motivo.cMotivo, xMotivo: texto,
    })
    const { key, certB64 } = await chavesDoPfx(cert.pfx, cert.senha)
    const assinado = assinarXml(xml, { interna: 'infPedReg', raiz: 'pedRegEvento', id, key, certB64 })

    const r = await chamarNfse(orgId, {
      caminho: `/sefinnacional/nfse/${nota.chave}/eventos`,
      metodo: 'POST',
      corpo: JSON.stringify({ pedidoRegistroEventoXmlGZipB64: empacotar(assinado) }),
      timeoutMs: 60_000,
    })
    if ('erro' in r) return { error: 'Certificado indisponível.' }
    if (r.erroRede) return { error: `Não foi possível falar com a Receita (${r.erroRede}).` }
    if (r.status !== 200 && r.status !== 201) return { error: mensagemDaReceita(r.corpo) }

    await supabase.from('nota_fiscal').update({
      status: 'cancelada', cancelado_em: new Date().toISOString(),
      cancel_cod: motivo.cMotivo, cancel_motivo: texto, evento_gz_b64: empacotar(assinado),
    }).eq('id', notaId)

    // O lançamento volta a não ter nota — a não ser que outra, válida, já esteja pendurada nele.
    if (nota.lancamento_id) {
      const { data: outra } = await supabase.from('nota_fiscal')
        .select('id').eq('lancamento_id', nota.lancamento_id).eq('status', 'autorizada').maybeSingle()
      if (!outra) await supabase.from('lancamentos').update({ nf_emitida: false }).eq('id', nota.lancamento_id)
    }
    return { ok: true, lancamentoId: nota.lancamento_id }
  } catch (error) {
    try { await logSystemError(supabase as never, { userId, context: 'fiscal:nfse-cancelamento', error }) } catch { /* best-effort */ }
    return { error: 'Falha ao cancelar a nota. O time técnico foi avisado.' }
  }
}
