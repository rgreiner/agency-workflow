// Dados/textos PADRÃO dos documentos. Servem de default: a org pode sobrescrever
// em Configurações → Documentos (org_settings), lido por loadOrgDocs abaixo.

export const AGENCY = {
  nome: 'One a One Comunicação e Estratégia',
  razao: 'Amexcom Publicidade Ltda',
  endereco: 'Rua Voluntários da Pátria, nº 1415, Sl 103 - Centro - Cascavel/PR - CEP: 85812-160',
  cnpjFone: 'CNPJ: 17.531.601/0001-23  Fone: (45) 3225-4443',
  cidade: 'Cascavel/PR',
}

// Texto legal padrão da PRODUÇÃO (Pedido de Produção, Orçamento) — instruções de NF.
export const DOC_NF_NOTES = [
  { text: 'Enviar NF com valor total para o e-mail financeiro@oneaone.com.br', highlight: true },
  { text: 'Enviar NF com prazo mínimo de 30 dias úteis para o vencimento', highlight: false },
  { text: 'Colocar número desta autorização na NF', highlight: true },
]

// Texto legal padrão da MÍDIA (autorizações). Renderizado sob "Observações sobre faturamento".
export const DOC_MIDIA_NOTES = [
  { text: 'O faturamento deve obrigatoriamente seguir as informações fiéis desta autorização;', highlight: false },
  { text: 'Enviar NF com valor total para o e-mail financeiro@oneaone.com.br (o faturamento só é pago mediante envio para este e-mail, caso contrário o pagamento não será efetuado);', highlight: true },
  { text: 'Colocar número desta autorização na NF na descrição do serviço/produto;', highlight: false },
  { text: 'Enviar NF com prazo mínimo de 30 dias úteis para o vencimento.', highlight: false },
]

export interface AgencyInfo { nome: string; razao: string; endereco: string; cnpjFone: string; cidade: string }
export interface DocNote { text: string; highlight: boolean }
export interface OrgDocs { agency: AgencyInfo; nfNotes: DocNote[]; midiaNotes: DocNote[] }

/**
 * Config efetiva de documentos da org: usa o que estiver salvo em org_settings,
 * caindo nos padrões acima quando ausente. Reusado pelas telas de impressão.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadOrgDocs(supabase: any, orgId: string): Promise<OrgDocs> {
  const { data } = await supabase.from('org_settings')
    .select('agency_info, doc_nf_notes, doc_midia_notes').eq('org_id', orgId).maybeSingle()
  const nf = data?.doc_nf_notes, midia = data?.doc_midia_notes
  return {
    agency: { ...AGENCY, ...(data?.agency_info ?? {}) },
    nfNotes:    Array.isArray(nf)    && nf.length    ? nf    : DOC_NF_NOTES,
    midiaNotes: Array.isArray(midia) && midia.length ? midia : DOC_MIDIA_NOTES,
  }
}

/** Texto legal padrão das autorizações de mídia (notas de faturamento), como texto. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function midiaTextoLegalPadrao(supabase: any, orgId: string): Promise<string> {
  const { midiaNotes } = await loadOrgDocs(supabase, orgId)
  return midiaNotes.map(n => n.text).join('\n')
}
