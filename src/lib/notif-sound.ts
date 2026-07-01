// Som de notificação (client). Toca um SFX curto quando chega notificação nova;
// respeita a preferência do usuário (localStorage) e falha em silêncio se o
// navegador bloquear autoplay.

const KEY = 'flow:notif-sound'
let audio: HTMLAudioElement | null = null

export function notifSoundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setNotifSoundEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
}

export function playNotifSound() {
  if (typeof window === 'undefined' || !notifSoundEnabled()) return
  try {
    if (!audio) { audio = new Audio('/sounds/notification.mp3'); audio.volume = 0.55 }
    audio.currentTime = 0
    void audio.play().catch(() => { /* autoplay bloqueado até haver interação */ })
  } catch { /* noop */ }
}
