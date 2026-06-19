'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export function CopyButton({ text, label = 'Copiar', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          toast.success('Copiado!')
          setTimeout(() => setCopied(false), 1200)
        }).catch(() => toast.error('Não foi possível copiar'))
      }}
      className={cn('p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition shrink-0', className)}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
