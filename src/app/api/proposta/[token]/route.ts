/**
 * Ações do CANDIDATO no link da proposta (sem sessão; o token é a credencial).
 *
 *  • abrir   — marca "abriu". Vem do browser ao montar a página, não da
 *              renderização: o preview de link do WhatsApp busca a URL e
 *              marcaria "abriu" sem ninguém ter aberto (mesma armadilha da
 *              cotação).
 *  • aceitar / recusar — resposta única; o banco recusa a segunda.
 */
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { admissaoPorToken, tokenValido } from '@/lib/admissao-server'
import type { FichaAdmissao } from '@/lib/admissao-ficha'

export const runtime = 'nodejs'

const ERROS: Record<string, string> = {
  link: 'Este link não é mais válido.',
  respondida: 'Esta proposta já foi respondida.',
  expirada: 'O prazo desta proposta terminou. Fale com a agência.',
  sem_aceite: 'Aceite a proposta antes de preencher a ficha.',
  encerrada: 'Este processo já foi encerrado. Fale com a agência.',
  formato: 'Não consegui ler os dados enviados.',
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!tokenValido(token)) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

  let body: { acao?: string; motivo?: string; ficha?: FichaAdmissao; final?: boolean; docId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 }) }

  if (body.acao === 'abrir') {
    await sql`select rh_admissao_marcar_aberta(${token})`
    return NextResponse.json({ ok: true })
  }

  // Ficha de admissão: rascunho a cada salvar, `final` quando o candidato
  // termina (é o que avisa o RH).
  if (body.acao === 'ficha') {
    const rows = await sql`
      select rh_admissao_salvar_ficha(${token}, ${JSON.stringify(body.ficha ?? {})}::jsonb, ${!!body.final}) as v
    ` as { v: { ok: boolean; erro?: string } }[]
    const r = rows[0]?.v
    if (!r?.ok) return NextResponse.json({ error: ERROS[r?.erro ?? 'link'] ?? 'Não foi possível salvar.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  if (body.acao === 'apagar-doc') {
    const id = typeof body.docId === 'string' ? body.docId : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Anexo inválido' }, { status: 400 })
    const rows = await sql`select rh_admissao_del_doc(${token}, ${id}::uuid) as v` as { v: { ok: boolean } }[]
    if (!rows[0]?.v?.ok) return NextResponse.json({ error: 'Não foi possível remover.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  if (body.acao !== 'aceitar' && body.acao !== 'recusar') {
    return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  }
  const p = await admissaoPorToken(token)
  if (!p) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

  // x-forwarded-for pode vir encadeado ("cliente, proxy1"): o primeiro é quem clicou.
  const h = request.headers
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || null
  const agente = h.get('user-agent')?.slice(0, 300) ?? null
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, 600) : null

  const rows = await sql`
    select rh_admissao_responder(${token}, ${body.acao === 'aceitar'}, ${motivo}, ${ip}, ${agente}) as v
  ` as { v: { ok: boolean; erro?: string } }[]
  const r = rows[0]?.v
  if (!r?.ok) return NextResponse.json({ error: ERROS[r?.erro ?? 'link'] ?? 'Não foi possível registrar.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
