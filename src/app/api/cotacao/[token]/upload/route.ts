/**
 * Upload do FORNECEDOR (proposta em PDF, planilha…). Sem sessão: o token do
 * convite é a credencial, e a pasta vem do banco (org/cotação do convite), nunca
 * do form. Devolve a referência; ela só vale depois que o envio da proposta a
 * grava no convite.
 */
import { NextResponse } from 'next/server'
import { convitePorToken, cotacaoFechada, gravarArquivo } from '@/lib/cotacao-server'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cv = await convitePorToken(token)
  if (!cv) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
  if (cotacaoFechada(cv)) return NextResponse.json({ error: 'Esta cotação já foi encerrada' }, { status: 409 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  const ref = await gravarArquivo(`${cv.org_id}/${cv.cotacao_id}/${cv.id}`, file)
  if ('error' in ref) return NextResponse.json(ref, { status: 400 })
  return NextResponse.json(ref)
}
