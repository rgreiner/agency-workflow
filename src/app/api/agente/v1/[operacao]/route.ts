/**
 * API de agentes v1 — a única porta dos funcionários digitais (rgreiner/digitais)
 * para o Flow. Contrato: digitais/docs/contrato-flow-v1.md. Mudança
 * incompatível vira /api/agente/v2, com a v1 viva até o agente migrar.
 *
 * Resposta sempre `{ ok, dados }` ou `{ ok: false, erro }`. Operação que não
 * existe responde 501 — o agente trata como "indisponível" e passa ao Rafael.
 */
import { NextResponse } from 'next/server'
import { autenticarAgente } from '@/lib/agente/auth'
import { ErroAgente, agenda, cancelamentos, cancelamentoAvisado, buscarContatos, titulosDetalhe, clientesSemFinanceiro, comissoesNf, comissaoDocumentos, reguaComissao, notasFiscais, cancelarNotaFiscal, rescisoes, btgConciliado, desfazerEnvio, folhaSituacao, folhaFechar, folhaEnviar, dpAgenda, contatosNomes, resumoMesa, recebimentosComparados, financeiroConsulta, registrarPromessa, cobrancaClientes, recebidosRecentes, renegociar, folhaLer, folhaAplicar, faturamentoFila, faturar, anexarDocumentoFila, nfseAEmitir, emitirNfse, adicionarEmailContato, cadastroPublico, cadastroConvitesGerar, cadastroMarcarEnvio, cadastroConvites, clienteDoTitulo, empresa, anexarDocumento, anotar, atualizarDespesa, despesasAbertas, lancarDespesa, lerDespesa, opcoesDespesa, cobranca, documentos, documentosFornecedor, identificar, nfFornecedor, prorrogar, registrarEnvio, registrarEnvioAgente, regua, titulos, verificar } from '@/lib/agente/operacoes'
import { logSystemError } from '@/lib/system-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export async function POST(req: Request, { params }: { params: Promise<{ operacao: string }> }) {
  const { operacao } = await params
  const agente = await autenticarAgente(req)
  if (!agente) return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin

  try {
    let dados: unknown
    switch (operacao) {
      case 'identificar': dados = await identificar(agente, str(b.canal), str(b.endereco)); break
      case 'verificar': dados = await verificar(agente, str(b.cnpj), str(b.documento)); break
      case 'titulos': dados = await titulos(agente, str(b.contato_tipo), str(b.contato_id), str(b.situacao) || 'abertos'); break
      case 'cobranca': dados = await cobranca(agente, str(b.titulo_id), base); break
      case 'prorrogar': dados = await prorrogar(agente, str(b.titulo_id), str(b.nova_data), str(b.motivo)); break
      case 'anotar':
        if (!str(b.titulo_id)) throw new ErroAgente('na v1 a anotação vai sempre num título (titulo_id)')
        dados = await anotar(agente, str(b.titulo_id), str(b.texto)); break
      case 'agenda': dados = await agenda(agente); break
      case 'regua': dados = await regua(agente); break
      case 'documentos': dados = await documentos(agente, base); break
      case 'registrar-envio': dados = await registrarEnvio(agente, str(b.titulo_id), str(b.bucket), str(b.telefone)); break
      case 'desfazer-envio': dados = await desfazerEnvio(agente, str(b.titulo_id), str(b.bucket)); break
      case 'dp-agenda': dados = await dpAgenda(agente); break
      case 'contatos-nomes': dados = await contatosNomes(agente); break
      case 'resumo-mesa': dados = await resumoMesa(agente); break
      case 'recebimentos-comparados': dados = await recebimentosComparados(agente); break
      case 'financeiro': dados = await financeiroConsulta(agente, str(b.consulta), (b.parametros && typeof b.parametros === 'object' ? b.parametros : {}) as Record<string, unknown>); break
      case 'recebidos-recentes': dados = await recebidosRecentes(agente, Number(b.dias)); break
      case 'cobranca-clientes': dados = await cobrancaClientes(agente); break
      case 'promessa': dados = await registrarPromessa(agente, str(b.titulo_id), str(b.data) || null, str(b.obs) || null); break
      case 'renegociar': dados = await renegociar(agente, Array.isArray(b.titulos) ? (b.titulos as unknown[]).map(str) : [], Number(b.parcelas), str(b.primeiro_vencimento), str(b.obs) || null); break
      case 'folha-ler': dados = await folhaLer(agente, str(b.pdf_base64)); break
      case 'folha-aplicar': dados = await folhaAplicar(agente, str(b.competencia), Array.isArray(b.salarios) ? b.salarios : []); break
      case 'faturamento-fila': dados = await faturamentoFila(agente); break
      case 'faturar': dados = await faturar(agente, str(b.tipo), str(b.id)); break
      case 'anexar-documento-fila': dados = await anexarDocumentoFila(agente, { tipo: str(b.tipo), id: str(b.id), tipo_anexo: str(b.tipo_anexo), numero: str(b.numero), nome: str(b.nome), conteudo_base64: str(b.conteudo_base64) }); break
      case 'nfse-a-emitir': dados = await nfseAEmitir(agente); break
      case 'adicionar-email-contato': dados = await adicionarEmailContato(agente, str(b.contato_tipo), str(b.contato_id), str(b.email)); break
      case 'cadastro-publico': dados = await cadastroPublico(agente, Number(b.onda)); break
      case 'cadastro-convites-gerar': dados = await cadastroConvitesGerar(agente, Array.isArray(b.ids) ? (b.ids as unknown[]).map(str) : []); break
      case 'cadastro-marcar-envio': dados = await cadastroMarcarEnvio(agente, str(b.convite_id), str(b.canal), b.lembrete === true); break
      case 'cadastro-convites': dados = await cadastroConvites(agente); break
      case 'emitir-nfse': dados = await emitirNfse(agente, str(b.lancamento_id)); break
      case 'folha-situacao': dados = await folhaSituacao(agente); break
      case 'folha-fechar': dados = await folhaFechar(agente, str(b.competencia), Array.isArray(b.pessoas) ? (b.pessoas as unknown[]).map(str).filter(Boolean) : [], b.sem_envio === true); break
      case 'folha-enviar': dados = await folhaEnviar(agente, str(b.run_id), { vr: typeof b.vr === 'number' ? b.vr : null, vt: typeof b.vt === 'number' ? b.vt : null, corpo: str(b.corpo) }); break
      case 'nf-fornecedor': dados = await nfFornecedor(agente); break
      case 'cancelamentos': dados = await cancelamentos(agente); break
      case 'cancelamento-avisado': dados = await cancelamentoAvisado(agente, str(b.id), str(b.canal), str(b.destino)); break
      case 'registrar-envio-agente': dados = await registrarEnvioAgente(agente, str(b.titulo_id), str(b.bucket), str(b.canal), str(b.destino)); break
      case 'documentos-fornecedor': dados = await documentosFornecedor(agente, str(b.contato_tipo), str(b.contato_id)); break
      case 'anexar-documento':
        dados = await anexarDocumento(agente, { titulo_id: str(b.titulo_id), tipo: str(b.tipo), numero: str(b.numero), nome: str(b.nome), conteudo_base64: str(b.conteudo_base64) }); break
      case 'despesas-abertas': dados = await despesasAbertas(agente); break
      case 'atualizar-despesa':
        dados = await atualizarDespesa(agente, {
          titulo_id: str(b.titulo_id), valor: typeof b.valor === 'number' ? b.valor : null, vencimento: str(b.vencimento) || null,
          tipo: str(b.tipo), numero: str(b.numero), nome: str(b.nome), conteudo_base64: str(b.conteudo_base64),
        }); break
      case 'opcoes-despesa': dados = await opcoesDespesa(agente); break
      case 'ler-despesa':
        dados = await lerDespesa(agente, Array.isArray(b.arquivos) ? (b.arquivos as { base64: string; mime: string; nome: string }[]) : []); break
      case 'lancar-despesa': dados = await lancarDespesa(agente, (b.dados ?? {}) as Record<string, unknown>); break
      case 'cliente-do-titulo': dados = await clienteDoTitulo(agente, str(b.titulo_id)); break
      case 'empresa': dados = await empresa(agente); break
      case 'buscar-contatos': dados = await buscarContatos(agente, str(b.termo)); break
      case 'clientes-sem-financeiro': dados = await clientesSemFinanceiro(agente); break
      case 'notas': dados = await notasFiscais(agente, { titulo_id: b.titulo_id ? str(b.titulo_id) : undefined, cliente_id: b.cliente_id ? str(b.cliente_id) : undefined }); break
      case 'cancelar-nota': dados = await cancelarNotaFiscal(agente, str(b.nota_id), str(b.motivo)); break
      case 'rescisoes': dados = await rescisoes(agente); break
      case 'regua-comissao': dados = await reguaComissao(agente); break
      case 'btg-conciliado': dados = await btgConciliado(agente); break
      case 'comissoes-nf': dados = await comissoesNf(agente); break
      case 'comissao-documentos': dados = await comissaoDocumentos(agente, str(b.titulo_id)); break
      case 'titulos-detalhe': dados = await titulosDetalhe(agente, Array.isArray(b.ids) ? (b.ids as string[]) : []); break
      default:
        return NextResponse.json({ ok: false, erro: `operação ${operacao} não existe na v1` }, { status: 501 })
    }
    return NextResponse.json({ ok: true, dados })
  } catch (e) {
    if (e instanceof ErroAgente) return NextResponse.json({ ok: false, erro: e.message }, { status: e.status })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await logSystemError(agente.supabase as any, { userId: agente.userId, context: `agente:${operacao}`, error: e })
    return NextResponse.json({ ok: false, erro: 'falha interna no Flow' }, { status: 500 })
  }
}
