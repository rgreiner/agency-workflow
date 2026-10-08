/**
 * Anexos do CANDIDATO (RG, CPF, comprovante…). Sem sessão: o token manda.
 * O arquivo vai para o volume fora de /uploads e a referência entra pela RPC,
 * que confere aceite e processo aberto.
 */
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { admissaoPorToken, tokenValido, PREFIXO_ADMISSAO } from '@/lib/admissao-server'
import { gravarPrivado, MAX_ARQUIVO } from '@/lib/arquivo-privado'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!tokenValido(token)) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
  const p = await admissaoPorToken(token)
  if (!p || !p.aceita_em) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('arquivo')
  const tipo = String(form?.get('tipo') ?? 'outro').slice(0, 40)
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Envie um arquivo' }, { status: 400 })
  if (file.size > MAX_ARQUIVO) return NextResponse.json({ error: 'Arquivo muito grande (máx 15MB)' }, { status: 400 })

  const gravado = await gravarPrivado(PREFIXO_ADMISSAO, p.id, file)
  if ('error' in gravado) return NextResponse.json({ error: gravado.error }, { status: 400 })

  const rows = await sql`
    select rh_admissao_add_doc(${token}, ${tipo}, ${gravado.nome}, ${gravado.chave}) as v
  ` as { v: { ok: boolean; id?: string; erro?: string } }[]
  const r = rows[0]?.v
  if (!r?.ok) {
    return NextResponse.json({
      error: r?.erro === 'limite' ? 'Muitos anexos neste processo.' : 'Não foi possível anexar.',
    }, { status: 409 })
  }
  return NextResponse.json({ ok: true, id: r.id, nome: gravado.nome, tipo })
}
