-- ── Permissão de Vendas (separada do Financeiro) ─────────────────────────────
-- Antes `can_finance` liberava todo o Operacional. Agora:
--   can_finance → só os submenus do Financeiro (Lançamentos/Faturamento)
--   can_vendas  → o resto do Operacional (Mídias / Produção / Cadastros)
-- Owner/admin têm ambos implícito.

alter table organization_members add column if not exists can_vendas boolean not null default false;

-- Estende update_member com p_can_vendas (default null = não altera o valor atual).
drop function if exists update_member(uuid,uuid,uuid,uuid,member_role,boolean);
create or replace function update_member(
  p_user_id     uuid,
  p_org_id      uuid,
  p_member_id   uuid,
  p_position_id uuid,
  p_role        member_role,
  p_can_finance boolean default null,
  p_can_vendas  boolean default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  if p_user_id = p_member_id and p_role != 'owner' then
    raise exception 'Não é possível alterar o próprio papel de owner';
  end if;

  update organization_members
  set position_id = p_position_id,
      role        = p_role,
      can_finance = coalesce(p_can_finance, can_finance),
      can_vendas  = coalesce(p_can_vendas, can_vendas)
  where id = p_member_id and org_id = p_org_id;
end;
$$;

grant execute on function update_member(uuid,uuid,uuid,uuid,member_role,boolean,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
