'use client'

import { useRef, useState, useTransition } from 'react'
import { Loader2, ShieldCheck, Upload, Trash2, AlertTriangle, Plug } from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { enviarCertificado, excluirCertificado, trocarAmbienteFiscal, testarReceita } from '@/app/actions/fiscal'
import type { CertificadoPublico } from '@/lib/fiscal/certificado'

/**
 * Certificado digital e-CNPJ (A1) — a credencial da agência na Receita para
 * emitir NFS-e pelo Emissor Nacional.
 *
 * Ele VENCE (A1 dura um ano), e certificado vencido é nota parada: por isso a
 * validade fica na cara da tela e a troca é um upload, sem passar por ninguém.
 */
export function FiscalClient({ orgSlug, inicial }: { orgSlug: string; inicial: CertificadoPublico | null }) {
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
