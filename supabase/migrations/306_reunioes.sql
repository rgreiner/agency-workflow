-- 306_reunioes.sql
-- Atas de reunião do atendimento (29/09/2026).
--   • A ata vive no Flow, amarrada ao CLIENTE (campanha opcional). Entra colando as
--     notas do Granola (ou de onde for); a transcrição é opcional e NUNCA sai do time.
--   • Próximos passos: da agência (viram tarefa por clique, com briefing pré-preenchido
--     — nunca sozinhos) ou do cliente (aparecem pra ele no portal).
--   • Portal: o cliente vê só resumo + próximos passos das atas PUBLICADAS.
-- Acesso: todo membro lê; quem gerencia o portal (portal_pode_gerir = Atendimento
-- ou owner/admin) cria, edita, publica e exclui.
-- Idempotente.

create table if not exists reunioes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  campaign_id    uuid references campaigns(id) on delete set null,
  titulo         text not null,
  realizada_em   date not null default current_date,
  participantes  text,
  notas          text,          -- o que foi colado (notas do Granola); interno
  transcricao    text,          -- interno, nunca vai pro portal
  resumo         text,          -- o que o cliente lê quando publicada
  publicada      boolean not null default false,
  publicada_em   timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists reunioes_ws_idx on reunioes (workspace_id, realizada_em desc);
create index if not exists reunioes_org_idx on reunioes (org_id);

create table if not exists reuniao_passos (
  id           uuid primary key default gen_random_uuid(),
  reuniao_id   uuid not null references reunioes(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  ordem        int not null default 0,
  texto        text not null,
  responsavel  text not null default 'agencia' check (responsavel in ('agencia','cliente')),
  rascunho     text,          -- rascunho do briefing (interno), vai pro form da tarefa
  activity_id  uuid references activities(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists reuniao_passos_reuniao_idx on reuniao_passos (reuniao_id, ordem);
create index if not exists reuniao_passos_activity_idx on reuniao_passos (activity_id) where activity_id is not null;

alter table reunioes enable row level security;
alter table reuniao_passos enable row level security;

-- ── reunioes ──
drop policy if exists reunioes_select on reunioes;
create policy reunioes_select on reunioes for select using (is_org_member(org_id));

-- O workspace (e a campanha, se houver) tem de ser da MESMA org da linha.
drop policy if exists reunioes_insert on reunioes;
create policy reunioes_insert on reunioes for insert with check (
  portal_pode_gerir(org_id)
  and exists (select 1 from workspaces w where w.id = workspace_id and w.org_id = reunioes.org_id)
  and (campaign_id is null or exists (
    select 1 from campaigns c where c.id = campaign_id and c.workspace_id = reunioes.workspace_id))
);
drop policy if exists reunioes_update on reunioes;
create policy reunioes_update on reunioes for update using (portal_pode_gerir(org_id)) with check (
  portal_pode_gerir(org_id)
  and exists (select 1 from workspaces w where w.id = workspace_id and w.org_id = reunioes.org_id)
  and (campaign_id is null or exists (
    select 1 from campaigns c where c.id = campaign_id and c.workspace_id = reunioes.workspace_id))
);
drop policy if exists reunioes_delete on reunioes;
create policy reunioes_delete on reunioes for delete using (portal_pode_gerir(org_id));

-- ── reuniao_passos ── (org_id tem de bater com o da reunião)
drop policy if exists reuniao_passos_select on reuniao_passos;
create policy reuniao_passos_select on reuniao_passos for select using (is_org_member(org_id));

drop policy if exists reuniao_passos_write on reuniao_passos;
create policy reuniao_passos_write on reuniao_passos for all using (portal_pode_gerir(org_id)) with check (
  portal_pode_gerir(org_id)
  and exists (select 1 from reunioes r where r.id = reuniao_id and r.org_id = reuniao_passos.org_id)
  and (activity_id is null or exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join reunioes r on r.id = reuniao_passos.reuniao_id
    where a.id = activity_id and c.workspace_id = r.workspace_id))
);

grant select, insert, update, delete on reunioes, reuniao_passos to authenticated;
revoke all on reunioes, reuniao_passos from anon;

-- ── Portal: lista das atas publicadas do workspace do contato ──
create or replace function portal_reunioes()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'titulo', r.titulo, 'realizada_em', r.realizada_em,
      'passos_cliente', (select count(*) from reuniao_passos p
                         where p.reuniao_id = r.id and p.responsavel = 'cliente')
    ) order by r.realizada_em desc, r.created_at desc)
    from reunioes r
    where r.workspace_id = v_pu.workspace_id and r.publicada
  ), '[]'::jsonb);
end $$;
revoke execute on function portal_reunioes() from public, anon, authenticated;
grant execute on function portal_reunioes() to portal;

-- ── Portal: UMA ata publicada — resumo e passos; notas e transcrição NÃO saem ──
create or replace function portal_reuniao(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  select jsonb_build_object(
    'id', r.id, 'titulo', r.titulo, 'realizada_em', r.realizada_em,
    'participantes', r.participantes, 'resumo', r.resumo,
    'campanha', c.name,
    'passos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'texto', p.texto, 'responsavel', p.responsavel,
        'em_andamento', p.activity_id is not null
      ) order by p.ordem, p.created_at)
      from reuniao_passos p where p.reuniao_id = r.id
    ), '[]'::jsonb)
  ) into v_row
  from reunioes r left join campaigns c on c.id = r.campaign_id
  where r.id = p_id and r.workspace_id = v_pu.workspace_id and r.publicada;
  if v_row is null then raise exception 'Ata indisponível'; end if;
  return v_row;
end $$;
revoke execute on function portal_reuniao(uuid) from public, anon, authenticated;
grant execute on function portal_reuniao(uuid) to portal;

notify pgrst, 'reload schema';
