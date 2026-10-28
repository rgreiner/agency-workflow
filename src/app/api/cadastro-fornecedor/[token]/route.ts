/**
 * Ações do FORNECEDOR no link de cadastro (sem sessão; o token é a credencial):
 *  • abrir  — marca "abriu" (pelo navegador, não no render: preview de link não conta).
 *  • salvar — grava a resposta e atualiza o cadastro com as regras do link de cotação:
 *             e-mail, WhatsApp e produtos SOMAM (nunca apagam o que a agência tinha),
 *             CNPJ válido substitui, nome do fornecedor nunca muda. Conta bancária não entra.
 */
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { cadastroPorToken, type CadastroResposta } from '@/lib/fornecedor-cadastro'
import { somenteDigitos } from '@/lib/telefone'
import { cnpjValido } from '@/lib/fiscal/tomador'

export const runtime = 'nodejs'

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cv = await cadastroPorToken(token)
  if (!cv) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

  let body: { acao?: string; dados?: Partial<CadastroResposta> }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 }) }

  if (body.acao === 'abrir') {
    await sql`select fornecedor_cadastro_aberto(${token})`
    return NextResponse.json({ ok: true })
  }
  if (body.acao !== 'salvar') return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

  const d = body.dados ?? {}
  const contato = (c: unknown) => {
    const x = (c ?? {}) as Record<string, unknown>
    return { nome: txt(x.nome, 80), email: txt(x.email, 200).toLowerCase(), whatsapp: txt(x.whatsapp, 30) }
  }
  const tiposOk = new Set([...cv.tipos, 'Outros'])
  const r: CadastroResposta = {
    razao: txt(d.razao, 160), cnpj: txt(d.cnpj, 30),
    tipo: tiposOk.has(txt(d.tipo, 80)) ? txt(d.tipo, 80) : '',
    tags: (Array.isArray(d.tags) ? d.tags : []).map(t => txt(t, 40)).filter(Boolean).slice(0, 15),
    comercial: contato(d.comercial), financeiro: contato(d.financeiro),
    cidade: txt(d.cidade, 80), uf: txt(d.uf, 2).toUpperCase(), atende: txt(d.atende, 200), obs: txt(d.obs, 1500),
  }
  for (const c of [r.comercial, r.financeiro]) {
    if (c.email && !emailOk(c.email)) return NextResponse.json({ error: `E-mail inválido: ${c.email}` }, { status: 400 })
  }
  const doc = somenteDigitos(r.cnpj)
  if (doc && !(doc.length === 14 && cnpjValido(doc)) && doc.length !== 11) {
    return NextResponse.json({ error: 'CNPJ inválido — confira os números.' }, { status: 400 })
  }

  const f = cv.fornecedor
  // Contatos SOMAM. O rótulo segue o padrão do cadastro ("Comercial | Ana").
  const emails = [...f.emails]
  const telefones = [...f.telefones]
  let mudouEmail = false, mudouTel = false
  const fim = (s: string) => somenteDigitos(s).slice(-8)
  for (const [papel, c] of [['Comercial', r.comercial], ['Financeiro', r.financeiro]] as const) {
    const rotulo = c.nome ? `${papel} | ${c.nome}` : papel
    if (c.email && !emails.some(e => (e.email ?? '').trim().toLowerCase() === c.email)) { emails.push({ tipo: rotulo, email: c.email }); mudouEmail = true }
    const zap = somenteDigitos(c.whatsapp)
    if (zap.length >= 10 && !telefones.some(t => fim(t.numero ?? '') === zap.slice(-8))) { telefones.push({ tipo: rotulo, numero: c.whatsapp }); mudouTel = true }
  }
  // Produtos/serviços somam às tags, sem duplicar grafia ("Grafica" = "Gráfica").
  const tags = [...(f.tags ?? [])]
  for (const t of r.tags) if (!tags.some(x => norm(x) === norm(t))) tags.push(t)
  // Cidade só entra quando o cadastro não tem endereço com cidade.
  const enderecos = !f.enderecos.some(e => e.cidade) && r.cidade
    ? [...f.enderecos, { tipo: 'Principal', logradouro: '', numero: '', complemento: '', bairro: '', cidade: r.cidade, uf: r.uf, cep: '' }]
    : null
  const taxId = doc && doc !== somenteDigitos(f.tax_id ?? '') ? doc : null
  const tipoNovo = r.tipo === 'Outros' ? '' : r.tipo

  const j = (v: unknown) => sql.json(JSON.parse(JSON.stringify(v)))
  await sql`select fornecedor_cadastro_gravar(
    ${token}, ${j(r)}, ${r.razao || null}, ${taxId}, ${tipoNovo || null},
    ${tags.length !== (f.tags ?? []).length ? tags : null},
    ${mudouEmail ? j(emails) : null}, ${mudouTel ? j(telefones) : null}, ${enderecos ? j(enderecos) : null})`
  return NextResponse.json({ ok: true })
}
