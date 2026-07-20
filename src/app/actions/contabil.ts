'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { getUsuario } from '@/lib/auth/server'
import { montarPacoteContabil, limitesCompetencia } from '@/lib/contabil/relatorio'
import { sendMail } from '@/lib/email/send'
import { logSystemError } from '@/lib/system-error'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function labelCompetencia(c: string): string {
  const [y, m] = c.split('-')
  return `${MESES[Number(m) - 1]}/${y}`
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Prévia do que seria enviado — alimenta a tela de conferência antes do disparo. */
export async function previewFechamento(orgSlug: string, competencia: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: cfg } = await sb.from('org_settings')
    .select('contabil_emails').eq('org_id', orgId).maybeSingle()
  try {
    const pacote = await montarPacoteContabil(sb, orgId, competencia)
    return {
      resumo: pacote.resumo,
      avisos: pacote.avisos,
      anexos: pacote.anexos.map(a => ({ nome: a.filename, kb: Math.round(a.content.length / 1024) })),
      destinatarios: (cfg?.contabil_emails ?? []) as string[],
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao montar o pacote' }
  }
}

/**
 * Confirma o fechamento e DISPARA o e-mail pra contabilidade. Só roda por ação
 * humana — o cron apenas abre o fechamento e avisa. Marca quem confirmou.
 */
export async function enviarFechamento(orgSlug: string, competencia: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: fech } = await sb.from('fechamento_contabil')
    .select('id, status').eq('org_id', orgId).eq('competencia', competencia).maybeSingle()
  if (!fech) return { error: 'Fechamento não encontrado para esta competência.' }
  if (fech.status === 'enviado') return { error: 'Este mês já foi enviado à contabilidade.' }

  const { data: cfg } = await sb.from('org_settings')
    .select('contabil_emails').eq('org_id', orgId).maybeSingle()
  const destinatarios = (cfg?.contabil_emails ?? []) as string[]
  if (!destinatarios.length) return { error: 'Nenhum e-mail da contabilidade configurado.' }

  try {
    const pacote = await montarPacoteContabil(sb, orgId, competencia)
    const { ini, fim } = limitesCompetencia(competencia)
    const r = pacote.resumo

    const html = `
      <p>Olá,</p>
      <p>Segue o material de <strong>${labelCompetencia(competencia)}</strong>
         (${ini.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}).</p>
      <ul>
        <li><strong>Extrato bancário</strong> — ${r.movimentos} movimento(s) em ${r.contas} conta(s)${r.ofxAnexados ? `, mais ${r.ofxAnexados} arquivo(s) OFX original(is) do banco` : ''}.</li>
        <li><strong>Recebimentos</strong> — ${r.recebimentos} recebimento(s), total de ${brl(r.totalRecebido)}.</li>
      </ul>
      <p>A planilha anexa tem duas abas: <em>Extrato</em> e <em>Recebimentos</em>.</p>
      <p>Qualquer divergência, é só responder este e-mail.</p>
      <p style="color:#888;font-size:12px">Enviado pelo Flow — One a One Comunicação &amp; Estratégia.</p>`

    const { error: mailErr } = await sendMail({
      to: destinatarios,
      subject: `Contabilidade ${labelCompetencia(competencia)} — extrato e recebimentos`,
      html,
      attachments: pacote.anexos,
    })

    if (mailErr) {
      await sb.rpc('marcar_fechamento_enviado', {
        p_org_id: orgId, p_competencia: competencia, p_user_id: user.id, p_erro: mailErr,
      })
      await logSystemError(supabase, { userId: user.id, context: 'fechamento-contabil', error: mailErr })
      return { error: `Não foi possível enviar: ${mailErr}` }
    }

    // Escrita via RPC: a tabela não tem policy de update (migration 129).
    const { error: markErr } = await sb.rpc('marcar_fechamento_enviado', {
      p_org_id: orgId, p_competencia: competencia, p_user_id: user.id,
      p_destinatarios: destinatarios,
    })
    if (markErr) {
      // O e-mail JÁ saiu — não dá pra desfazer. Registra e avisa, em vez de
      // deixar o mês parecendo não enviado e alguém disparar de novo.
      await logSystemError(supabase, { userId: user.id, context: 'fechamento-contabil', error: markErr.message })
      return { ok: true, destinatarios, resumo: r, aviso: 'E-mail enviado, mas o status não foi gravado. Não reenvie sem conferir.' }
    }

    revalidatePath(`/${orgSlug}/financeiro`)
    return { ok: true, destinatarios, resumo: r }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao enviar'
    await logSystemError(supabase, { userId: user.id, context: 'fechamento-contabil', error: e })
    return { error: msg }
  }
}

/** Configuração do envio à contabilidade (e-mails, dia do disparo, liga/desliga). */
export async function salvarConfigContabil(
  orgSlug: string, cfg: { emails: string[]; dia: number; ativo: boolean },
) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const emails = cfg.emails.map(e => e.trim()).filter(Boolean)
  const invalido = emails.find(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  if (invalido) return { error: `E-mail inválido: ${invalido}` }
  if (cfg.ativo && emails.length === 0) return { error: 'Defina ao menos um e-mail antes de ativar.' }
  if (cfg.dia < 1 || cfg.dia > 28) return { error: 'O dia precisa estar entre 1 e 28.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('org_settings')
    .update({ contabil_emails: emails, contabil_dia: cfg.dia, contabil_ativo: cfg.ativo })
    .eq('org_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/fechamento`)
  return { ok: true }
}

/** Abre o fechamento de uma competência na mão (sem esperar o cron). */
export async function abrirFechamentoManual(orgSlug: string, competencia: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('abrir_fechamento_contabil', {
    p_org_id: orgId, p_competencia: competencia,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/fechamento`)
  return { ok: true }
}
