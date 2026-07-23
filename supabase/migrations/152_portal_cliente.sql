-- 152_portal_cliente.sql
-- Portal do cliente — Fase 1 (acesso + dashboard 3 colunas).
-- O cliente NÃO é membro da org: é um principal próprio (portal_users), amarrado
-- a UM workspace (Comil só enxerga Comil). Entra por magic link (tokens no schema
-- auth, via conexão direta, molde do reset de senha) e recebe um JWT com
-- role='portal' — uma role do PostgREST que SÓ executa as RPCs portal_*.
-- Nenhuma tabela tem grant pra portal; as RPCs são security definer e devolvem
-- exclusivamente a micro-visão controlada (nome, campanha, coluna) — nunca
-- comentários, briefing, responsáveis ou status interno.
-- Idempotente.

-- ── Role do PostgREST pro cliente ──
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'portal') then
    create role portal nologin;
  end if;
  -- O PostgREST troca pra esta role quando o JWT traz role='portal'.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant portal to authenticator;
  end if;
end $$;
grant usage on schema public to portal;

-- ── Contatos do cliente com acesso ao portal ──
create table if not exists portal_users (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  nome          text not null,
  email         text not null,
  ativo         boolean not null default true,
  last_login_at timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create unique index if not exists portal_users_ws_email_uq
  on portal_users (workspace_id, lower(email));
create index if not exists portal_users_email_idx on portal_users (lower(email));

alter table portal_users enable row level security;

-- Membros da org enxergam; só owner/admin gerencia.
drop policy if exists portal_users_select on portal_users;
create policy portal_users_select on portal_users for select using (
  exists (select 1 from organization_members m
          where m.org_id = portal_users.org_id and m.user_id = auth.uid())
);
drop policy if exists portal_users_admin on portal_users;
create policy portal_users_admin on portal_users for all using (
  exists (select 1 from organization_members m
          where m.org_id = portal_users.org_id and m.user_id = auth.uid()
            and m.role in ('owner','admin'))
) with check (
  exists (select 1 from organization_members m
          where m.org_id = portal_users.org_id and m.user_id = auth.uid()
            and m.role in ('owner','admin'))
);

-- ── Tokens de magic link (schema auth — fora do PostgREST, só conexão direta) ──
create table if not exists auth.portal_login_tokens (
  id             uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references public.portal_users(id) on delete cascade,
  token_hash     text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_plt_token_hash on auth.portal_login_tokens(token_hash);
create index if not exists idx_plt_user       on auth.portal_login_tokens(portal_user_id);

-- ── Dashboard do portal: a micro-visão controlada ──
-- Identidade vem do claim portal_sub do JWT (nunca de parâmetro). O workspace é
-- derivado da LINHA do portal_user no banco — o token não escolhe o que vê.
create or replace function portal_dashboard()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_sub uuid;
  v_pu  portal_users%rowtype;
begin
  v_sub := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'portal_sub';
  if v_sub is null then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select * into v_pu from portal_users where id = v_sub and ativo;
  if not found then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'usuario', jsonb_build_object('nome', v_pu.nome, 'email', v_pu.email),
    'cliente', (select jsonb_build_object('nome', w.name)
                from workspaces w where w.id = v_pu.workspace_id),
    'tarefas', coalesce((
      select jsonb_agg(t order by t->>'campanha', t->>'titulo')
      from (
        select jsonb_build_object(
          'id',       a.id,
          'titulo',   a.title,
          'campanha', c.name,
          -- Só as 3 colunas do portal — o status interno NUNCA sai daqui.
          'coluna',   case a.status
                        when 'pendente_cliente'  then 'pendente'
                        when 'aprovacao_cliente' then 'aprovacao'
                        else 'agencia'
                      end
        ) as t
        from activities a
        join campaigns c on c.id = a.campaign_id
        where c.workspace_id = v_pu.workspace_id
          and not a.archived and not c.archived
          and a.status <> 'concluido'
      ) sub
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function portal_dashboard() from public;
revoke execute on function portal_dashboard() from anon;
revoke execute on function portal_dashboard() from authenticated;
grant execute on function portal_dashboard() to portal;

notify pgrst, 'reload schema';
