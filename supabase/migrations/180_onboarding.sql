-- 180_onboarding.sql
-- Onboarding: trilha de primeiros passos para quem chega. É o par do offboarding
-- (177/178/179) — lá o RH tira o acesso; aqui o RH dá o começo.
--
-- Duas decisões do Rafael (01/08/2026) moldam o formato:
--   • CONFIGURÁVEL: "cada empresa tem suas lógicas e regras, precisamos respeitar
--     elas" → as etapas são CADASTRO da org, não lista fixa no código.
--   • ORIENTA, NÃO BLOQUEIA: "não bloqueia, orienta para ele entender" → nada
--     impede a pessoa de trabalhar; a trilha acompanha e some quando termina.
--
-- Progresso não é materializado por pessoa: a trilha é `etapas ativas × checks`.
-- Assim, etapa criada depois aparece para quem já estava no meio do caminho, e
-- etapa removida some sem deixar lixo. Idempotente.

create table if not exists onboarding_etapa (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  ordem        int  not null default 0,
  titulo       text not null,
  descricao    text,                     -- o "como funciona" em texto livre
  link         text,                     -- rota interna opcional (ex.: /ponto)
  link_label   text,
  -- vazio = todo mundo; preenchido = só quem tem um destes cargos
  position_ids uuid[] not null default '{}',
  ativo        boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists onboarding_etapa_org_idx on onboarding_etapa (org_id, ordem);

-- Uma linha por pessoa × etapa concluída (ausência = pendente).
create table if not exists onboarding_check (
  etapa_id    uuid not null references onboarding_etapa(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  concluido_em timestamptz not null default now(),
  primary key (etapa_id, user_id)
);

alter table onboarding_etapa enable row level security;
alter table onboarding_check enable row level security;

drop policy if exists onboarding_etapa_ler on onboarding_etapa;
create policy onboarding_etapa_ler on onboarding_etapa for select using (is_org_member(org_id));
drop policy if exists onboarding_etapa_admin on onboarding_etapa;
create policy onboarding_etapa_admin on onboarding_etapa for all
  using (exists (select 1 from organization_members om
                 where om.org_id = onboarding_etapa.org_id and om.user_id = auth.uid()
                   and om.role in ('owner','admin') and om.arquivado = false))
  with check (exists (select 1 from organization_members om
                 where om.org_id = onboarding_etapa.org_id and om.user_id = auth.uid()
                   and om.role in ('owner','admin') and om.arquivado = false));

-- Cada um marca o SEU progresso.
drop policy if exists onboarding_check_self on onboarding_check;
create policy onboarding_check_self on onboarding_check for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Trilha da pessoa: etapas que valem p/ o cargo dela + o que já concluiu ───
create or replace function onboarding_trilha(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pos uuid; v jsonb;
begin
  if not is_org_member(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select position_id into v_pos from organization_members
  where org_id = p_org_id and user_id = auth.uid() and arquivado = false limit 1;

  select coalesce(jsonb_agg(x order by x.ordem, x.titulo), '[]'::jsonb) into v
  from (
    select e.id, e.ordem, e.titulo, e.descricao, e.link, e.link_label,
           (c.user_id is not null) as concluido
    from onboarding_etapa e
    left join onboarding_check c on c.etapa_id = e.id and c.user_id = auth.uid()
    where e.org_id = p_org_id and e.ativo
      and (cardinality(e.position_ids) = 0 or v_pos = any(e.position_ids))
  ) x;
  return v;
end $$;
revoke execute on function onboarding_trilha(uuid) from public;
grant execute on function onboarding_trilha(uuid) to authenticated;

-- ── Marcar/desmarcar uma etapa (só a própria) ───────────────────────────────
create or replace function onboarding_marcar(p_etapa_id uuid, p_concluido boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from onboarding_etapa where id = p_etapa_id;
  if v_org is null then raise exception 'Etapa não encontrada'; end if;
  if not is_org_member(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  if p_concluido then
    insert into onboarding_check (etapa_id, user_id) values (p_etapa_id, auth.uid())
    on conflict (etapa_id, user_id) do nothing;
  else
    delete from onboarding_check where etapa_id = p_etapa_id and user_id = auth.uid();
  end if;
end $$;
revoke execute on function onboarding_marcar(uuid, boolean) from public;
grant execute on function onboarding_marcar(uuid, boolean) to authenticated;

-- ── Cadastro das etapas (owner/admin) ───────────────────────────────────────
create or replace function onboarding_salvar_etapa(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members
                 where org_id = p_org_id and user_id = auth.uid()
                   and role in ('owner','admin') and arquivado = false)
  then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'titulo',''), '') = '' then raise exception 'Título é obrigatório'; end if;

  if p_id is null then
    insert into onboarding_etapa (org_id, ordem, titulo, descricao, link, link_label, position_ids, ativo)
    values (p_org_id,
      coalesce((p_data->>'ordem')::int, (select coalesce(max(ordem), 0) + 1 from onboarding_etapa where org_id = p_org_id)),
      p_data->>'titulo', nullif(p_data->>'descricao',''), nullif(p_data->>'link',''), nullif(p_data->>'link_label',''),
      coalesce((select array_agg(t::uuid) from jsonb_array_elements_text(coalesce(p_data->'position_ids','[]'::jsonb)) t), '{}'),
      coalesce((p_data->>'ativo')::boolean, true))
    returning id into v_id;
  else
    update onboarding_etapa set
      ordem = coalesce((p_data->>'ordem')::int, ordem),
      titulo = p_data->>'titulo',
      descricao = nullif(p_data->>'descricao',''),
      link = nullif(p_data->>'link',''),
      link_label = nullif(p_data->>'link_label',''),
      position_ids = coalesce((select array_agg(t::uuid) from jsonb_array_elements_text(coalesce(p_data->'position_ids','[]'::jsonb)) t), '{}'),
      ativo = coalesce((p_data->>'ativo')::boolean, ativo)
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Etapa não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function onboarding_salvar_etapa(uuid, uuid, jsonb) from public;
grant execute on function onboarding_salvar_etapa(uuid, uuid, jsonb) to authenticated;

create or replace function onboarding_excluir_etapa(p_org_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from organization_members
                 where org_id = p_org_id and user_id = auth.uid()
                   and role in ('owner','admin') and arquivado = false)
  then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from onboarding_etapa where id = p_id and org_id = p_org_id;
end $$;
revoke execute on function onboarding_excluir_etapa(uuid, uuid) from public;
grant execute on function onboarding_excluir_etapa(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
