-- 203_extrato_lixeira.sql
-- Lixeira do extrato importado. O descarte (migration 132) sempre foi reversível no
-- banco — `restaurar_extrato` existe desde então —, mas não havia tela: a linha sumia
-- de Lançamentos e ninguém mais via o que tinha sido descartado nem por quem. Descarte
-- errado só aparecia quando alguém sentia falta do título.
--
-- A view existe porque o join não dá pra fazer pelo PostgREST: `extrato_descartado`
-- casa com `extrato_importado` por (org_id, import_ref) — chave composta, sem FK — e o
-- `import_ref` é um texto com `|`, vírgula e parêntese dentro, que arrebenta um filtro
-- `in.(...)`. Uma view resolve em uma consulta e ainda entrega o descarte ÓRFÃO (linha
-- que não voltou no último import), que de outro jeito ficaria invisível.
--
-- ⚠️ `with (security_invoker = true)` é obrigatório: sem ele a view roda como dona e
-- vaza extrato entre orgs (foi assim que o livro-caixa vazou — migration 181).
-- Idempotente.

drop view if exists extrato_lixeira;
create view extrato_lixeira with (security_invoker = true) as
select
  d.org_id,
  d.import_ref,
  d.motivo,
  d.created_at                                            as descartado_em,
  d.created_by                                            as descartado_por_id,
  p.full_name                                             as descartado_por,
  -- Tudo abaixo vem do extrato e é NULL quando o descarte ficou órfão (a linha não
  -- veio no último import). A tela usa `existe` pra dizer isso em vez de mostrar
  -- uma linha vazia sem explicação.
  (e.import_ref is not null)                              as existe,
  e.contato,
  e.descricao,
  e.categoria,
  e.centro_custo,
  e.conta,
  e.tipo,                                                 -- receita | despesa
  e.situacao,                                             -- rótulo da Conta Azul
  abs(coalesce(e.valor, e.valor_original, 0))             as valor,
  coalesce(e.data_prevista, e.venc_original, e.data_mov)  as vencimento,
  -- Já existe título equivalente promovido? Se sim, restaurar duplica na tela.
  exists (
    select 1 from lancamentos l
    where l.org_id = d.org_id and l.origem_ref = d.import_ref
  )                                                       as promovido
from extrato_descartado d
left join extrato_importado e on e.org_id = d.org_id and e.import_ref = d.import_ref
left join profiles p on p.id = d.created_by;

revoke all on extrato_lixeira from anon;
grant select on extrato_lixeira to authenticated;

-- Restaurar em LOTE: o descarte costuma ser feito em bloco (as 12 parcelas do Fee do
-- IMDM de uma vez), e desfazer parcela por parcela seria uma ida ao servidor por linha.
-- Nome próprio, não overload: o PostgREST self-hosted é estrito com sobrecarga.
create or replace function restaurar_extrato_lote(
  p_user_id uuid, p_org_id uuid, p_import_refs text[]
) returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and arquivado = false
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  delete from extrato_descartado
   where org_id = p_org_id and import_ref = any(coalesce(p_import_refs, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Toda função nasce executável por anon/PUBLIC neste banco (ALTER DEFAULT PRIVILEGES
-- do VPS) — revogar das duas, senão a chamada anônima entra e só para no guard.
revoke execute on function restaurar_extrato_lote(uuid, uuid, text[]) from public, anon;
grant execute on function restaurar_extrato_lote(uuid, uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
