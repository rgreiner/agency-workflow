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

export async function buscarCnpj(cnpj: string): Promise<{ data?: CnpjResult; error?: string }> {
  const d = digits(cnpj)
  if (d.length !== 14) return { error: 'CNPJ precisa de 14 dígitos' }
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { cache: 'no-store', headers: UA })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await r.json().catch(() => null)
    if (!r.ok || !j || !(j.razao_social || j.nome_fantasia)) return { error: 'CNPJ não encontrado' }
    return {
      data: {
        razao_social: j.razao_social ?? '',
        nome_fantasia: j.nome_fantasia ?? '',
        cep: fmtCep(j.cep ?? ''),
        logradouro: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' ').trim(),
        numero: j.numero ? String(j.numero) : '',
        complemento: j.complemento ?? '',
        bairro: j.bairro ?? '',
        cidade: j.municipio ?? '',
        uf: j.uf ?? '',
        telefone: j.ddd_telefone_1 ?? '',
        email: j.email ?? '',
        atividade: j.cnae_fiscal_descricao ?? '',
      },
    }
  } catch { return { error: 'Não foi possível buscar o CNPJ agora' } }
}
