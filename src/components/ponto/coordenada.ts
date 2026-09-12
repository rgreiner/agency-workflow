/**
 * Coordenada do aparelho para a batida do ponto. NUNCA trava: se a pessoa
 * negar, o navegador não suportar ou o GPS demorar, resolve com null e o
 * servidor decide pelo IP (a cascata da mig. 227: IP da rede → coordenada no
 * raio → fora).
 *
 * Vale para as QUATRO formas de bater (tela do ponto, card da home, lembrete e
 * trava). Enquanto só a tela do ponto mandava coordenada, o degrau geográfico
 * ficava morto — medido em 11/09/2026: 3 de 794 marcações tinham coordenada e
 * 182 caíram como "fora" em 60 dias, quase todas de gente NO escritório nos
 * dias em que o IP público mudou.
 */
export async function coordenadaDaBatida(): Promise<{ lat: number | null; lon: number | null }> {
  const vazio = { lat: null, lon: null }
  if (typeof navigator === 'undefined' || !navigator.geolocation) return vazio
  // Permissão já negada: não adianta esperar o timeout de 6s pra receber null.
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    if (p?.state === 'denied') return vazio
  } catch { /* navegador sem permissions.query para geolocation */ }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(vazio),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    )
  })
}
