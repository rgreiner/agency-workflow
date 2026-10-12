// Cálculo da DRE mensal — fonte única da tela (Gestão), do PDF e do Excel.
// Módulo puro: roda no client e no server.
import { templateComExtras, dentroDe, GRUPO_FORA, type DreLine, type DreConfig } from './dre-template'

export interface CatMesV { categoria: string; mes: string; v: number }
export interface DreLinhaCalc {
  line: DreLine
  /** Realizado e previsto por mês (YYYY-MM). */
  vr: Record<string, number>
  vp: Record<string, number>
  /** Está no grupo "Fora da estrutura contábil". */
  fora: boolean
}

function catMesMap(rows: CatMesV[]) {
  const m = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!m.has(r.categoria)) m.set(r.categoria, new Map())
    const inner = m.get(r.categoria)!
    inner.set(r.mes, (inner.get(r.mes) ?? 0) + Number(r.v))
  }
  return m
}

export const rotuloDre = (l: DreLine) =>
  l.kind === 'folha' ? l.categoria : l.kind === 'total' ? l.label : `${l.code} ${l.label}`

/**
 * Percorre a estrutura acumulando as folhas; totais (NNT) = soma corrida.
 * Devolve só o que tem valor em algum mês (grupos e totais sempre).
 */
export function calcularDre(meses: string[], real: CatMesV[], prev: CatMesV[], config?: DreConfig | null): DreLinhaCalc[] {
  const realMap = catMesMap(real)
  const prevMap = catMesMap(prev)
  const template = templateComExtras([...realMap.keys(), ...prevMap.keys()], config)
  const gv = (map: Map<string, Map<string, number>>, cat: string, m: string) => map.get(cat)?.get(m) ?? 0
  const folhasDe = (pred: (l: Extract<DreLine, { kind: 'folha' }>) => boolean) =>
    template.filter((l): l is Extract<DreLine, { kind: 'folha' }> => l.kind === 'folha' && pred(l))
  const soma = (fs: Extract<DreLine, { kind: 'folha' }>[], map: Map<string, Map<string, number>>, m: string) =>
    fs.reduce((s, l) => s + gv(map, l.categoria, m), 0)

  const accR: Record<string, number> = {}, accP: Record<string, number> = {}
  for (const m of meses) { accR[m] = 0; accP[m] = 0 }
  const linhas: DreLinhaCalc[] = []
  for (const line of template) {
    const vr: Record<string, number> = {}, vp: Record<string, number> = {}
    if (line.kind === 'folha') {
      for (const m of meses) { vr[m] = gv(realMap, line.categoria, m); vp[m] = gv(prevMap, line.categoria, m); accR[m] += vr[m]; accP[m] += vp[m] }
    } else if (line.kind === 'grupo' || line.kind === 'sub') {
      // Subgrupo soma também os que se abrem dentro dele (06.2 inclui 06.2.1).
      const fs = line.kind === 'grupo' ? folhasDe(l => l.grupo === line.code) : folhasDe(l => dentroDe(l.sub, line.code))
      for (const m of meses) { vr[m] = soma(fs, realMap, m); vp[m] = soma(fs, prevMap, m) }
    } else {
      for (const m of meses) { vr[m] = accR[m]; vp[m] = accP[m] }
    }
    const fora = line.kind === 'grupo' ? line.code === GRUPO_FORA
      : line.kind === 'total' ? line.code === '99T'
      : line.grupo === GRUPO_FORA
    linhas.push({ line, vr, vp, fora })
  }
  return linhas.filter(r =>
    r.line.kind === 'grupo' || r.line.kind === 'total' || meses.some(m => r.vr[m] !== 0 || r.vp[m] !== 0))
}
