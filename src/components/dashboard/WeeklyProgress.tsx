'use client'

import { useEffect, useState } from 'react'
import { Trophy, Flame, Target, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  done: number
  total: number
  overdue: number
  myActiveCount: number
  userName: string
}

function getMotivation(done: number, total: number, overdue: number, myActiveCount: number) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  if (myActiveCount === 0 && done === 0) {
    return {
      icon: Target,
      color: 'text-gray-500',
      bg: 'bg-gray-50',
      bar: 'bg-gray-300',
      msg: 'Você não tem tarefas alocadas no momento.',
      sub: 'Aproveite para ajudar o time ou planejar a próxima semana.',
    }
  }
  if (myActiveCount === 0) {
    return {
      icon: Trophy,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
      bar: 'bg-yellow-400',
      msg: '🏆 Semana concluída! Missão cumprida.',
      sub: `Você finalizou ${done} tarefa${done !== 1 ? 's' : ''} essa semana. Parabéns!`,
    }
  }
  if (overdue === 0 && pct >= 66) {
    return {
      icon: Flame,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      bar: 'bg-indigo-500',
      msg: 'Você está voando! Quase lá.',
      sub: `${done} de ${total} tarefa${total !== 1 ? 's' : ''} concluída${done !== 1 ? 's' : ''} — mantenha o ritmo.`,
    }
  }
  if (overdue === 0) {
    return {
      icon: Target,
      color: 'text-green-600',
      bg: 'bg-green-50',
      bar: 'bg-green-500',
      msg: '✅ Tudo sob controle por aqui.',
      sub: `${done} de ${total} concluída${done !== 1 ? 's' : ''}. Sem atrasos — ótimo trabalho!`,
    }
  }
  if (overdue <= 2) {
    return {
      icon: Zap,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      bar: 'bg-orange-400',
      msg: `⚡ Atenção: ${overdue} tarefa${overdue !== 1 ? 's' : ''} atrasada${overdue !== 1 ? 's' : ''}.`,
      sub: 'Priorize as pendentes e você vira o jogo hoje.',
    }
  }
  return {
    icon: Zap,
    color: 'text-red-600',
    bg: 'bg-red-50',
    bar: 'bg-red-500',
    msg: `💪 Dia intenso! ${overdue} tarefas atrasadas.`,
    sub: 'Foque nas mais urgentes primeiro — uma de cada vez.',
  }
}

function greeting(name: string) {
  const h = new Date().getHours()
  const period = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
  const firstName = name.split(' ')[0]
  return `${period}, ${firstName}!`
}

function todayLabel() {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  })
}

export function WeeklyProgress({ done, total, overdue, myActiveCount, userName }: Props) {
  const [width, setWidth] = useState(0)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const m = getMotivation(done, total, overdue, myActiveCount)
  const Icon = m.icon

  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), 120)
    return () => clearTimeout(t)
  }, [pct])

  return (
    <div className={cn('rounded-2xl border p-6 mb-6', m.bg, 'border-transparent')}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{greeting(userName)}</h2>
          <p className="text-sm text-gray-500 capitalize mt-0.5">{todayLabel()}</p>
        </div>
        <div className={cn('p-2.5 rounded-xl', m.bg)}>
          <Icon className={cn('w-6 h-6', m.color)} />
        </div>
      </div>

      <p className="text-base font-semibold text-gray-800 mb-0.5">{m.msg}</p>
      <p className="text-sm text-gray-500 mb-4">{m.sub}</p>

      {total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>{done} concluída{done !== 1 ? 's' : ''} essa semana</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2.5 bg-white/60 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-700 ease-out', m.bar)}
              style={{ width: `${width}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
