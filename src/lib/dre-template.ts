// Estrutura da DRE (vinda do Conta Azul, via anexo pivot.xlsx).
//
// Três camadas: grupos (NN, fixos, cada um com o seu total corrido NNT) →
// subgrupos (NN.N, e NN.N.N quando um subgrupo se abre em outro) → folhas
// (= categoria do lançamento). O sinal vem do tipo do lançamento (receita +,
// despesa −), então os totais são soma corrida das folhas acima.
//
// O código traz o PADRÃO. A org pode acrescentar subgrupos e mover categorias
// pela tela Financeiro → Estrutura da DRE; isso fica em org_settings.dre_estrutura
// (mig. 340) como DIFERENÇA sobre o padrão — assim um ajuste no padrão continua
// valendo para o que a org não mexeu. Módulo puro: roda no client e no server.

export type DreLine =
  | { kind: 'grupo'; code: string; label: string }
  | { kind: 'sub'; code: string; label: string; grupo: string; custom?: boolean }
  | { kind: 'folha'; categoria: string; grupo: string; sub: string }
  | { kind: 'total'; code: string; label: string }

export interface DreGrupo { code: string; label: string; total?: string }
export interface DreSub { code: string; label: string; grupo: string }

/** O que a org mudou sobre o padrão. `mapa[categoria] = ''` tira a categoria da DRE. */
export interface DreConfig {
  subs?: DreSub[]
  mapa?: Record<string, string>
}

export const DRE_GRUPOS: DreGrupo[] = [
  { code: '01', label: 'Receitas Operacionais', total: 'Receita Bruta de Vendas' },
  { code: '02', label: 'Deduções da Receita Bruta', total: 'Receita Líquida de Vendas' },
  { code: '03', label: 'Custos Operacionais', total: 'Lucro Bruto' },
  { code: '04', label: 'Despesas Operacionais', total: 'Lucro / Prejuízo Operacional' },
  { code: '05', label: 'Receitas e Despesas Financeiras' },
  { code: '06', label: 'Outras Receitas e Despesas Não Operacionais', total: 'Lucro / Prejuízo Líquido' },
  { code: '07', label: 'Despesas com Investimentos e Empréstimos', total: 'Lucro / Prejuízo Final' },
]

export const DRE_SUBS_PADRAO: DreSub[] = [
  { code: '01.1', label: 'Receita de Vendas de Produtos e Serviços', grupo: '01' },
  { code: '01.2', label: 'Receita de Fretes e Entregas', grupo: '01' },
  { code: '02.1', label: 'Impostos Sobre Vendas', grupo: '02' },
  { code: '02.2', label: 'Comissões Sobre Vendas', grupo: '02' },
  { code: '02.3', label: 'Descontos Incondicionais', grupo: '02' },
  { code: '02.4', label: 'Devoluções de Vendas', grupo: '02' },
  { code: '03.1', label: 'Custo dos Produtos Vendidos', grupo: '03' },
  { code: '03.2', label: 'Custo das Vendas de Produtos', grupo: '03' },
  { code: '03.3', label: 'Custo dos Serviços Prestados', grupo: '03' },
  { code: '04.1', label: 'Despesas Comerciais', grupo: '04' },
  { code: '04.2', label: 'Despesas Administrativas', grupo: '04' },
  { code: '04.3', label: 'Despesas Operacionais', grupo: '04' },
  // Pessoal separado do administrativo (Rafael, 12/10/2026): misturada com
  // aluguel e energia, a folha — o maior custo da casa — não aparecia sozinha.
  { code: '04.4', label: 'Despesas com Pessoal', grupo: '04' },
  { code: '05.1', label: 'Receitas e Rendimentos Financeiros', grupo: '05' },
  { code: '05.2', label: 'Despesas Financeiras', grupo: '05' },
  { code: '06.1', label: 'Outras Receitas Não Operacionais', grupo: '06' },
  { code: '06.2', label: 'Outras Despesas Não Operacionais', grupo: '06' },
  // Desligamento fica fora do administrativo de propósito (Rafael, 12/10/2026):
  // a casa quer enxergar quanto custa uma saída, separado do custo de operar.
  { code: '06.2.1', label: 'Desligamentos', grupo: '06' },
  { code: '07.1', label: 'Investimentos em Imobilizado', grupo: '07' },
  { code: '07.2', label: 'Empréstimos e Dívidas', grupo: '07' },
]

/** Categoria → subgrupo, no padrão. A ordem aqui é a ordem das folhas na tabela. */
export const DRE_MAPA_PADRAO: Record<string, string> = {
  'Comissão': '01.1', 'Fee': '01.1', 'Job': '01.1', 'Produção': '01.1',
  'Receitas de Serviços': '01.1', 'Receitas de Vendas': '01.1',
  'Simples Nacional - DAS': '02.1',
  'Custo dos produtos vendidos': '03.1',
  'Marketing e Publicidade': '04.1',
  'Aluguel': '04.2', 'Alvará de Funcionamento': '04.2', 'Condomínio': '04.2',
  'Confraternizações': '04.2', 'Energia Elétrica': '04.2', 'Honorários Contábeis': '04.2',
  'Limpeza': '04.2', 'Manutenção de Equipamentos': '04.2', 'Manutenção Salas': '04.2',
  'Materiais de Limpeza e de Higiene': '04.2', 'Supermercado': '04.2',
  'Telefonia e Internet': '04.2', 'Telefonia Móvel': '04.2', 'Transporte Urbano (táxi, Uber)': '04.2',
  // Pessoal: salário, encargos, benefícios e quem é contratado por fora.
  // Free Lancer é fornecedor, mas é gente fazendo o trabalho da casa.
  'Remuneração Funcionários': '04.4', 'Remuneração de Estagiários': '04.4', 'Free Lancer': '04.4',
  'Gratificações': '04.4', 'Darf - INSS e IRRF': '04.4', 'FGTS': '04.4',
  'Vale Refeição': '04.4', 'Vale-Transporte': '04.4', 'Exames Demissionais e Admissionais': '04.4',
  // "Rendimentos" é o nome que a importação de OFX cria.
  'Rendimentos': '05.1', 'Rendimentos de Aplicações': '05.1',
  'Tarifas Bancárias': '05.2',
  'Distribuição de Lucros': '06.2', 'Quitação de Passivos': '06.2',
  'Multa FGTS': '06.2.1', 'Rescisões': '06.2.1',
  // Compra e venda do imobilizado juntas: o saldo é o investimento líquido.
  'Imobilizado': '07.1', 'Venda de Imobilizado': '07.1', 'Software / Licença de Uso': '07.1',
  'Empréstimos': '07.2', 'Empréstimos de Bancos': '07.2',
}

/** Código do grupo que recolhe o que não está na estrutura contábil. */
export const GRUPO_FORA = '99'

/** Ordem natural de códigos: 06.2 < 06.2.1 < 06.10. */
export function compararCodigo(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1, y = pb[i] ?? -1
    if (x !== y) return x - y
  }
  return 0
}

/** Subgrupos valendo para a org: os do padrão + os que ela criou, em ordem. */
export function subsDaOrg(config?: DreConfig | null): (DreSub & { custom?: boolean })[] {
  const padrao = new Set(DRE_SUBS_PADRAO.map(s => s.code))
  const extras = (config?.subs ?? []).filter(s => s?.code && !padrao.has(s.code)).map(s => ({ ...s, custom: true }))
  return [...DRE_SUBS_PADRAO, ...extras].sort((a, b) => compararCodigo(a.code, b.code))
}

/** Categoria → subgrupo valendo para a org (só aponta para subgrupo que existe). */
export function mapaDaOrg(config?: DreConfig | null): Map<string, string> {
  const existe = new Set(subsDaOrg(config).map(s => s.code))
  const m = new Map<string, string>()
  for (const [cat, sub] of Object.entries({ ...DRE_MAPA_PADRAO, ...(config?.mapa ?? {}) })) {
    if (sub && existe.has(sub)) m.set(cat, sub)
  }
  return m
}

/** O subgrupo `sub` é ele mesmo ou está dentro de `pai`? (06.2.1 está dentro de 06.2) */
export const dentroDe = (sub: string, pai: string) => sub === pai || sub.startsWith(`${pai}.`)

/**
 * A estrutura montada + as categorias que APARECERAM no período e não estão nela.
 *
 * Lançamento com categoria fora da estrutura não entrava em nenhuma linha e
 * sumia do resultado sem aviso (medido: 21 categorias, entre elas "Empréstimos
 * de Bancos", R$ 141,7 mil em 6 meses). Agora elas aparecem num grupo próprio,
 * e o resultado final inclui tudo. O erro fica visível em vez de desaparecer.
 *
 * `categorias` = todas as que vieram do banco (realizado + previsto).
 */
export function templateComExtras(categorias: Iterable<string>, config?: DreConfig | null): DreLine[] {
  const subs = subsDaOrg(config)
  const mapa = mapaDaOrg(config)
  const ordem = Object.keys(DRE_MAPA_PADRAO)
  const pos = (c: string) => { const i = ordem.indexOf(c); return i < 0 ? Infinity : i }

  const linhas: DreLine[] = []
  for (const g of DRE_GRUPOS) {
    linhas.push({ kind: 'grupo', code: g.code, label: g.label })
    for (const s of subs.filter(x => x.grupo === g.code)) {
      linhas.push({ kind: 'sub', code: s.code, label: s.label, grupo: g.code, custom: s.custom })
      const folhas = [...mapa].filter(([, sub]) => sub === s.code).map(([c]) => c)
        .sort((a, b) => pos(a) - pos(b) || a.localeCompare(b, 'pt-BR'))
      for (const categoria of folhas) linhas.push({ kind: 'folha', categoria, grupo: g.code, sub: s.code })
    }
    if (g.total) linhas.push({ kind: 'total', code: `${g.code}T`, label: g.total })
  }

  const extras = [...new Set(categorias)]
    .filter(c => c && !mapa.has(c))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (extras.length === 0) return linhas

  return [
    ...linhas,
    { kind: 'grupo', code: GRUPO_FORA, label: 'Fora da estrutura contábil' },
    { kind: 'sub', code: '99.1', label: 'Categorias ainda não mapeadas na DRE', grupo: GRUPO_FORA },
    ...extras.map((categoria): DreLine => ({ kind: 'folha', categoria, grupo: GRUPO_FORA, sub: '99.1' })),
    { kind: 'total', code: '99T', label: 'Resultado final (com os não mapeados)' },
  ]
}
