'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FolderOpen } from 'lucide-react'

/**
 * Aviso enquanto as pastas do Drive são criadas em 2º plano. Recarrega a rota
 * a cada poucos segundos até as pastas aparecerem (o servidor para de renderizar
 * este aviso quando a tarefa já tem a pasta). Após ~30s, avisa que está demorando.
 */
export function DriveProvisioningNotice() {
  const router = useRouter()
  const [tries, setTries] = useState(0)

  useEffect(() => {
    if (tries >= 8) return
    const t = setTimeout(() => { router.refresh(); setTries(n => n + 1) }, 4000)
    return () => clearTimeout(t)
  }, [tries, router])

  const slow = tries >= 8

  return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-sm">
      {slow
        ? <FolderOpen className="w-4 h-4 text-indigo-500 shrink-0" />
        : <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
      <div className="min-w-0">
        <p className="text-indigo-800 font-medium">
          {slow ? 'As pastas do Drive ainda não apareceram' : 'Criando as pastas no Drive…'}
        </p>
        <p className="text-indigo-500/80 text-xs">
          {slow
            ? 'Está demorando mais que o normal — recarregue a página em instantes.'
            : 'A pasta da tarefa e as subpastas estão sendo criadas. Já já os links aparecem aqui.'}
        </p>
      </div>
    </div>
  )
}
