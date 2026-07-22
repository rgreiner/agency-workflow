/**
 * Import do inventário de pontos (PDF do fornecedor, formato logycware) — só PARSE:
 * lê o PDF, extrai os pontos e a foto de cada um (WebP no volume), e devolve a PRÉVIA.
 * Nada é gravado no banco aqui — a tela confirma e chama a action de salvar.
 *
 * É Route Handler (não Server Action) porque o PDF passa de 1MB (Outdoor Cascavel = 32MB).
 * O KML do MyMaps é opcional e cruza as coordenadas faltantes por código.
 */
import { NextResponse } from 'next/server'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { parseLogycwareTexto, extrairFotos } from '@/lib/inventario/logycware'
import { coordsPorCodigoDeKml } from '@/lib/inventario/kml'

export const runtime = 'nodejs'
export const maxDuration = 120

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function POST(request: Request) {
  const user = await getUsuario()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const form = await request.formData()
  const veiculoId = String(form.get('veiculo_id') || '')
  const pdf = form.get('pdf')
  const kml = form.get('kml')
  if (!veiculoId) return NextResponse.json({ error: 'Veículo ausente' }, { status: 400 })
  if (!(pdf instanceof File)) return NextResponse.json({ error: 'PDF ausente' }, { status: 400 })
  if (pdf.size > 60 * 1024 * 1024) return NextResponse.json({ error: 'PDF muito grande (máx 60MB)' }, { status: 400 })

  // Acesso: só quem enxerga o veículo pela RLS pode importar pra ele.
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: veic } = await (supabase as any).from('veiculos').select('id, org_id').eq('id', veiculoId).maybeSingle()
  if (!veic) return NextResponse.json({ error: 'Veículo não encontrado' }, { status: 404 })

  const tmp = await mkdtemp(path.join(tmpdir(), 'inv-pdf-'))
  try {
    const pdfPath = path.join(tmp, 'in.pdf')
    await writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()))

    const { tipoGlobal, pontos } = await parseLogycwareTexto(pdfPath)
    if (pontos.length === 0) {
      return NextResponse.json({ error: 'Nenhum ponto reconhecido — o PDF não parece do formato esperado (logycware).' }, { status: 422 })
    }

    // KML opcional: preenche coordenadas que faltaram no PDF.
    if (kml instanceof File) {
      const coords = coordsPorCodigoDeKml(await kml.text())
      for (const p of pontos) {
        if (p.lat == null) {
          const c = coords.get(p.codigo.toUpperCase())
          if (c) { p.lat = c.lat; p.lng = c.lng }
        }
      }
    }

    // Fotos → WebP no volume: /uploads/inventario/<veiculo>/<codigo>.webp
    const outDir = path.join(uploadRoot(), 'inventario', veiculoId)
    const fotoMap = await extrairFotos(pdfPath, pontos, outDir)

    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host
    const urlBase = `${proto}://${host}/uploads/inventario/${veiculoId}`

    const preview = pontos.map(p => ({
      codigo: p.codigo, face: p.face, tipo_midia: p.tipo_midia,
      cidade: p.cidade, bairro: p.bairro, logradouro: p.logradouro, numero: p.numero,
      referencia: p.referencia, endereco_full: p.endereco_full, lat: p.lat, lng: p.lng,
      foto_url: fotoMap.has(p.codigo) ? `${urlBase}/${fotoMap.get(p.codigo)}` : null,
    }))

    const comCoord = preview.filter(p => p.lat != null).length
    const comFoto = preview.filter(p => p.foto_url).length
    return NextResponse.json({ tipo: tipoGlobal, total: preview.length, comCoord, comFoto, pontos: preview })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao processar o PDF' }, { status: 500 })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
