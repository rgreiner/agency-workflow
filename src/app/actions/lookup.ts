'use server'

// Consultas públicas (sem chave) pra autopreencher cadastros:
// - CEP  → ViaCEP
// - CNPJ → BrasilAPI
// Rodam no servidor (sem CORS/CSP no cliente).

const digits = (s: string) => (s || '').replace(/\D/g, '')
const fmtCep = (c: string) => { const d = digits(c); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (c ?? '') }
// A BrasilAPI (atrás de Cloudflare) responde 403 ao fetch do servidor sem User-Agent
// de navegador. Mandamos um UA em todas as chamadas.
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Flow/1.0; +https://flow.oneaone.com.br)' }

export interface CepResult { logradouro: string; bairro: string; cidade: string; uf: string }

export async function buscarCep(cep: string): Promise<{ data?: CepResult; error?: string }> {
  const d = digits(cep)
  if (d.length !== 8) return { error: 'CEP precisa de 8 dígitos' }
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { cache: 'no-store', headers: UA })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await r.json().catch(() => null)
    if (!r.ok || !j || j.erro) return { error: 'CEP não encontrado' }
    return { data: { logradouro: j.logradouro ?? '', bairro: j.bairro ?? '', cidade: j.localidade ?? '', uf: j.uf ?? '' } }
  } catch { return { error: 'Não foi possível buscar o CEP agora' } }
}

export interface CnpjResult {
  razao_social: string; nome_fantasia: string; cep: string; logradouro: string; numero: string
  complemento: string; bairro: string; cidade: string; uf: string; telefone: string; email: string; atividade: string
}

/**
 * Busca em CASCATA, porque provedor de CNPJ cai.
 *
 * Medido do VPS em 01/10/2026, enquanto o Rafael cadastrava um cliente à mão:
 * BrasilAPI devolvia 504 e minhareceita.org 503 — as duas fontes que o Flow
 * tinha. `publica.cnpj.ws` e `open.cnpja.com` responderam 200 em ~0,3s. Uma
 * fonte só significa ficar sem autofill quando ela estiver fora, e aí a pessoa
 * digita endereço errado na mão.
 *
 * Tempo curto por provedor de propósito: esperar 10s por um que está fora é
 * pior que ir para o próximo. Primeiro que responder, ganha.
 */
const PROVEDORES: { nome: string; url: (d: string) => string; mapeia: (j: UnknownRecord) => CnpjResult | null }[] = [
  {
    nome: 'brasilapi',
    url: d => `https://brasilapi.com.br/api/cnpj/v1/${d}`,
    mapeia: j => !(j.razao_social || j.nome_fantasia) ? null : ({
      razao_social: texto(j.razao_social),
      nome_fantasia: texto(j.nome_fantasia),
      cep: fmtCep(texto(j.cep)),
      logradouro: [texto(j.descricao_tipo_de_logradouro), texto(j.logradouro)].filter(Boolean).join(' ').trim(),
      numero: texto(j.numero),
      complemento: texto(j.complemento),
      bairro: texto(j.bairro),
      cidade: texto(j.municipio),
      uf: texto(j.uf),
      telefone: texto(j.ddd_telefone_1),
      email: texto(j.email),
      atividade: texto(j.cnae_fiscal_descricao),
    }),
  },
  {
    nome: 'cnpj.ws',
    url: d => `https://publica.cnpj.ws/cnpj/${d}`,
    mapeia: j => {
      const e = (j.estabelecimento ?? {}) as UnknownRecord
      if (!j.razao_social && !e.nome_fantasia) return null
      const ddd = texto(e.ddd1), tel = texto(e.telefone1)
      return {
        razao_social: texto(j.razao_social),
        nome_fantasia: texto(e.nome_fantasia),
        cep: fmtCep(texto(e.cep)),
        logradouro: [texto(e.tipo_logradouro), texto(e.logradouro)].filter(Boolean).join(' ').trim(),
        numero: texto(e.numero),
        complemento: texto(e.complemento),
        bairro: texto(e.bairro),
        cidade: texto((e.cidade as UnknownRecord | undefined)?.nome),
        uf: texto((e.estado as UnknownRecord | undefined)?.sigla),
        telefone: ddd && tel ? `${ddd}${tel}` : tel,
        email: texto(e.email),
        atividade: texto((e.atividade_principal as UnknownRecord | undefined)?.descricao),
      }
    },
  },
  {
    nome: 'cnpja',
    url: d => `https://open.cnpja.com/office/${d}`,
    mapeia: j => {
      const comp = (j.company ?? {}) as UnknownRecord
      const end = (j.address ?? {}) as UnknownRecord
      if (!comp.name && !j.alias) return null
      const fone = ((j.phones ?? []) as UnknownRecord[])[0]
      return {
        razao_social: texto(comp.name),
        nome_fantasia: texto(j.alias),
        cep: fmtCep(texto(end.zip)),
        logradouro: texto(end.street),
        numero: texto(end.number),
        complemento: texto(end.details),
        bairro: texto(end.district),
        cidade: texto(end.city),
        uf: texto(end.state),
        telefone: fone ? `${texto(fone.area)}${texto(fone.number)}` : '',
        email: texto(((j.emails ?? []) as UnknownRecord[])[0]?.address),
        atividade: texto((j.mainActivity as UnknownRecord | undefined)?.text),
      }
    },
  },
]

type UnknownRecord = Record<string, unknown>
const texto = (v: unknown) => (v == null ? '' : String(v))

export async function buscarCnpj(cnpj: string): Promise<{ data?: CnpjResult; error?: string }> {
  const d = digits(cnpj)
  if (d.length !== 14) return { error: 'CNPJ precisa de 14 dígitos' }

  const foraDoAr: string[] = []
  for (const p of PROVEDORES) {
    try {
      const r = await fetch(p.url(d), { cache: 'no-store', headers: UA, signal: AbortSignal.timeout(7000) })
      // 404 é resposta: o CNPJ não existe nessa base. Não adianta tentar as outras
      // com a mesma pergunta — mas 5xx/429 é a base fora, aí vale a próxima.
      if (r.status === 404) return { error: 'CNPJ não encontrado' }
      if (!r.ok) { foraDoAr.push(p.nome); continue }
      const j = (await r.json().catch(() => null)) as UnknownRecord | null
      const dados = j ? p.mapeia(j) : null
      if (dados) return { data: dados }
      foraDoAr.push(p.nome)
    } catch {
      foraDoAr.push(p.nome)   // timeout, DNS, TLS
    }
  }
  return {
    error: foraDoAr.length === PROVEDORES.length
      ? 'As consultas de CNPJ estão fora do ar agora. Preencha à mão e tente de novo depois.'
      : 'CNPJ não encontrado',
  }
}
