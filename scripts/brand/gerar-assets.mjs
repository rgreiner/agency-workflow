#!/usr/bin/env node
/**
 * Gera todos os ícones e a imagem de compartilhamento do Flow a partir da
 * identidade em brand/ (formatos e motivos em brand/README.md).
 *
 *   npm run brand:gerar
 *
 * Fontes (não são servidas, só lidas aqui):
 *   brand/flow-icone.png  quadrado arredondado (#0f0f0f) sobre preto puro, sem alfa
 *   brand/flow-og.png     arte de compartilhamento 16:9 — vira 1200×630 (1,91:1)
 *
 * Saídas:
 *   src/app/favicon.ico            16/32/48 (ICO com PNG dentro) — /favicon.ico
 *   src/app/icon.png               512 arredondado, cantos transparentes — aba/Google
 *   src/app/apple-icon.png         180 full-bleed (o iOS aplica a máscara)
 *   src/app/opengraph-image.jpg    1200×630, < 300 KB (limite do WhatsApp)
 *   public/icons/icon-{192,512}.png       manifest purpose "any" + marca dentro do app
 *   public/icons/maskable-{192,512}.png   manifest purpose "maskable" (zona segura 80%)
 *   public/icons/apple-touch-icon.png     180 full-bleed (cópia p/ quem pede /icons)
 *   public/icons/mark-96.png              marca pequena (e-mail, listas)
 *   public/icons/badge-96.png             silhueta branca do F (badge de push no Android)
 *
 * Tudo é medido no próprio PNG (limites do quadrado, raio do canto, cor de
 * fundo, extensão da arte) — trocar a fonte por outra versão da identidade e
 * rodar de novo basta, sem número mágico.
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC_ICONE = path.join(ROOT, 'brand/flow-icone.png')
const SRC_OG = path.join(ROOT, 'brand/flow-og.png')
const OUT_APP = path.join(ROOT, 'src/app')
const OUT_ICONS = path.join(ROOT, 'public/icons')

/** Limite de bytes pra imagem OG: acima disso o WhatsApp deixa de mostrar o preview grande. */
const OG_MAX_BYTES = 300 * 1024

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const hex = (r, g, b) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')

async function salvar(arquivo, buf) {
  await mkdir(path.dirname(arquivo), { recursive: true })
  await writeFile(arquivo, buf)
  console.log(`  ${path.relative(ROOT, arquivo).padEnd(38)} ${(buf.length / 1024).toFixed(1).padStart(7)} KB`)
}

/** Mede o quadrado arredondado dentro do PNG fonte (fora dele é preto puro). */
async function medirQuadrado() {
  const { data, info } = await sharp(SRC_ICONE).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const maxCh = (x, y) => {
    const i = (y * W + x) * C
    return Math.max(data[i], data[i + 1], data[i + 2])
  }
  const LIT = 8 // metade do charcoal (~15): onde o quadrado começa
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2)
  let left = 0, right = W - 1, top = 0, bottom = H - 1
  while (left < W && maxCh(left, cy) < LIT) left++
  while (right > 0 && maxCh(right, cy) < LIT) right--
  while (top < H && maxCh(cx, top) < LIT) top++
  while (bottom > 0 && maxCh(cx, bottom) < LIT) bottom--
  const side = Math.min(right - left, bottom - top) + 1

  // Raio do canto: na diagonal a partir do canto do quadrado, a borda do arco
  // fica a r·(1 − 1/√2) do canto em cada eixo.
  let d = 0
  while (d < side / 2 && maxCh(left + d, top + d) < LIT) d++
  const radius = Math.round(d / (1 - Math.SQRT1_2))

  // Cor de fundo do quadrado: mediana de amostras longe da arte.
  const amostras = [
    [0.5, 0.12], [0.12, 0.5], [0.88, 0.85], [0.5, 0.94], [0.15, 0.15], [0.85, 0.15],
  ].map(([fx, fy]) => {
    const i = ((top + Math.floor(side * fy)) * W + left + Math.floor(side * fx)) * C
    return [data[i], data[i + 1], data[i + 2]]
  })
  const mediana = (k) => amostras.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(amostras.length / 2)]
  // Fundo neutro: o PNG gerado tem ruído de ±2 por canal; a mediana das três
  // medianas vira o cinza exato que o resto usa (manifest, maskable, achatamento).
  const cinza = [mediana(0), mediana(1), mediana(2)].sort((a, b) => a - b)[1]
  const bg = [cinza, cinza, cinza]

  // Extensão da arte (F + onda) a partir do centro, em fração da meia-lateral —
  // define quanto o maskable precisa encolher pra caber na zona segura (80%).
  const half = side / 2
  let rmax = 0
  for (let y = top; y <= top + side - 1; y += 2) {
    for (let x = left; x <= left + side - 1; x += 2) {
      if (maxCh(x, y) >= 60) {
        const dist = Math.hypot(x - (left + half), y - (top + half))
        if (dist > rmax) rmax = dist
      }
    }
  }
  return { left, top, side, radius, bg, arteFrac: rmax / half }
}

/** ICO com entradas PNG (formato aceito por todo navegador atual). */
function montarIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = header.length + dir.length
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(buf.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += buf.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)])
}

const png = (s) => s.png({ compressionLevel: 9, adaptiveFiltering: true })

async function main() {
  const q = await medirQuadrado()
  const bgHex = hex(...q.bg)
  console.log(`Quadrado: ${q.side}px a partir de (${q.left},${q.top}) · raio ${q.radius}px (${(q.radius / q.side * 100).toFixed(1)}%) · fundo ${bgHex} · arte até ${(q.arteFrac * 100).toFixed(0)}% do raio`)

  // Recorte full-bleed do quadrado (sem alfa) — base de tudo. O fundo da fonte
  // tem ruído de ±3 por canal (invisível, mas o PNG não comprime): todo pixel a
  // até 4/255 do cinza medido vira o cinza exato — o ícone 512 cai de ~200 KB
  // pra uma fração disso sem mudar nada que se enxergue.
  const cheio = await (async () => {
    const { data, info } = await sharp(SRC_ICONE)
      .removeAlpha()
      .extract({ left: q.left, top: q.top, width: q.side, height: q.side })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const TOL = 4
    for (let i = 0; i < data.length; i += info.channels) {
      if (Math.abs(data[i] - q.bg[0]) <= TOL && Math.abs(data[i + 1] - q.bg[1]) <= TOL && Math.abs(data[i + 2] - q.bg[2]) <= TOL) {
        data[i] = q.bg[0]; data[i + 1] = q.bg[1]; data[i + 2] = q.bg[2]
      }
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer()
  })()

  // Versão arredondada: máscara geométrica com o raio medido → cantos transparentes.
  const mascara = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${q.side}" height="${q.side}"><rect width="${q.side}" height="${q.side}" rx="${q.radius}" ry="${q.radius}" fill="#fff"/></svg>`,
  )
  const arredondado = await sharp(cheio).ensureAlpha().composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer()

  console.log('\nsrc/app (convenção de arquivos do Next):')
  const ico = await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await png(sharp(arredondado).resize(size, size)).toBuffer() })))
  await salvar(path.join(OUT_APP, 'favicon.ico'), montarIco(ico))
  const icon512 = await png(sharp(arredondado).resize(512, 512)).toBuffer()
  await salvar(path.join(OUT_APP, 'icon.png'), icon512)
  const apple180 = await png(sharp(cheio).resize(180, 180)).toBuffer()
  await salvar(path.join(OUT_APP, 'apple-icon.png'), apple180)

  // OG: 1,91:1 por recorte central do 16:9; JPEG porque o WhatsApp corta o
  // preview grande acima de ~300 KB (PNG desse fundo passaria de 1 MB).
  let quality = 84
  let og
  do {
    og = await sharp(SRC_OG)
      .resize(1200, 630, { fit: 'cover', position: 'centre' })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer()
    quality -= 4
  } while (og.length > OG_MAX_BYTES && quality >= 60)
  await salvar(path.join(OUT_APP, 'opengraph-image.jpg'), og)
  console.log(`  (qualidade JPEG ${quality + 4})`)

  console.log('\npublic/icons:')
  await salvar(path.join(OUT_ICONS, 'icon-512.png'), icon512)
  await salvar(path.join(OUT_ICONS, 'icon-192.png'), await png(sharp(arredondado).resize(192, 192)).toBuffer())
  await salvar(path.join(OUT_ICONS, 'mark-96.png'), await png(sharp(arredondado).resize(96, 96)).toBuffer())
  await salvar(path.join(OUT_ICONS, 'apple-touch-icon.png'), apple180)

  // Maskable: zona segura é o círculo de 80% do canvas. A arte encolhe até o
  // ponto mais distante do centro caber nesse círculo (com 1,5% de folga).
  const escala = Math.min(1, (0.8 / q.arteFrac) * 0.985)
  for (const size of [512, 192]) {
    const arte = Math.round(size * escala)
    const buf = await png(
      sharp({ create: { width: size, height: size, channels: 3, background: bgHex } })
        .composite([{ input: await sharp(cheio).resize(arte, arte).toBuffer(), gravity: 'centre' }]),
    ).toBuffer()
    await salvar(path.join(OUT_ICONS, `maskable-${size}.png`), buf)
  }
  console.log(`  (arte do maskable em ${(escala * 100).toFixed(0)}% do canvas)`)

  // Badge de push (Android pinta a silhueta pelo alfa): só o F branco, sem a onda.
  {
    const { data, info } = await sharp(cheio).raw().toBuffer({ resolveWithObject: true })
    const out = Buffer.alloc(info.width * info.height * 4)
    for (let i = 0, o = 0; i < data.length; i += info.channels, o += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const branco = r - b < 60 && g - b < 60 // exclui o laranja da onda
      const a = branco ? clamp01((Math.min(r, g, b) - 40) / 160) : 0
      out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = Math.round(a * 255)
    }
    const f = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ threshold: 10 })
      .resize(76, 76, { fit: 'inside' })
      .png()
      .toBuffer()
    const m = await sharp(f).metadata()
    const badge = await png(
      sharp(f).extend({
        top: Math.floor((96 - m.height) / 2), bottom: Math.ceil((96 - m.height) / 2),
        left: Math.floor((96 - m.width) / 2), right: Math.ceil((96 - m.width) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      }),
    ).toBuffer()
    await salvar(path.join(OUT_ICONS, 'badge-96.png'), badge)
  }

  console.log(`\nCores medidas: fundo do ícone ${bgHex} (use em background_color do manifest).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
