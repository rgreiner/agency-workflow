'use server'

import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { sendMail, type MailAttachment } from '@/lib/email/send'
import { logSystemError } from '@/lib/system-error'
import { loadOrgDocs } from '@/lib/agency'
import { FechamentoResumoDoc } from '@/lib/pdf/FechamentoResumoDoc'

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
  /** true = ciclo interno (sócio/estagiário): fecha e não vai à contabilidade. */
  sem_envio: boolean
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

/** Marca (ou desmarca) o ciclo como interno — fecha sem ir à contabilidade.
 *  Sócio e estagiário: o espelho fica registrado, o e-mail não existe. */
export async function marcarSemEnvio(orgSlug: string, runId: string, semEnvio: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_fechamento_sem_envio', {
    p_run: runId, p_sem_envio: semEnvio,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
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

/** A tabela do banco de horas no CORPO do e-mail ("segue abaixo…") — o
 *  formato que a contabilidade pediu; estilos inline por causa dos clientes
 *  de e-mail. */
function tabelaHtml(linhas: RunRhLinha[]): string {
  const th = (t: string, right = true) =>
    `<th style="padding:6px 8px;border:1px solid #d1d5db;background:#f3f4f6;font-size:12px;text-align:${right ? 'right' : 'left'};white-space:nowrap">${t}</th>`
  const td = (t: string, right = true, forte = false) =>
    `<td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:12px;text-align:${right ? 'right' : 'left'};${forte ? 'font-weight:bold;' : ''}white-space:nowrap">${t}</td>`
  const tot = linhas.reduce((a, l) => ({
    hn: a.hn + l.hn_min, h50: a.h50 + l.he50_min, h100: a.h100 + l.he100_min,
    faltas: a.faltas + l.faltas_min, total: a.total + l.total_min, quit: a.quit + l.quitacao_min,
  }), { hn: 0, h50: 0, h100: 0, faltas: 0, total: 0, quit: 0 })
  return `
    <table style="border-collapse:collapse;margin:12px 0">
      <tr>${th('Colaborador', false)}${th('Matrícula (CPF)', false)}${th('H.N.')}${th('H.E.50')}${th('H.E.100')}${th('Faltas')}${th('H. Totais')}${th('Quitação Banco')}</tr>
      ${linhas.map(l => `<tr>${td(escapeHtml(l.nome), false)}${td(l.cpf ?? '—', false)}${td(hm(l.hn_min))}${td(hm(l.he50_min))}${td(hm(l.he100_min))}${td(hm(l.faltas_min))}${td(hm(l.total_min), true, true)}${td(hm(l.quitacao_min), true, true)}</tr>`).join('\n      ')}
      <tr>${td('<b>TOTAIS</b>', false)}${td('', false)}${td(`<b>${hm(tot.hn)}</b>`)}${td(`<b>${hm(tot.h50)}</b>`)}${td(`<b>${hm(tot.h100)}</b>`)}${td(`<b>${hm(tot.faltas)}</b>`)}${td(`<b>${hm(tot.total)}</b>`)}${td(`<b>${hm(tot.quit)}</b>`)}</tr>
    </table>
    <p style="color:#6b7280;font-size:11px">H.N. = horas normais · H.E.50/100 = extras aprovadas · H. Totais = H.N. + extras − faltas · Quitação Banco = extras − faltas.</p>`
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
    const { agency } = await loadOrgDocs(sb, c.orgId)
    // Anexo = o RESUMO (tabela do banco de horas): a contabilidade pediu só
    // essas colunas (26/08). O espelho detalhado segue disponível na tela.
    const comp = String(run.competencia).slice(0, 7)
    const pdf = await renderToBuffer(
      FechamentoResumoDoc({ d: { ini: run.ini, fim: run.fim, competencia: comp, linhas },
        agencia: agency, logoUrl: cfg?.logo_url ?? null }))

    const per = `${dBR(run.ini)} a ${dBR(run.fim)}`
    const anexos: MailAttachment[] = [
      { filename: `Fechamento do ponto ${comp} (${per.replace(/\//g, '.')}).pdf`, content: Buffer.from(pdf) },
      { filename: `fechamento-ponto-${comp}.csv`, content: Buffer.from('﻿' + montarCsv(linhas), 'utf-8') },
    ]

    const dataAnterior = run.enviado_em ? new Date(run.enviado_em).toLocaleDateString('pt-BR') : null
    const html = `
      ${reenvio ? `<p><strong>Versão corrigida</strong> — substitui o material ${dataAnterior ? `enviado em ${dataAnterior}` : 'enviado antes'}.</p>` : ''}
      ${dados.corpo.trim().split(/\n+/).map(l => `<p>${escapeHtml(l)}</p>`).join('\n      ')}
      ${tabelaHtml(linhas)}
      <p style="color:#888;font-size:12px">Enviado pelo Flow — tabela também em PDF e CSV anexos (período ${per}).</p>`

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
