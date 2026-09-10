/**
 * Ícone das linhas do cabeçalho e do rodapé da sidebar (busca, atalhos, modos,
 * recolher). `tip` = tooltip próprio via data-tip; `press` = afunda ao clicar.
 */
export const ICONE_TOPO = 'tip press relative p-1.5 rounded-lg'
export const ICONE_TOPO_IDLE = 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'
/**
 * Página ativa = ícone claro + sublinhado no accent ("você está aqui"). O chip
 * preenchido (bg-gray-700 + laranja) fica só para o MODO ("este contexto está
 * ligado"): dois significados, dois desenhos.
 */
export const ICONE_TOPO_ATIVO =
  'text-gray-100 after:absolute after:inset-x-2 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-orange-500'
