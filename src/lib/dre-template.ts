// Template da DRE (estrutura contábil vinda do Conta Azul, via anexo pivot.xlsx).
// Ordem importa: grupos (NN) → subgrupos (NN.N) → folhas (= categoria do lançamento)
// → totais (NNT, subtotal corrido). Sinal vem do tipo do lançamento (receita +,
// despesa −), então os totais são soma corrida das folhas acima.

export type DreLine =
  | { kind: 'grupo'; code: string; label: string }
  | { kind: 'sub'; code: string; label: string; grupo: string }
  | { kind: 'folha'; categoria: string; grupo: string; sub: string }
  | { kind: 'total'; code: string; label: string }

export const DRE_TEMPLATE: DreLine[] = [
  { kind: 'grupo', code: "01", label: "Receitas Operacionais" },
  { kind: 'sub', code: "01.1", label: "Receita de Vendas de Produtos e Serviços", grupo: "01" },
  { kind: 'folha', categoria: "Comissão", grupo: "01", sub: "01.1" },
  { kind: 'folha', categoria: "Fee", grupo: "01", sub: "01.1" },
  { kind: 'folha', categoria: "Job", grupo: "01", sub: "01.1" },
  { kind: 'folha', categoria: "Produção", grupo: "01", sub: "01.1" },
  { kind: 'sub', code: "01.2", label: "Receita de Fretes e Entregas", grupo: "01" },
  { kind: 'total', code: "01T", label: "Receita Bruta de Vendas" },
  { kind: 'grupo', code: "02", label: "Deduções da Receita Bruta" },
  { kind: 'sub', code: "02.1", label: "Impostos Sobre Vendas", grupo: "02" },
  { kind: 'folha', categoria: "Simples Nacional - DAS", grupo: "02", sub: "02.1" },
  { kind: 'sub', code: "02.2", label: "Comissões Sobre Vendas", grupo: "02" },
  { kind: 'sub', code: "02.3", label: "Descontos Incondicionais", grupo: "02" },
  { kind: 'sub', code: "02.4", label: "Devoluções de Vendas", grupo: "02" },
  { kind: 'total', code: "02T", label: "Receita Líquida de Vendas" },
  { kind: 'grupo', code: "03", label: "Custos Operacionais" },
  { kind: 'sub', code: "03.1", label: "Custo dos Produtos Vendidos", grupo: "03" },
  { kind: 'folha', categoria: "Custo dos produtos vendidos", grupo: "03", sub: "03.1" },
  { kind: 'sub', code: "03.2", label: "Custo das Vendas de Produtos", grupo: "03" },
  { kind: 'sub', code: "03.3", label: "Custo dos Serviços Prestados", grupo: "03" },
  { kind: 'total', code: "03T", label: "Lucro Bruto" },
  { kind: 'grupo', code: "04", label: "Despesas Operacionais" },
  { kind: 'sub', code: "04.1", label: "Despesas Comerciais", grupo: "04" },
  { kind: 'sub', code: "04.2", label: "Despesas Administrativas", grupo: "04" },
  { kind: 'folha', categoria: "Aluguel", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Alvará de Funcionamento", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Condomínio", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Darf - INSS e IRRF", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Energia Elétrica", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "FGTS", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Honorários Contábeis", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Limpeza", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Remuneração de Estagiários", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Remuneração Funcionários", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Supermercado", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Telefonia e Internet", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Telefonia Móvel", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Transporte Urbano (táxi, Uber)", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Vale Refeição", grupo: "04", sub: "04.2" },
  { kind: 'folha', categoria: "Vale-Transporte", grupo: "04", sub: "04.2" },
  { kind: 'sub', code: "04.3", label: "Despesas Operacionais", grupo: "04" },
  { kind: 'total', code: "04T", label: "Lucro / Prejuízo Operacional" },
  { kind: 'grupo', code: "05", label: "Receitas e Despesas Financeiras" },
  { kind: 'sub', code: "05.1", label: "Receitas e Rendimentos Financeiros", grupo: "05" },
  { kind: 'folha', categoria: "Rendimentos de Aplicações", grupo: "05", sub: "05.1" },
  { kind: 'sub', code: "05.2", label: "Despesas Financeiras", grupo: "05" },
  { kind: 'grupo', code: "06", label: "Outras Receitas e Despesas Não Operacionais" },
  { kind: 'sub', code: "06.1", label: "Outras Receitas Não Operacionais", grupo: "06" },
  { kind: 'sub', code: "06.2", label: "Outras Despesas Não Operacionais", grupo: "06" },
  { kind: 'folha', categoria: "Distribuição de Lucros", grupo: "06", sub: "06.2" },
  { kind: 'folha', categoria: "Quitação de Passivos", grupo: "06", sub: "06.2" },
  { kind: 'total', code: "06T", label: "Lucro / Prejuízo Líquido" },
  { kind: 'grupo', code: "07", label: "Despesas com Investimentos e Empréstimos" },
  { kind: 'sub', code: "07.1", label: "Investimentos em Imobilizado", grupo: "07" },
  { kind: 'folha', categoria: "Software / Licença de Uso", grupo: "07", sub: "07.1" },
  { kind: 'sub', code: "07.2", label: "Empréstimos e Dívidas", grupo: "07" },
  { kind: 'total', code: "07T", label: "Lucro / Prejuízo Final" },
]

// Categorias-folha conhecidas (p/ detectar lançamentos fora do template).
export const DRE_CATEGORIAS = new Set(DRE_TEMPLATE.filter(l => l.kind === 'folha').map(l => (l as { categoria: string }).categoria))

/** Código do grupo que recolhe o que não está na estrutura contábil. */
export const GRUPO_FORA = '99'

/**
 * Template + as categorias que APARECERAM no período e não estão na estrutura.
 *
 * O template é uma lista fixa; até aqui, lançamento com categoria fora dela não
 * entrava em nenhuma linha e simplesmente sumia do resultado, sem aviso. E não é
 * pouca coisa: medido em produção, 21 categorias ficavam de fora, entre elas
 * "Empréstimos de Bancos" (R$ 141,7 mil em 6 meses) e "Rendimentos" — que a
 * própria importação de OFX cria, enquanto o template só conhece "Rendimentos de
 * Aplicações". Agora elas aparecem num grupo próprio, e o resultado final passa
 * a incluir tudo. O erro fica visível em vez de desaparecer.
 *
 * `categorias` = todas as que vieram do banco (realizado + previsto).
 */
export function templateComExtras(categorias: Iterable<string>): DreLine[] {
  const extras = [...new Set(categorias)]
    .filter(c => c && !DRE_CATEGORIAS.has(c))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (extras.length === 0) return DRE_TEMPLATE

  return [
    ...DRE_TEMPLATE,
    { kind: 'grupo', code: GRUPO_FORA, label: 'Fora da estrutura contábil' },
    { kind: 'sub', code: '99.1', label: 'Categorias ainda não mapeadas na DRE', grupo: GRUPO_FORA },
    ...extras.map((categoria): DreLine => ({ kind: 'folha', categoria, grupo: GRUPO_FORA, sub: '99.1' })),
    { kind: 'total', code: '99T', label: 'Resultado final (com os não mapeados)' },
  ]
}
