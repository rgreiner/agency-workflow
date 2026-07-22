// Parser do inventário de pontos no formato "logycware" (PDF da Rede Outdoor e
// afins). Roda NO SERVIDOR: usa poppler (pdftotext/pdfimages, via aptPkgs no
// build) + sharp pra reencodar a foto de cada ponto em WebP.
//
// O layout é gerado por software, então é estável: por página vêm 1-2 blocos
// {endereço, [CÓDIGO], coordenadas} e as fotos são as imagens grandes (>1000px),
// na MESMA ordem dos códigos. Validado: 196 fotos ↔ 196 códigos nas 98 páginas.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const exec = promisify(execFile)

export interface PontoParsed {
  codigo: string
  face: string | null
  tipo_midia: string
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  referencia: string | null
  endereco_full: string | null
  lat: number | null
  lng: number | null
  page: number      // 1-based
  idx: number       // ordem da foto dentro da página (0-based)
}

const CODE_RE = /\[([A-Z0-9()]{3,})\]/
const COORD_RE = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/
const TIPO_RE = /Disponibilidade de Locais \(([^)]+)\)/

const clean = (s: string) => s.replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim()

/** Quebra a linha de endereço do fornecedor em partes (best-effort; a linha crua
 *  fica sempre em endereco_full, e a prévia é editável). */
function splitEndereco(raw: string): Pick<PontoParsed, 'cidade' | 'bairro' | 'logradouro' | 'numero' | 'referencia' | 'endereco_full'> {
  let s = clean(raw).replace(/^\*\s*/, '').replace(/-\s*$/, '').trim()  // tira "* " e o "-" final
  const endereco_full = s || null
  let cidade: string | null = null, bairro: string | null = null
  let logradouro: string | null = null, numero: string | null = null, referencia: string | null = null
  const dash = s.indexOf(' - ')
  if (dash >= 0) {
    const left = s.slice(0, dash).trim()
    const right = s.slice(dash + 3).trim()
    const lp = left.split(',').map(x => x.trim()).filter(Boolean)
    cidade = lp[0] ?? null
    bairro = lp.length > 1 ? lp.slice(1).join(', ') : null
    // right = "Logradouro, Numero refs"
    const comma = right.indexOf(',')
    if (comma >= 0) {
      logradouro = right.slice(0, comma).trim()
      const rest = right.slice(comma + 1).trim()
      const m = rest.match(/^(\d+)\s*(.*)$/)
      if (m) { numero = m[1]; referencia = m[2].trim() || null }
      else referencia = rest || null
    } else logradouro = right || null
  } else {
    cidade = s.split(',')[0]?.trim() || null
  }
  return { cidade, bairro, logradouro, numero, referencia, endereco_full }
}

function deriveFace(codigo: string): string | null {
  const m = codigo.match(/(\(\d+\)|[A-Z])$/)
  return m ? m[1] : null
}

/** Só o texto: lê o PDF e devolve os pontos (sem foto ainda). */
export async function parseLogycwareTexto(pdfPath: string): Promise<{ tipoGlobal: string; pontos: PontoParsed[] }> {
  const { stdout } = await exec('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 64 * 1024 * 1024 })
  const tipoGlobal = clean((TIPO_RE.exec(stdout)?.[1]) ?? '')
  const pages = stdout.split('\f')
  const pontos: PontoParsed[] = []

  pages.forEach((pageTxt, pi) => {
    const page = pi + 1
    let idx = 0
    let curEndereco: ReturnType<typeof splitEndereco> | null = null
    // Bloco = um local físico com 1..N faces (A/B). A coordenada e o endereço valem
    // pro bloco inteiro (as duas faces ficam no mesmo poste) — por isso a face B, que
    // vem sem endereço e às vezes depois da coordenada, herda do bloco.
    let bloco: PontoParsed[] = []
    let blocoCoord: { lat: number; lng: number } | null = null
    const flush = () => {
      if (blocoCoord) for (const p of bloco) { p.lat = blocoCoord.lat; p.lng = blocoCoord.lng }
      bloco = []; blocoCoord = null
    }
    for (const line of pageTxt.split('\n')) {
      const cm = CODE_RE.exec(line)
      if (cm) {
        const codigo = cm[1]
        if (codigo.toLowerCase() === 'codigo' || codigo.toLowerCase() === 'ponto') continue
        const before = line.slice(0, cm.index).trim()
        if (before) { flush(); curEndereco = splitEndereco(before) }   // novo bloco (tem endereço)
        const p: PontoParsed = {
          codigo, face: deriveFace(codigo), tipo_midia: tipoGlobal,
          cidade: curEndereco?.cidade ?? null, bairro: curEndereco?.bairro ?? null,
          logradouro: curEndereco?.logradouro ?? null, numero: curEndereco?.numero ?? null,
          referencia: curEndereco?.referencia ?? null, endereco_full: curEndereco?.endereco_full ?? null,
          lat: null, lng: null, page, idx,
        }
        pontos.push(p); bloco.push(p); idx++
      }
      const co = COORD_RE.exec(line)
      if (co && !blocoCoord) blocoCoord = { lat: Number(co[1]), lng: Number(co[2]) }
    }
    flush()
  })
  return { tipoGlobal, pontos }
}

/** Extrai a foto de cada ponto (poppler → JPEG → sharp WebP) e grava em outDir.
 *  Devolve mapa codigo → caminho relativo do arquivo escrito. */
export async function extrairFotos(
  pdfPath: string, pontos: PontoParsed[], outDir: string,
): Promise<Map<string, string>> {
  await mkdir(outDir, { recursive: true })
  const out = new Map<string, string>()
  const porPagina = new Map<number, PontoParsed[]>()
  for (const p of pontos) (porPagina.get(p.page) ?? porPagina.set(p.page, []).get(p.page)!).push(p)

  for (const [page, ps] of porPagina) {
    const tmp = await mkdtemp(path.join(tmpdir(), 'inv-'))
    try {
      await exec('pdfimages', ['-j', '-f', String(page), '-l', String(page), pdfPath, path.join(tmp, 'img')], { maxBuffer: 64 * 1024 * 1024 })
      // arquivos em ordem de extração (= ordem visual). Filtra as fotos grandes.
      const files = (await readdir(tmp)).filter(f => f.startsWith('img')).sort()
      const grandes: string[] = []
      for (const f of files) {
        try {
          const meta = await sharp(path.join(tmp, f)).metadata()
          if ((meta.width ?? 0) > 1000) grandes.push(path.join(tmp, f))
        } catch { /* .ppm/ícone que o sharp não lê: ignora */ }
      }
      for (const p of ps.sort((a, b) => a.idx - b.idx)) {
        const src = grandes[p.idx]
        if (!src) continue
        const nome = `${p.codigo.replace(/[^\w()-]/g, '_')}.webp`
        await sharp(src).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(outDir, nome))
        out.set(p.codigo, nome)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
  return out
}
