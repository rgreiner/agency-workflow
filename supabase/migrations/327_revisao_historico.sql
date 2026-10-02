-- 327_revisao_historico.sql
-- Histórico da Revisão IA: cada revisão e cada "seguiu com apontamentos" vira uma
-- linha que NUNCA é apagada nem alterada. activity_revisao (312) guarda só a
-- vigente por etapa — revisar de novo apagava o que a IA tinha apontado antes, e
-- a comparação com a Revisão Interna ficava cega (02/10/2026: o Lacres seguiu com
-- 2, 6 e 1 apontamentos e não havia como saber quais).

create table if not exists activity_revisao_log (
  id           bigint generated always as identity primary key,
  activity_id  uuid not null references activities(id) on delete cascade,
  etapa        text not null check (etapa in ('redacao', 'design', 'finalizacao')),
  evento       text not null check (evento in ('revisao', 'seguiu')),
  status       text not null,
  apontamentos jsonb,
  modelo       text,
  parcial      boolean not null default false,
  partes       int,
  nao_lidas    jsonb,
  por          uuid references profiles(id) on delete set null,
  em           timestamptz not null default now()
);

create index if not exists activity_revisao_log_atividade on activity_revisao_log (activity_id, em desc);

alter table activity_revisao_log enable row level security;

drop policy if exists "activity_revisao_log ler" on activity_revisao_log;
create policy "activity_revisao_log ler" on activity_revisao_log
  for select to authenticated
  using (exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_revisao_log.activity_id and is_org_member(w.org_id)));

drop policy if exists "activity_revisao_log gravar" on activity_revisao_log;
create policy "activity_revisao_log gravar" on activity_revisao_log
  for insert to authenticated
  with check (por = auth.uid() and exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_revisao_log.activity_id and is_org_member(w.org_id)));

-- Só acrescenta: DEFAULT PRIVILEGES dariam update/delete a authenticated.
revoke all on table activity_revisao_log from public, anon, authenticated;
grant select, insert on table activity_revisao_log to authenticated;

notify pgrst, 'reload schema';
