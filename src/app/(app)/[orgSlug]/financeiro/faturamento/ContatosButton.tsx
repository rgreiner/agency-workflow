'use client'

import { useRef, useState } from 'react'
import { Contact, X, Mail, Phone, MapPin, FileText, User, Building2 } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'

export interface ContatoCard {
  papel: string          // 'Cliente' | 'Fornecedor' | 'Veículo'
  nome: string
  razao?: string
  cnpj?: string
  emailNf?: string                              // e-mail p/ NF (financeiro) — em destaque
  emails?: { tipo: string; email: string }[]
  telefones?: { tipo: string; numero: string }[]
  enderecos?: string[]
  contato?: string
  notas?: string
}

const PAPEL_COR: Record<string, string> = {
  Cliente: 'bg-blue-50 text-blue-700 border-blue-200',
  Fornecedor: 'bg-amber-50 text-amber-700 border-amber-200',
  'Veículo': 'bg-purple-50 text-purple-700 border-purple-200',
}

export function ContatosButton({ contatos, titulo }: { contatos: ContatoCard[]; titulo: string }) {
  const [open, setOpen] = useState(false)
  const downOnBackdrop = useRef(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ver contatos (cliente / fornecedor / veículo)"
        className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
      >
        <Contact className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
          onMouseUp={e => { if (downOnBackdrop.current && e.target === e.currentTarget) setOpen(false); downOnBackdrop.current = false }}
        >
          <div className="modal-card w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">Contatos</h2>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{titulo}</p>
              </div>
              <button aria-label="Fechar" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 overflow-y-auto space-y-3">
              {contatos.map((c, i) => <CardView key={i} c={c} />)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CardView({ c }: { c: ContatoCard }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{c.nome || '—'}</p>
          {c.razao && c.razao !== c.nome && <p className="text-xs text-gray-500 truncate">{c.razao}</p>}
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${PAPEL_COR[c.papel] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>{c.papel}</span>
      </div>

      <dl className="space-y-1.5 text-sm">
        {c.emailNf && (
          <Linha icon={<Mail className="w-3.5 h-3.5" />} destaque label="E-mail p/ NF">
            <a href={`mailto:${c.emailNf}`} className="text-orange-700 hover:underline break-all">{c.emailNf}</a>
            <CopyButton text={c.emailNf} />
          </Linha>
        )}
        {(c.emails ?? []).filter(e => e.email !== c.emailNf).map((e, i) => (
          <Linha key={`e${i}`} icon={<Mail className="w-3.5 h-3.5" />} label={e.tipo}>
            <a href={`mailto:${e.email}`} className="text-gray-700 hover:underline break-all">{e.email}</a>
            <CopyButton text={e.email} />
          </Linha>
        ))}
        {(c.telefones ?? []).map((t, i) => (
          <Linha key={`t${i}`} icon={<Phone className="w-3.5 h-3.5" />} label={t.tipo}>
            <a href={`tel:${t.numero.replace(/[^\d+]/g, '')}`} className="text-gray-700 hover:underline">{t.numero}</a>
            <CopyButton text={t.numero} />
          </Linha>
        ))}
        {c.contato && (
          <Linha icon={<User className="w-3.5 h-3.5" />} label="Contato">
            <span className="text-gray-700">{c.contato}</span>
          </Linha>
        )}
        {c.cnpj && (
          <Linha icon={<Building2 className="w-3.5 h-3.5" />} label="CNPJ">
            <span className="text-gray-700 tabular-nums">{c.cnpj}</span>
            <CopyButton text={c.cnpj} />
          </Linha>
        )}
        {(c.enderecos ?? []).map((end, i) => (
          <Linha key={`a${i}`} icon={<MapPin className="w-3.5 h-3.5" />} label="Endereço">
            <span className="text-gray-700">{end}</span>
          </Linha>
        ))}
        {c.notas && (
          <Linha icon={<FileText className="w-3.5 h-3.5" />} label="Notas">
            <span className="text-gray-600 whitespace-pre-line">{c.notas}</span>
          </Linha>
        )}
      </dl>

      {!c.emailNf && !(c.emails ?? []).length && !(c.telefones ?? []).length && !c.cnpj && !c.contato && !(c.enderecos ?? []).length && !c.notas && (
        <p className="text-xs text-gray-400">Sem dados de contato cadastrados.</p>
      )}
    </div>
  )
}

function Linha({ icon, label, children, destaque }: { icon: React.ReactNode; label: string; children: React.ReactNode; destaque?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${destaque ? 'bg-orange-50 -mx-1 px-1 py-1 rounded-lg' : ''}`}>
      <span className="text-gray-400 shrink-0">{icon}</span>
      <span className="text-xs text-gray-400 w-20 shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0 flex-1">{children}</div>
    </div>
  )
}
