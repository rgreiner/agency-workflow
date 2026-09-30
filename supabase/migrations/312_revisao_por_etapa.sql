-- 312_revisao_por_etapa.sql
-- Revisão IA por ETAPA, com a "impressão digital" do material revisado.
--
-- Até aqui o resultado morava em activities.review_* — UMA revisão por tarefa: rever
-- a Redação com a tarefa em Design apagava a do Design. E não havia como saber se o
-- texto mudou depois da revisão (30/09: "INDÚStTRIA" entrou no Doc dos Lacres horas
-- depois de revisado, com a tarefa já em Design, e seguiria para a arte).
--
-- fonte = versões dos arquivos lidos (Drive: version/md5; S3: ETag) + hash do texto;
-- texto = o que a IA leu (Redação), para a próxima revisão olhar só o que mudou.
-- status: clean | errors | failed | vazio | overridden (seguiu confirmando).

create table if not exists activity_revisao (
  activity_id  uuid not null references activities(id) on delete cascade,
  etapa        text not null check (etapa in ('redacao', 'design', 'finalizacao')),
  status       text not null,
  apontamentos jsonb,
  fonte        jsonb,
  texto        text,
  revisado_em  timestamptz not null default now(),
  revisado_por uuid references profiles(id) on delete set null,
  primary key (activity_id, etapa)
);

alter table activity_revisao enable row level security;

drop policy if exists "activity_revisao membros" on activity_revisao;
create policy "activity_revisao membros" on activity_revisao
  for all to authenticated
  using (exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_revisao.activity_id and is_org_member(w.org_id)))
  with check (exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_revisao.activity_id and is_org_member(w.org_id)));

revoke all on table activity_revisao from public, anon;
-- DEFAULT PRIVILEGES dão tudo a authenticated; o app só lê, cria e atualiza.
revoke delete, truncate, references, trigger on table activity_revisao from authenticated;
grant select, insert, update on table activity_revisao to authenticated;

-- Traz a revisão vigente de quem ainda está na etapa revisada (o resto é histórico).
insert into activity_revisao (activity_id, etapa, status, apontamentos, revisado_em)
select id, review_kind, review_status, review_errors, review_at
from activities
where review_kind in ('redacao', 'design', 'finalizacao')
  and review_status in ('clean', 'errors', 'failed', 'vazio', 'overridden')
  and review_at is not null
  and status = review_kind
on conflict (activity_id, etapa) do nothing;

notify pgrst, 'reload schema';
