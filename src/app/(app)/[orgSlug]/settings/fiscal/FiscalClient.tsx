'use client'

import { useRef, useState, useTransition } from 'react'
import { Loader2, ShieldCheck, Upload, Trash2, AlertTriangle, Plug } from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { enviarCertificado, excluirCertificado, trocarAmbienteFiscal, testarReceita } from '@/app/actions/fiscal'
import { salvarConfigNfse, type ConfigNfse } from '@/app/actions/nfse'
import type { CertificadoPublico } from '@/lib/fiscal/certificado'

/**
 * Certificado digital e-CNPJ (A1) — a credencial da agência na Receita para
 * emitir NFS-e pelo Emissor Nacional.
 *
 * Ele VENCE (A1 dura um ano), e certificado vencido é nota parada: por isso a
 * validade fica na cara da tela e a troca é um upload, sem passar por ninguém.
 */
export function FiscalClient({ orgSlug, inicial, cfgInicial }: { orgSlug: string; inicial: CertificadoPublico | null; cfgInicial: ConfigNfse | null }) {
  const [cert, setCert] = useState(inicial)
  const [senha, setSenha] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string; detalhe: string } | null>(null)
  const [excluir, setExcluir] = useState(false)
  const [salvando, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const dias = cert?.diasRestantes ?? null
  const venceu = dias !== null && dias < 0
  const vencendo = dias !== null && dias >= 0 && dias <= 30

  async function enviar() {
    if (!arquivo) { toast.error('Escolha o arquivo .pfx ou .p12.'); return }
    if (!senha) { toast.error('Informe a senha do certificado.'); return }
    setEnviando(true)
    try {
      const base64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
      const r = await enviarCertificado(orgSlug, { nome: arquivo.name, base64, senha })
      if (r.error) { toast.error(r.error, { duration: 8000 }); return }
      setCert(r.info ?? null)
      setSenha(''); setArquivo(null); setResultado(null)
      if (fileRef.current) fileRef.current.value = ''
      toast.success('Certificado guardado, cifrado. Agora teste a conexão com a Receita.')
    } finally {
      setEnviando(false)
    }
  }

  async function testar() {
    setTestando(true); setResultado(null)
    try {
      const r = await testarReceita(orgSlug)
      if ('error' in r && r.error) { toast.error(r.error); return }
      setResultado(r as { ok: boolean; mensagem: string; detalhe: string })
    } finally {
      setTestando(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Nota fiscal</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Certificado digital da agência para emitir NFS-e pelo Emissor Nacional da Receita.
        </p>
      </div>

      {/* ── Estado do certificado ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className={cn('mt-0.5 shrink-0 rounded-xl p-2',
              !cert ? 'bg-gray-100 text-gray-400' : venceu ? 'bg-red-50 text-red-500' : vencendo ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600')}>
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {cert ? (cert.titular ?? 'Certificado cadastrado') : 'Nenhum certificado cadastrado'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {cert
                  ? <>{cert.cnpj ? `CNPJ ${cert.cnpj} · ` : ''}{cert.nomeArquivo ?? 'arquivo'}</>
                  : 'Envie o e-CNPJ A1 (.pfx ou .p12) para o Flow poder emitir.'}
              </p>
            </div>
          </div>
          {cert && (
            <button type="button" onClick={() => setExcluir(true)}
              className="press shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              aria-label="Remover certificado">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {cert?.ilegivel && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            O certificado está guardado mas não abre com o segredo atual do servidor. Envie o arquivo de novo.
          </p>
        )}

        {cert?.validoAte && (
          <p className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs',
            venceu ? 'bg-red-50 text-red-700' : vencendo ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600')}>
            {(venceu || vencendo) && <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />}
            <span>
              {venceu
                ? <>Venceu em {formatDate(cert.validoAte)}. Enquanto não trocar, nenhuma nota sai.</>
                : vencendo
                  ? <>Vence em {dias} {dias === 1 ? 'dia' : 'dias'} ({formatDate(cert.validoAte)}). Providencie a renovação antes — certificado vencido para a emissão.</>
                  : <>Válido até {formatDate(cert.validoAte)} ({dias} dias).</>}
            </span>
          </p>
        )}

        {cert && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="w-56">
              <Select
                value={cert.ambiente}
                onChange={v => start(async () => {
                  const r = await trocarAmbienteFiscal(orgSlug, v as 'restrita' | 'producao')
                  if (r?.error) { toast.error(r.error); return }
                  setCert(c => (c ? { ...c, ambiente: v as 'restrita' | 'producao' } : c))
                  setResultado(null)
                  toast.success(v === 'producao' ? 'Ambiente: produção. Nota emitida aqui é oficial.' : 'Ambiente: produção restrita (testes).')
                })}
                options={[
                  { value: 'restrita', label: 'Produção restrita (testes)' },
                  { value: 'producao', label: 'Produção (nota oficial)' },
                ]}
              />
            </div>
            <button type="button" onClick={testar} disabled={testando || salvando}
              className="press inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors">
              {testando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              Testar conexão com a Receita
            </button>
          </div>
        )}

        {resultado && (
          <div className={cn('rounded-xl px-3 py-2.5 text-xs space-y-1', resultado.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900')}>
            <p className="font-medium">{resultado.mensagem}</p>
            {resultado.detalhe && <p className="font-mono text-[11px] opacity-80 break-all">{resultado.detalhe}</p>}
          </div>
        )}
      </section>

      {/* ── Enviar / trocar ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-gray-900">{cert ? 'Trocar o certificado' : 'Enviar o certificado'}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Arquivo .pfx ou .p12 do e-CNPJ A1. O arquivo e a senha são guardados cifrados e nunca voltam para a tela.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".pfx,.p12" className="hidden"
            onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="press inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
            <Upload className="w-4 h-4" /> Escolher arquivo
          </button>
          <span className="text-xs text-gray-500 truncate max-w-[16rem]">{arquivo?.name ?? 'nenhum arquivo escolhido'}</span>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="cert-senha" className="block text-xs font-medium text-gray-600 mb-1">Senha do certificado</label>
            <input id="cert-senha" type="password" value={senha} onChange={e => setSenha(e.target.value)}
              autoComplete="off"
              className="w-full px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
          </div>
          <button type="button" onClick={enviar} disabled={enviando || !arquivo || !senha}
            className="press inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors">
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Guardar certificado
          </button>
        </div>

        <p className="text-[11px] text-gray-400">
          Certificado A1 do ICP-Brasil costuma vir com criptografia antiga, que o servidor recusa. Quando isso acontece,
          o Flow reconverte o arquivo na hora, com a mesma senha — você não precisa fazer nada.
        </p>
      </section>

      <DadosDaNota orgSlug={orgSlug} inicial={cfgInicial} />

      <ConfirmDialog
        open={excluir}
        title="Remover o certificado?"
        description="Sem certificado o Flow para de emitir nota. O arquivo sai do banco e precisa ser enviado de novo."
        confirmLabel="Remover"
        onCancel={() => setExcluir(false)}
        onConfirm={() => start(async () => {
          const r = await excluirCertificado(orgSlug)
          if (r?.error) { toast.error(r.error); return }
          setCert(null); setResultado(null); setExcluir(false)
          toast.success('Certificado removido.')
        })}
      />
    </div>
  )
}

/**
 * Os números fiscais da nota. São CADASTRO, não constante no código: valor errado
 * aqui só se conserta cancelando a nota emitida.
 *
 * Os valores vieram das últimas NFS-e reais da casa (2193 e 2205, emitidas no
 * sistema da prefeitura) e foram CONFERIDOS PELO FISCAL DA CONTABILIDADE em
 * 01/10/2026 — código do serviço, percentual e os códigos da Reforma. Não são
 * mais palpite; mudar qualquer um aqui pede a mesma conferência de novo.
 */
function DadosDaNota({ orgSlug, inicial }: { orgSlug: string; inicial: ConfigNfse | null }) {
  const [f, setF] = useState({
    serie: inicial?.serie ?? '00001',
    proximoNumero: String(inicial?.proximoNumero ?? 1),
    codMunicipio: inicial?.codMunicipio ?? '4104808',
    codigoServico: inicial?.codigoServico ?? '170601',
    percSimples: inicial?.percSimples != null ? String(inicial.percSimples).replace('.', ',') : '',
    tribIssqn: String(inicial?.tribIssqn ?? 1),
    tpRetIssqn: String(inicial?.tpRetIssqn ?? 1),
    descricaoPadrao: inicial?.descricaoPadrao ?? '',
    codNbs: inicial?.codNbs ?? '',
    ibsCbsAtivo: !!inicial?.ibsCbsAtivo,
    ibsCbsCIndOp: inicial?.ibsCbsCIndOp ?? '',
    ibsCbsCst: inicial?.ibsCbsCst ?? '',
    ibsCbsClassTrib: inicial?.ibsCbsClassTrib ?? '',
  })
  const [salvando, start] = useTransition()
  const num = (v: string) => Number(v.replace(',', '.'))
  const faltaPerc = !f.percSimples.trim()

  function salvar() {
    start(async () => {
      const r = await salvarConfigNfse(orgSlug, {
        serie: f.serie.trim() || '00001',
        proximoNumero: Math.max(1, Math.floor(num(f.proximoNumero)) || 1),
        codMunicipio: f.codMunicipio.trim() || null,
        codigoServico: f.codigoServico.trim() || null,
        percSimples: faltaPerc ? null : num(f.percSimples),
        tribIssqn: Number(f.tribIssqn) || 1,
        tpRetIssqn: Number(f.tpRetIssqn) || 1,
        descricaoPadrao: f.descricaoPadrao.trim() || null,
        codNbs: f.codNbs.trim() || null,
        ibsCbsAtivo: f.ibsCbsAtivo,
        ibsCbsCIndOp: f.ibsCbsCIndOp.trim() || null,
        ibsCbsCst: f.ibsCbsCst.trim() || null,
        ibsCbsClassTrib: f.ibsCbsClassTrib.trim() || null,
      })
      if (r?.error) { toast.error(r.error); return }
      toast.success('Dados da nota salvos.')
    })
  }

  const campo = 'w-full px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none'

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-gray-900">Dados da nota</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          O que a Receita exige em toda NFS-e. Sem isso o Flow recusa emitir, de propósito.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id="nf-mun" rotulo="Município de emissão (IBGE)" dica="Cascavel = 4104808">
          <input id="nf-mun" value={f.codMunicipio} onChange={e => setF({ ...f, codMunicipio: e.target.value })} inputMode="numeric" className={campo} />
        </Campo>
        <Campo id="nf-serv" rotulo="Código do serviço" dica="Propaganda e publicidade (LC 116 item 17.06)">
          <input id="nf-serv" value={f.codigoServico} onChange={e => setF({ ...f, codigoServico: e.target.value })} inputMode="numeric" className={campo} />
        </Campo>
        <Campo id="nf-perc" rotulo="Percentual total de tributos (%)"
          dica="13,45% federais + 4,64% municipais = 18,09%, igual nas NFs 2193 e 2205 — conferido pelo fiscal da contabilidade em 01/10/2026.">
          <input id="nf-perc" value={f.percSimples} onChange={e => setF({ ...f, percSimples: e.target.value })} inputMode="decimal" placeholder="ex.: 18,09"
            className={cn(campo, faltaPerc && 'bg-amber-50 border-amber-200')} />
        </Campo>
        <Campo id="nf-desc" rotulo="Descrição padrão" dica="Usada quando o lançamento não tem descrição">
          <input id="nf-desc" value={f.descricaoPadrao} onChange={e => setF({ ...f, descricaoPadrao: e.target.value })} placeholder="Prestação de serviços de publicidade" className={campo} />
        </Campo>
        <Campo id="nf-serie" rotulo="Série" dica="Numeração da DPS é nossa; o número da NFS-e quem dá é a Receita">
          <input id="nf-serie" value={f.serie} onChange={e => setF({ ...f, serie: e.target.value })} className={campo} />
        </Campo>
        <Campo id="nf-num" rotulo="Próximo número da DPS" dica="Da sequência OFICIAL. O ambiente de teste tem contador próprio, para não abrir buraco nesta.">
          <input id="nf-num" value={f.proximoNumero} onChange={e => setF({ ...f, proximoNumero: e.target.value })} inputMode="numeric" className={campo} />
        </Campo>
      </div>

      {/* ── Reforma tributária ────────────────────────────────────────────
          Sondado contra a produção restrita em 01/10: o grupo IBS/CBS É aceito
          do nosso CNPJ do Simples, desde que a DPS vá na versão 1.01 (E0854),
          com código NBS junto (E0322) e com códigos de tabela que existam
          (E0901). Nada disso é alíquota: quem calcula o IBS e a CBS é a Receita;
          o emitente classifica a operação. */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Reforma tributária (IBS/CBS)</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              Para optante do Simples, obrigatório a partir de 01/2027 — mas a Receita já aceita hoje.
              Não se digita alíquota: os 0,9% de CBS e 0,1% de IBS de 2026 são calculados por ela a partir
              da classificação abaixo. Os códigos foram conferidos pelo fiscal da contabilidade em 01/10/2026.
            </p>
          </div>
          <label className="shrink-0 inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={f.ibsCbsAtivo} onChange={e => setF({ ...f, ibsCbsAtivo: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            Enviar na nota
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="nf-nbs" rotulo="Código NBS (9 dígitos)" dica="Nomenclatura Brasileira de Serviços. Em 2026 é o campo da Reforma que o Simples informa — e é obrigatório junto com IBS/CBS.">
            <input id="nf-nbs" value={f.codNbs} onChange={e => setF({ ...f, codNbs: e.target.value })} inputMode="numeric" placeholder="ex.: 115011000" className={campo} />
          </Campo>
          <Campo id="nf-cindop" rotulo="Código indicador da operação (6 dígitos)" dica="Tabela da Reforma. Valor inventado é recusado com E0901.">
            <input id="nf-cindop" value={f.ibsCbsCIndOp} onChange={e => setF({ ...f, ibsCbsCIndOp: e.target.value })} inputMode="numeric" className={campo} />
          </Campo>
          <Campo id="nf-cst" rotulo="CST (3 dígitos)" dica="Código de situação tributária do IBS/CBS.">
            <input id="nf-cst" value={f.ibsCbsCst} onChange={e => setF({ ...f, ibsCbsCst: e.target.value })} inputMode="numeric" className={campo} />
          </Campo>
          <Campo id="nf-classtrib" rotulo="Classificação tributária (6 dígitos)" dica="cClassTrib — combina com o CST.">
            <input id="nf-classtrib" value={f.ibsCbsClassTrib} onChange={e => setF({ ...f, ibsCbsClassTrib: e.target.value })} inputMode="numeric" className={campo} />
          </Campo>
        </div>

        {f.ibsCbsAtivo && !(f.codNbs.trim() && f.ibsCbsCIndOp.trim() && f.ibsCbsCst.trim() && f.ibsCbsClassTrib.trim()) && (
          <p className="text-[11px] text-amber-700">
            Com os quatro campos preenchidos a DPS passa a sair na versão 1.01 com o grupo IBS/CBS.
            Faltando qualquer um, o Flow recusa emitir — grupo pela metade é recusa certa, e a recusa
            vem depois de consumir o número da DPS.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-gray-400 max-w-md">
          ISSQN fica como tributável e não retido (o Simples recolhe), que é o que as notas mostram.
        </p>
        <button type="button" onClick={salvar} disabled={salvando}
          className="press inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors">
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Salvar dados da nota
        </button>
      </div>
    </section>
  )
}

function Campo({ id, rotulo, dica, children }: { id: string; rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">{rotulo}</label>
      {children}
      {dica && <p className="text-[11px] text-gray-400 mt-1">{dica}</p>}
    </div>
  )
}
