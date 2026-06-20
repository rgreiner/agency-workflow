#!/usr/bin/env node
/**
 * Teste rápido da revisão de Redação pelo Gemini (AI Studio).
 *
 * Uso:
 *   node scripts/test-revisao.mjs                 # usa um texto de exemplo com erros
 *   node scripts/test-revisao.mjs "seu texto"     # revisa o texto passado
 *   npm run test:revisao -- "seu texto"
 *
 * Lê GEMINI_API_KEY (ou GOOGLE_GENAI_API_KEY) do .env.local ou do ambiente.
 * Espelha o prompt/schema de src/lib/ai/redacao-review.ts — serve só pra validar
 * a chave e ver a resposta do modelo antes de ligar a automação no fluxo.
 */

import { readFileSync } from 'node:fs'

// ── Carrega .env.local (node puro não carrega como o Next) ──────────────────
function loadEnvLocal() {
  try {
    const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const k = m[1]
      const v = m[2].replace(/^["']|["']$/g, '')
      if (process.env[k] === undefined) process.env[k] = v
    }
  } catch { /* sem .env.local — usa o ambiente */ }
}
loadEnvLocal()

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY
if (!apiKey) {
  console.error('\n❌ Falta a chave do Gemini.')
  console.error('   Adicione no .env.local (ou exporte no ambiente):')
  console.error('   GEMINI_API_KEY=AIza...\n')
  process.exit(1)
}

const model = process.env.REDACAO_REVIEW_MODEL_GEMINI || 'gemini-2.5-flash'

const SYSTEM_PROMPT = `Você é um revisor de português (pt-BR) de peças publicitárias.

Sua tarefa é apontar APENAS erros CLAROS e objetivos de língua:
- ortografia / acentuação
- gramática (regência, crase, colocação)
- concordância (verbal e nominal)
- pontuação que cause erro real

REGRAS IMPORTANTES (evitam falso positivo):
- NÃO sugira reescritas de estilo, NÃO mude o tom nem a voz do texto.
- NÃO marque gírias, informalidades, neologismos publicitários, nomes de marca,
  hashtags, CTAs ou escolhas estilísticas como erro — podem ser intencionais.
- Na dúvida entre "erro" e "escolha do redator", NÃO reporte.
- Quem decide o que é proposital é o redator; você só lista o que é erro evidente.

Para cada erro, informe: o trecho exato, o problema e a correção.
Se não houver nenhum erro claro, retorne a lista vazia.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    erros: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trecho: { type: 'string' },
          problema: { type: 'string' },
          sugestao: { type: 'string' },
          tipo: { type: 'string' },
        },
        required: ['trecho', 'problema', 'sugestao'],
      },
    },
  },
  required: ['erros'],
}

const SAMPLE = 'Nós vai aproveitar essa oportunidade unica pra você! Garanta já o seu, não perca essa chançe.'
const text = process.argv.slice(2).join(' ').trim() || SAMPLE

console.log(`\n🔎 Provider: gemini · modelo: ${model}`)
console.log('—'.repeat(60))
console.log(text)
console.log('—'.repeat(60))

const body = {
  systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
  contents: [{ role: 'user', parts: [{ text: `Revise o texto abaixo e liste os erros claros de português.\n\n--- INÍCIO DO TEXTO ---\n${text}\n--- FIM DO TEXTO ---` }] }],
  generationConfig: {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  },
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

console.log('\n→ Chamando o Gemini…')

const t0 = Date.now()
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 30000)
let res
try {
  res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
} catch (err) {
  clearTimeout(timer)
  console.error('\n❌ Não consegui falar com o Gemini:')
  console.error(`   ${err?.name === 'AbortError' ? 'Timeout (30s) — sem resposta.' : (err?.message || err)}`)
  console.error('   Dica: cheque conexão/proxy/VPN. A chamada vai pra generativelanguage.googleapis.com.\n')
  process.exit(1)
}
clearTimeout(timer)

if (!res.ok) {
  console.error(`\n❌ Gemini respondeu ${res.status}:`)
  console.error(await res.text().catch(() => res.statusText))
  console.error('\nDica: 400/403 costuma ser chave inválida ou API não habilitada na chave; 429 é cota.\n')
  process.exit(1)
}

const data = await res.json()
const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''

let erros = []
try {
  const parsed = JSON.parse(raw)
  erros = Array.isArray(parsed) ? parsed : (parsed.erros ?? parsed.errors ?? [])
} catch {
  console.error('\n⚠️  Não consegui parsear o JSON da resposta:')
  console.error(raw)
  process.exit(1)
}

const ms = Date.now() - t0
console.log(`\n✅ Chave OK — resposta em ${ms}ms`)

if (!erros.length) {
  console.log('\n✅ Nenhum erro encontrado (textos revisados).\n')
} else {
  console.log(`\n⚠️  ${erros.length} erro(s) encontrado(s):\n`)
  for (const e of erros) {
    const tipo = e.tipo ? `[${e.tipo}] ` : ''
    console.log(`  • ${tipo}"${e.trecho}"`)
    console.log(`     problema: ${e.problema}`)
    console.log(`     sugestão: ${e.sugestao}\n`)
  }
}
