'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, FolderPen, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { renomearPastaDrive, atualizarCaminhoDrive } from '@/app/actions/activity'

/**
 * O que a página descobriu, no Drive, sobre a pasta desta tarefa — só quando o
 * último segmento do caminho salvo não bate com o nome esperado pelo título.
 */
export type DriveFolderAviso =
  | { tipo: 'nome'; real: string; esperado: string }   // tarefa renomeada; pasta ficou no nome antigo
  | { tipo: 'caminho'; real: string }                   // pasta renomeada por fora; caminho salvo ficou velho
  | { tipo: 'lixeira'; real: string }
  | { tipo: 'sumida' }

/**
 * Aviso visível (não um botãozinho âmbar) — o caso de 08/09/2026: a tarefa dizia
 * "Pitoco", a pasta "Aldeia", e o time achou que o vínculo estava errado e
 * consertou à mão o lado errado. Aqui a mensagem diz QUEM está desatualizado e a
 * ação corrige aquele lado. Renomear com arquivo dentro passa por confirmação.
 */
export function DriveFolderNotice({ orgSlug, path, activityId, aviso }: {
  orgSlug: string; path: string; activityId: string; aviso: DriveFolderAviso
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmar, setConfirmar] = useState(false)

  function renomear(force = false) {
    start(async () => {
      const r = await renomearPastaDrive(orgSlug, path, activityId, force)
      if ('temArquivos' in r && r.temArquivos) { setConfirmar(true); return }
      if ('error' in r && r.error) { toast.error(r.error); return }
      setConfirmar(false)
      toast.success(`Pasta renomeada para "${'nome' in r ? r.nome : ''}".`)
      router.refresh()
    })
  }

  function atualizarCaminho() {
    start(async () => {
      const r = await atualizarCaminhoDrive(orgSlug, path, activityId)
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success('Caminho atualizado a partir do Drive.')
      router.refresh()
    })
  }

  const botao = 'inline-flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 transition-colors active:scale-[0.97] disabled:opacity-50'

  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
      {aviso.tipo === 'lixeira' || aviso.tipo === 'sumida'
        ? <Trash2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0 leading-relaxed">
        {aviso.tipo === 'nome' && (
          <>A pasta no Drive chama <b className="font-semibold">&ldquo;{aviso.real}&rdquo;</b>, e a tarefa agora se chama
            &ldquo;{aviso.esperado}&rdquo;. O link está certo; só o nome ficou para trás.</>
        )}
        {aviso.tipo === 'caminho' && (
          <>O caminho salvo está desatualizado: a pasta no Drive chama <b className="font-semibold">&ldquo;{aviso.real}&rdquo;</b>.
            O link abre a pasta certa; o caminho copiado, não.</>
        )}
        {aviso.tipo === 'lixeira' && (
          <>A pasta vinculada (&ldquo;{aviso.real}&rdquo;) está na <b className="font-semibold">lixeira do Drive</b>.
            Restaure lá, ou use Re-vincular para gerar uma pasta nova.</>
        )}
        {aviso.tipo === 'sumida' && (
          <>A pasta vinculada <b className="font-semibold">não existe mais no Drive</b> (apagada ou sem acesso).
            Use Re-vincular para gerar uma pasta nova.</>
        )}
      </div>
      {aviso.tipo === 'nome' && (
        <button type="button" onClick={() => renomear(false)} disabled={pending} className={botao}
          title={`Renomear a pasta para "${aviso.esperado}"`}>
          {pending && !confirmar ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPen className="w-3 h-3" />}
          Renomear pasta
        </button>
      )}
      {aviso.tipo === 'caminho' && (
        <button type="button" onClick={atualizarCaminho} disabled={pending} className={botao}
          title="Reler a pasta no Drive e regravar o caminho e os sublinks">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Atualizar caminho
        </button>
      )}

      {aviso.tipo === 'nome' && (
        <Modal open={confirmar} onClose={() => { if (!pending) setConfirmar(false) }} size="sm"
          label="Renomear pasta com arquivos" dismissable={!pending}>
          <ModalHeader title="A pasta já tem arquivos" onClose={() => { if (!pending) setConfirmar(false) }} />
          <div className="px-6 py-4 space-y-3 text-sm text-gray-700">
            <p>
              Renomear para <b className="font-semibold">&ldquo;{aviso.esperado}&rdquo;</b> não quebra os links do Flow
              nem do Drive (são por ID). O que pode quebrar é imagem vinculada por caminho dentro de arquivo
              aberto no Illustrator ou InDesign — quem estiver com o arquivo aberto precisa re-vincular.
            </p>
            <p className="text-gray-500">Se alguém está trabalhando nesta pasta agora, combine antes.</p>
          </div>
          <div className="px-6 pb-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmar(false)} disabled={pending}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={() => renomear(true)} disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#fff] bg-orange-500 hover:bg-orange-600 transition-colors active:scale-[0.97] disabled:opacity-50">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPen className="w-3.5 h-3.5" />}
              Renomear mesmo assim
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
