// Ficha de admissão: UMA definição para o formulário do candidato, a
// conferência do RH e o PDF da contabilidade. Mudou um campo aqui, mudou nos
// três — foi o que evitou, no ponto, a terceira cópia da mesma régua.
//
// Os campos espelham a "FICHA DE ADMISSÃO" que a contabilidade já recebe.
// Dados da contratação (cargo, salário, jornada) e benefícios da empresa não
// entram: vêm da proposta, não do candidato.

export type TipoCampo = 'texto' | 'data' | 'select' | 'email' | 'tel' | 'cpf' | 'cep' | 'numero'

export interface CampoFicha {
  k: string
  label: string
  tipo?: TipoCampo
  opcoes?: string[]
  /** Largura na grade de 6 colunas (padrão 3 = meia linha). */
  col?: 2 | 3 | 4 | 6
  obrigatorio?: boolean
  dica?: string
}
export interface SecaoFicha { id: string; titulo: string; descricao?: string; campos: CampoFicha[] }

export const SECOES_FICHA: SecaoFicha[] = [
  {
    id: 'pessoais', titulo: 'Dados pessoais',
    campos: [
      { k: 'nascimento', label: 'Data de nascimento', tipo: 'data', obrigatorio: true },
      { k: 'sexo', label: 'Sexo', tipo: 'select', opcoes: ['Feminino', 'Masculino', 'Outro'] },
      { k: 'estado_civil', label: 'Estado civil', tipo: 'select',
        opcoes: ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'] },
      { k: 'etnia', label: 'Declaração étnico-racial', tipo: 'select',
        opcoes: ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Prefiro não informar'] },
      { k: 'mae', label: 'Nome da mãe', col: 6, obrigatorio: true },
      { k: 'pai', label: 'Nome do pai', col: 6 },
      { k: 'natural_cidade', label: 'Cidade onde nasceu', obrigatorio: true },
      { k: 'natural_uf', label: 'Estado (UF)', col: 2 },
    ],
  },
  {
    id: 'endereco', titulo: 'Endereço e contato',
    campos: [
      { k: 'cep', label: 'CEP', tipo: 'cep', col: 2, obrigatorio: true },
      { k: 'rua', label: 'Rua', col: 4, obrigatorio: true },
      { k: 'numero', label: 'Número', col: 2, obrigatorio: true },
      { k: 'complemento', label: 'Complemento', col: 2 },
      { k: 'bairro', label: 'Bairro', col: 2, obrigatorio: true },
      { k: 'cidade', label: 'Cidade', col: 4, obrigatorio: true },
      { k: 'uf', label: 'UF', col: 2, obrigatorio: true },
      { k: 'celular', label: 'Celular', tipo: 'tel', obrigatorio: true },
      { k: 'email', label: 'E-mail', tipo: 'email', obrigatorio: true },
      { k: 'tel_recados', label: 'Telefone para recados', tipo: 'tel' },
    ],
  },
  {
    id: 'escolaridade', titulo: 'Escolaridade',
    campos: [
      { k: 'nivel', label: 'Grau', tipo: 'select', col: 3,
        opcoes: ['Fundamental', 'Médio incompleto', 'Médio completo', 'Superior incompleto',
          'Superior completo', 'Pós-graduação'] },
      { k: 'curso', label: 'Curso', col: 3 },
    ],
  },
  {
    id: 'documentos', titulo: 'Documentação',
    descricao: 'O que a contabilidade precisa para o registro em carteira.',
    campos: [
      { k: 'cpf', label: 'CPF', tipo: 'cpf', obrigatorio: true },
      { k: 'rg', label: 'RG', obrigatorio: true },
      { k: 'rg_emissao', label: 'Emissão do RG', tipo: 'data' },
      { k: 'rg_orgao', label: 'Órgão / estado', dica: 'ex.: SESP-PR' },
      { k: 'pis', label: 'PIS / PASEP' },
      { k: 'ctps_digital', label: 'Carteira digital?', tipo: 'select', opcoes: ['Sim', 'Não'] },
      { k: 'ctps', label: 'CTPS (número)' },
      { k: 'ctps_serie', label: 'Série' },
      { k: 'titulo', label: 'Título de eleitor' },
      { k: 'titulo_zona', label: 'Zona', col: 2 },
      { k: 'titulo_secao', label: 'Seção', col: 2 },
      { k: 'reservista', label: 'Reservista', col: 2, dica: 'nº do certificado' },
      { k: 'cnh', label: 'CNH' },
      { k: 'cnh_cat', label: 'Categoria', col: 2 },
      { k: 'cnh_validade', label: 'Validade', tipo: 'data', col: 2 },
    ],
  },
  {
    id: 'pagamento', titulo: 'Pagamento do salário',
    descricao: 'A chave Pix precisa estar no seu nome.',
    campos: [
      { k: 'pix_tipo', label: 'Tipo da chave', tipo: 'select', col: 2, obrigatorio: true,
        opcoes: ['CPF', 'Celular', 'E-mail', 'Chave aleatória'] },
      { k: 'pix_chave', label: 'Chave Pix', col: 4, obrigatorio: true },
    ],
  },
]

/**
 * Agência e conta: o formulário parou de pedir (decisão do Rafael, 08/10 — o
 * salário sai por Pix). Fica aqui para EXIBIR o que já foi coletado de quem
 * preencheu antes; a ficha do RH e o PDF continuam mostrando.
 */
export const CAMPOS_BANCO_LEGADO: CampoFicha[] = [
  { k: 'banco', label: 'Banco' },
  { k: 'tipo', label: 'Tipo de conta' },
  { k: 'agencia', label: 'Agência', col: 2 },
  { k: 'conta', label: 'Conta (com dígito)', col: 4 },
]

/** Cônjuge e filhos ficam fora das seções porque filhos são uma lista. */
export const CAMPOS_CONJUGE: CampoFicha[] = [
  { k: 'nome', label: 'Nome do cônjuge', col: 6 },
  { k: 'nascimento', label: 'Data de nascimento', tipo: 'data' },
  { k: 'cpf', label: 'CPF', tipo: 'cpf' },
]
export const CAMPOS_FILHO: CampoFicha[] = [
  { k: 'nome', label: 'Nome', col: 6 },
  { k: 'nascimento', label: 'Nascimento', tipo: 'data' },
  { k: 'cpf', label: 'CPF', tipo: 'cpf' },
]

export interface FichaAdmissao {
  pessoais?: Record<string, string>
  endereco?: Record<string, string>
  escolaridade?: Record<string, string>
  documentos?: Record<string, string>
  pagamento?: Record<string, string>
  /** Legado: quem preencheu antes de a ficha pedir Pix (08/10). */
  banco?: Record<string, string>
  conjuge?: Record<string, string>
  filhos?: Record<string, string>[]
  observacao?: string
}

/** Campos obrigatórios ainda vazios — o que falta para o candidato enviar. */
export function faltando(f: FichaAdmissao): string[] {
  const out: string[] = []
  for (const s of SECOES_FICHA) {
    const vals = (f[s.id as keyof FichaAdmissao] ?? {}) as Record<string, string>
    for (const c of s.campos) {
      if (c.obrigatorio && !String(vals?.[c.k] ?? '').trim()) out.push(`${s.titulo}: ${c.label}`)
    }
  }
  return out
}

/** Quantos campos preenchidos sobre o total — a barra de progresso da ficha. */
export function progresso(f: FichaAdmissao): { feitos: number; total: number } {
  let feitos = 0, total = 0
  for (const s of SECOES_FICHA) {
    const vals = (f[s.id as keyof FichaAdmissao] ?? {}) as Record<string, string>
    for (const c of s.campos) {
      total++
      if (String(vals?.[c.k] ?? '').trim()) feitos++
    }
  }
  return { feitos, total }
}
