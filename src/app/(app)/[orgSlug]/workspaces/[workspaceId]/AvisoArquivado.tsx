import { Archive } from 'lucide-react'

/**
 * Faixa no topo da página de cliente/campanha arquivada. Sem ela a página parece
 * normal — "Nova campanha" e "Nova atividade" funcionam — e o trabalho criado ali
 * nasce invisível: Lista, Gantt, Atendimento, sidebar e busca só olham cliente e
 * campanha ativos (10/09/2026: tarefa com 3 responsáveis criada num cliente
 * arquivado em agosto, e ninguém a via em tela nenhuma).
 */
export function AvisoArquivado({ tipo, nome }: { tipo: 'cliente' | 'campanha'; nome: string }) {
  const cliente = tipo === 'cliente'
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <Archive className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <div>
        <span className="font-semibold">{cliente ? 'Cliente arquivado' : 'Campanha arquivada'}: {nome}.</span>{' '}
        As tarefas daqui não aparecem na Lista, no Gantt, no Atendimento nem na busca — só nesta página.
        Para voltarem a circular, desarquive pelo menu ao lado do título; se o trabalho acabou, conclua ou arquive as tarefas.
      </div>
    </div>
  )
}
