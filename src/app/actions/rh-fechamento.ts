'use server'

import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { sendMail, type MailAttachment } from '@/lib/email/send'
import { logSystemError } from '@/lib/system-error'
import { loadOrgDocs } from '@/lib/agency'
import { EspelhoLoteDoc } from '@/lib/pdf/EspelhoDoc'
import { montarEspelhosDoRun } from '@/lib/pdf/fechamento-ponto'

/** O ciclo congelado (mig. 256) — snapshot que a contabilidade recebe. */
export interface RunRhLinha {
  colaborador_id: string; nome: string; cpf: string | null; cargo: string | null
  ini: string; fim: string
  hn_min: number; he50_min: number; he100_min: number; faltas_min: number
  total_min: number; quitacao_min: number; pendente_min: number; dias_com_ponto: number
}
export interface RunRh {
  id: string; competencia: string; ini: string; fim: string
  status: string; versao: number
  fechado_em: string; reaberto_em: string | null; reaberto_motivo: string | null
  enviado_em: string | null; destinatarios: string[] | null; envios: number
  vr_valor: number | null; vt_valor: number | null; corpo: string | null
  rh_fechamento_run_linha: RunRhLinha[]
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, userId: user.id as string }
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const labelComp = (c: string) => { const [y, m] = c.split('-'); return `${MESES[Number(m) - 1]}/${y}` }
const dBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const hm = (min: number) => `${min < 0 ? '-' : ''}${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Congela o ciclo com as pessoas escolhidas (ini/fim próprios opcionais). */
export async function fecharCiclo(orgSlug: string, competencia: string,
  pessoas: { id: string; ini?: string; fim?: string }[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!/^\d{4}-\d{2}$/.test(competencia)) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_fechar_ciclo', {
    p_org_id: c.orgId, p_competencia: `${competencia}-01`, p_pessoas: pessoas,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true, runId: (data as { run_id: string }).run_id }
}

export async function reabrirFechamento(orgSlug: string, runId: string, motivo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_reabrir_fechamento', { p_run: runId, p_motivo: motivo })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

/** E-mails do RH da contabilidade — separado do fechamento financeiro. */
export async function salvarEmailsContabilidadeRh(orgSlug: string, emails: string[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const limpos = emails.map(e => e.trim()).filter(Boolean)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_salvar_contabil_emails', {
    p_org_id: c.orgId, p_emails: limpos,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true, emails: limpos }
}

function montarCsv(linhas: RunRhLinha[]): string {
  const head = ['Colaborador', 'Matrícula (CPF)', 'Cargo', 'Período', 'H.N.', 'H.E.50', 'H.E.100', 'Faltas', 'H. Totais', 'Quitação Banco']
  const rows = linhas.map(l => [
    l.nome, l.cpf ?? '—', l.cargo ?? '', `${dBR(l.ini)} a ${dBR(l.fim)}`,
    hm(l.hn_min), hm(l.he50_min), hm(l.he100_min), hm(l.faltas_min), hm(l.total_min), hm(l.quitacao_min),
  ])
  return [head, ...rows].map(r => r.map(cel => `"${String(cel).replace(/"/g, '""')}"`).join(';')).join('\r\n')
}

/**
 * Dispara o e-mail para o RH da contabilidade: espelho em PDF (uma página por
 * pessoa, período próprio de cada linha) + resumo em CSV, com o corpo revisado
 * na tela. Só por ação humana; `reenviar` marca a versão corrigida — mesmo
 * fluxo do fechamento financeiro.
 */
export async function enviarFechamentoRh(orgSlug: string, runId: string, dados: {
  vr: number | null; vt: number | null; corpo: string; reenviar?: boolean
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = c.supabase as any

  const { data: run } = await sb.from('rh_fechamento_run')
    .select('id, competencia, ini, fim, status, enviado_em, rh_fechamento_run_linha(colaborador_id, nome, cpf, cargo, ini, fim, hn_min, he50_min, he100_min, faltas_min, total_min, quitacao_min, pendente_min, dias_com_ponto)')
    .eq('id', runId).eq('org_id', c.orgId).maybeSingle()
  if (!run) return { error: 'Fechamento não encontrado.' }
  if (run.status === 'reaberto') return { error: 'O ciclo está reaberto — feche de novo antes de enviar.' }
  const reenvio = run.status === 'enviado'
  if (reenvio && !dados.reenviar) return { error: 'Este ciclo já foi enviado à contabilidade.' }
  if (!dados.corpo.trim()) return { error: 'O corpo do e-mail está vazio.' }

  const { data: cfg } = await sb.from('org_settings')
    .select('rh_contabil_emails, logo_url').eq('org_id', c.orgId).maybeSingle()
  const destinatarios = (cfg?.rh_contabil_emails ?? []) as string[]
  if (!destinatarios.length) return { error: 'Nenhum e-mail do RH da contabilidade configurado.' }

  try {
    const linhas = ([...run.rh_fechamento_run_linha] as RunRhLinha[])
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    const espelhos = await montarEspelhosDoRun(sb, c.orgId, run.competencia, linhas)
    const { agency } = await loadOrgDocs(sb, c.orgId)
    const pdf = await renderToBuffer(
      EspelhoLoteDoc({ dados: espelhos, agencia: agency, logoUrl: cfg?.logo_url ?? null }))

    const comp = String(run.competencia).slice(0, 7)
    const per = `${dBR(run.ini)} a ${dBR(run.fim)}`
    const anexos: MailAttachment[] = [
      { filename: `Espelho de ponto ${comp} (${per.replace(/\//g, '.')}).pdf`, content: Buffer.from(pdf) },
      { filename: `fechamento-ponto-${comp}.csv`, content: Buffer.from('﻿' + montarCsv(linhas), 'utf-8') },
    ]

    const dataAnterior = run.enviado_em ? new Date(run.enviado_em).toLocaleDateString('pt-BR') : null
    const html = `
      ${reenvio ? `<p><strong>Versão corrigida</strong> — substitui o material ${dataAnterior ? `enviado em ${dataAnterior}` : 'enviado antes'}.</p>` : ''}
      ${dados.corpo.trim().split(/\n+/).map(l => `<p>${escapeHtml(l)}</p>`).join('\n      ')}
      <p style="color:#888;font-size:12px">Enviado pelo Flow — espelho de ponto em PDF e resumo em CSV anexos (período ${per}).</p>`

    const { error: mailErr } = await sendMail({
      to: destinatarios,
      subject: `${reenvio ? '[Corrigido] ' : ''}Fechamento do ponto ${labelComp(comp)} — ${per}`,
      html,
      attachments: anexos,
    })
    if (mailErr) {
      await logSystemError(c.supabase, { userId: c.userId, context: 'rh-fechamento-envio', error: mailErr })
      return { error: `Não foi possível enviar: ${mailErr}` }
    }

    // Escrita via RPC: as tabelas do fechamento não têm policy de update.
    const { error: markErr } = await sb.rpc('rh_fechamento_marcar_envio', {
      p_run: runId, p_destinatarios: destinatarios,
      p_vr: dados.vr, p_vt: dados.vt, p_corpo: dados.corpo,
    })
    if (markErr) return { error: `E-mail enviado, mas o registro falhou: ${markErr.message}` }

    revalidatePath(`/${orgSlug}/rh/fechamento`)
    return { ok: true, destinatarios }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao montar o pacote'
    await logSystemError(c.supabase, { userId: c.userId, context: 'rh-fechamento-envio', error: msg })
    return { error: msg }
  }
}
