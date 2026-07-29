-- 159_boards_min_role.sql
-- Acesso por cargo aos quadros. Cada quadro tem um nível mínimo (min_role):
-- vê E edita quem tem cargo naquele nível OU acima. Quem cria escolhe o nível,
-- nunca acima do próprio cargo (garantido pelo WITH CHECK do RLS).
-- Hierarquia: owner > admin > manager > member > viewer.

-- Nível mínimo por quadro. Default 'member' = todos menos Visualizador
-- (aplica também às linhas já existentes).
alter table visual_boards
  add column if not exists min_role member_role not null default 'member';

-- Rank numérico do cargo (maior = mais poder).
create or replace function role_rank(r member_role) returns int as $$
  select case r
    when 'owner'   then 4
    when 'admin'   then 3
    when 'manager' then 2
    when 'member'  then 1
    when 'viewer'  then 0
    else -1
  end;
$$ language sql immutable;

-- Rank do usuário atual na org (-1 se não for membro).
create or replace function my_org_rank(org uuid) returns int as $$
  select coalesce((
    select role_rank(role) from organization_members
    where org_id = org and user_id = auth.uid()
  ), -1);
$$ language sql security definer stable;

grant execute on function role_rank(member_role) to anon, authenticated;
grant execute on function my_org_rank(uuid)       to anon, authenticated;

-- Policies antigas (acesso plano por org) → acesso por rank do cargo.
drop policy if exists "org members can view boards"   on visual_boards;
drop policy if exists "org members can insert boards" on visual_boards;
drop policy if exists "org members can update boards" on visual_boards;
drop policy if exists "org members can delete boards" on visual_boards;

drop policy if exists "boards select by rank" on visual_boards;
drop policy if exists "boards insert by rank" on visual_boards;
drop policy if exists "boards update by rank" on visual_boards;
drop policy if exists "boards delete by rank" on visual_boards;

-- Ver: cargo >= nível do quadro.
create policy "boards select by rank" on visual_boards
  for select using ( my_org_rank(org_id) >= role_rank(min_role) );

-- Criar: membro, em seu próprio nome, e sem travar acima do próprio cargo.
create policy "boards insert by rank" on visual_boards
  for insert with check (
    is_org_member(org_id)
    and auth.uid() = created_by
    and my_org_rank(org_id) >= role_rank(min_role)
  );

-- Editar: precisa alcançar o quadro (USING, linha antiga) e não pode elevar o
-- nível acima do próprio cargo (WITH CHECK, linha nova).
create policy "boards update by rank" on visual_boards
  for update using ( my_org_rank(org_id) >= role_rank(min_role) )
  with check    ( my_org_rank(org_id) >= role_rank(min_role) );

create policy "boards delete by rank" on visual_boards
  for delete using ( my_org_rank(org_id) >= role_rank(min_role) );

notify pgrst, 'reload schema';
