'use client'

import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { notifSoundEnabled, setNotifSoundEnabled, playNotifSound } from '@/lib/notif-sound'

/** Liga/desliga o som de notificação (preferência por navegador). */
export function NotifSoundToggle() {
  const [on, setOn] = useState(true)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(notifSoundEnabled())
  }, [])

  function toggle() {
    const next = !on
    setOn(next)
    setNotifSoundEnabled(next)
    if (next) playNotifSound() // prévia + destrava o autoplay (conta como interação)
  }

  return (
    <button
      onClick={toggle}
      title={on ? 'Som de notificação: ligado (clique p/ desligar)' : 'Som de notificação: desligado (clique p/ ligar)'}
      aria-pressed={on}
      className="inline-flex items-center justify-center p-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition"
    >
      {on ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
    </button>
  )
}
