/**
 * Lista de membros da org para SELETOR (responsável, chat, @menção, filtro).
 *
 * Arquivar alguém (migration 178) corta o acesso — `is_org_member`, `rh_can` e
 * `horas_can` já barram — mas NÃO tirava a pessoa das listas de escolha: quem saiu da
 * agência continuava aparecendo no chat, no seletor de responsável do job, na @menção
 * e nos filtros. A regra é: **quem foi arquivado vira histórico, não opção.**
 *
 * Histórico continua intacto porque não passa por aqui: o nome em tarefa concluída vem
 * do embed `activity_assignees.profiles`, e o comentário antigo guarda o próprio autor.
 * `arquivar_membro` solta só as atividades ATIVAS — as concluídas ficam com a pessoa de
 * propósito, é o registro do que ela entregou.
 *
 * Use este helper em vez de repetir o `.eq('arquivado', false)`: a tela que esquecer o
 * filtro é exatamente o bug que se está corrigindo aqui.
 *
 * Exceções legítimas (não usar este helper): a tela de Membros em Configurações, que
 * gerencia os dois grupos, e a tela da tarefa, que precisa resolver o NOME de quem já
 * está atribuído — lá a lista vem com a marca `arquivado` e só o seletor filtra.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function membrosAtivos<T = any>(
  sb: any, orgId: string, select: string,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  return sb.from('organization_members').select(select).eq('org_id', orgId).eq('arquivado', false)
}
