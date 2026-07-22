// Cruza as coordenadas do KML do Google MyMaps por CÓDIGO — usado só pra preencher
// o que faltou no PDF. O nome do placemark começa com o código, ex.:
//   <name>0050A/B - BR 277 / Ferropar</name>  → 0050A e 0050B
//   <name>0060A - Br-277, 83727</name>         → 0060A
// coordinates vêm como "lng,lat,alt".

/** Expande "0050A/B" em ['0050A','0050B'] (o "/B" herda o radical do 1º). */
function expandirCodigos(token: string): string[] {
  const partes = token.split('/').map(s => s.trim()).filter(Boolean)
  if (partes.length === 0) return []
  const first = partes[0]
  const radical = first.replace(/(\(\d+\)|[A-Z]+)$/i, '')   // "0050A" → "0050"
  const out = [first]
  for (const p of partes.slice(1)) {
    // "B" (só sufixo) herda o radical; senão é um código próprio
    out.push(/^(\(\d+\)|[A-Za-z]+)$/.test(p) ? radical + p : p)
  }
  return out
}

export function coordsPorCodigoDeKml(kml: string): Map<string, { lat: number; lng: number }> {
  const mapa = new Map<string, { lat: number; lng: number }>()
  const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? []
  for (const pm of placemarks) {
    const nome = (pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()
    const coord = pm.match(/<coordinates>\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/)
    if (!nome || !coord) continue
    const lng = Number(coord[1]), lat = Number(coord[2])
    // pega o token de código no começo do nome (antes de " - " ou espaço)
    const token = (nome.split(/\s-\s|\s{2,}/)[0] ?? '').trim()
    if (!/^[A-Z0-9()/]{3,}$/i.test(token)) continue
    for (const c of expandirCodigos(token)) mapa.set(c.toUpperCase(), { lat, lng })
  }
  return mapa
}
