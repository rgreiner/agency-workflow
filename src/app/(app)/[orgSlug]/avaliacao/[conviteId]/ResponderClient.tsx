'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Lock, Eye, MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import { responder, type Questionario } from '@/app/actions/rh-avaliacao'

/** Escala de FREQUÊNCIA, não de concordância: cada nota tem uma âncora de
 *  comportamento (BARS). Reduz muito a variação entre quem avalia. */
const ESCALA = [
  { v: 1, l: 'Raramente' },
  { v: 2, l: 'Às vezes' },
  { v: 3, l: 'Quase sempre' },
  { v: 4, l: 'Sempre' },
]

export function ResponderClient({ orgSlug, q }: { orgSlug: string; q: Questionario }) {
  const router = useRouter()
  const [notas, setNotas] = useState<Record<string, number | null>>({})
  const [coments, setComents] = useState<Record<string, string>>({})
  const [abrirComent, setAbrirComent] = useState<Set<string>>(new Set())
  const [saving, start] = useTransition()

  const auto = q.relacao === 'auto'
  const alvo = auto ? 'você' : q.avaliado.split(' ')[0]
  const respondidas = q.competencias.filter(c => notas[c.id] !== undefined).length
  const faltam = q.competencias.length - respondidas

  function enviar() {
    if (faltam > 0) {
      toast.error(`Faltam ${faltam} de ${q.competencias.length}. Use "Não observei" quando não tiver base.`)
      return
    }
    start(async () => {
      const payload = q.competencias.map(c => ({
        competencia_id: c.id,
        nota: notas[c.id] ?? null,
        comentario: coments[c.id]?.trim() || null,
      }))
      const r = await responder(orgSlug, q.convite_id, payload)
      if (r?.error) toast.error(r.error)
      else {
        toast.success('Enviado. Obrigado!')
        router.push(`/${orgSlug}/avaliacao`)
      }
    })
  }

  return (
    <div className="p-6 max-w-2xl pb-28">
      <Link href={`/${orgSlug}/avaliacao`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>

      <h1 className="text-lg font-semibold text-gray-900">
        {auto ? 'Sua autoavaliação' : q.avaliado}
      </h1>
      <p className="text-gray-500 text-sm mt-0.5">{q.ciclo}{q.cargo && !auto && ` · ${q.cargo}`}</p>

      {/* Contrato de privacidade, dito ANTES de responder. */}
      <div className={`rounded-xl px-4 py-3 mt-4 text-[12.5px] flex items-start gap-2 ${
        q.identificado ? 'bg-amber-50 border border-amber-200 text-amber-900'
                       : 'bg-emerald-50 border border-emerald-200 text-emerald-900'}`}>
        {q.identificado ? <Eye className="w-4 h-4 mt-0.5 shrink-0" /> : <Lock className="w-4 h-4 mt-0.5 shrink-0" />}
        <span>
          {auto ? (
            <>Esta é sua autoavaliação — <b>seu nome aparece</b>, naturalmente. Ela é comparada com a
            média de quem trabalha com você; a diferença entre as duas é o que rende a boa conversa.</>
          ) : q.identificado ? (
            <><b>Seu nome aparece</b> para o RH e para o gestor de {alvo}. {alvo} vê o resultado, mas nunca quem disse o quê.</>
          ) : (
            <><b>Anônimo.</b> O sistema não grava quem respondeu — nem o RH nem {alvo} conseguem saber.
            Só a média entra no resultado, e apenas se houver respondentes suficientes.</>
          )}
        </span>
      </div>

      <p className="text-xs text-gray-400 mt-3 mb-5">
        Pense no último trimestre. Se não teve como observar algo, marque <b>Não observei</b> —
        chutar distorce a média mais do que deixar em branco.
      </p>

      <div className="space-y-3">
        {q.competencias.map((c, i) => {
          const nota = notas[c.id]
          const temComent = abrirComent.has(c.id)
          return (
            <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[11px] text-gray-400 tabular-nums">{i + 1}</span>
                <h3 className="text-sm font-medium text-gray-900">{c.titulo}</h3>
                {c.bloco === 'funcao' && (
                  <span className="text-[10px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">da função</span>
                )}
              </div>
              {c.descricao && <p className="text-[12px] text-gray-500 mb-3 ml-5">{c.descricao}</p>}

              <div className="ml-5 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {ESCALA.map(e => {
                  const on = nota === e.v
                  return (
                    <button key={e.v} onClick={() => setNotas(p => ({ ...p, [c.id]: e.v }))}
                      title={c.ancoras?.[String(e.v)] ?? undefined}
                      className={`px-2 py-2 rounded-xl text-xs font-medium border transition active:scale-[0.97] ${
                        on ? 'bg-orange-600 text-[#fff] border-orange-600'
                           : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
                      {e.l}
                    </button>
                  )
                })}
                <button onClick={() => setNotas(p => ({ ...p, [c.id]: null }))}
                  className={`px-2 py-2 rounded-xl text-xs font-medium border transition active:scale-[0.97] ${
                    nota === null && c.id in notas
                      ? 'bg-gray-700 text-[#fff] border-gray-700'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'}`}>
                  Não observei
                </button>
              </div>

              {/* Âncora da nota escolhida: o texto que dá sentido ao número. */}
              {nota != null && c.ancoras?.[String(nota)] && (
                <p className="ml-5 mt-2 text-[11.5px] text-gray-500 italic">“{c.ancoras[String(nota)]}”</p>
              )}

              <div className="ml-5 mt-2">
                {temComent ? (
                  <textarea value={coments[c.id] ?? ''} onChange={e => setComents(p => ({ ...p, [c.id]: e.target.value }))}
                    rows={2} autoFocus placeholder="Um exemplo concreto ajuda muito mais que um adjetivo."
                    className="w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                ) : (
                  <button onClick={() => setAbrirComent(p => new Set(p).add(c.id))}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-orange-600 transition">
                    <MessageSquarePlus className="w-3 h-3" /> comentar
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Barra fixa: o questionário é longo, o botão não pode ficar só no fim. */}
      <div className="fixed bottom-0 left-0 right-0 sm:left-[var(--sidebar-w,0)] bg-white/95 backdrop-blur border-t border-gray-200 px-6 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <span className="text-xs text-gray-500 tabular-nums flex-1">
            {respondidas} de {q.competencias.length} respondidas
          </span>
          <button onClick={enviar} disabled={saving || faltam > 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-40 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
