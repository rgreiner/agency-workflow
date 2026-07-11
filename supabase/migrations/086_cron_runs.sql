-- 086_cron_runs.sql
-- Controle do executor de tarefas agendadas (cron). Cada job registra sua última
-- execução aqui; o runner decide o que rodar pela janela de cada job. Idempotente.

create table if not exists cron_runs (
  job          text primary key,
  last_run_at  timestamptz,
  last_status  text,            -- 'ok' | 'erro'
  last_detail  text,            -- resumo (ex.: "3 e-mails" ou a mensagem de erro)
  updated_at   timestamptz not null default now()
);

-- Sem RLS de leitura pública: só é lida server-side (service/health check).
alter table cron_runs enable row level security;
-- Admin da org lê (p/ o health check "cron parado"); escrita é server-side.
drop policy if exists "admin read cron_runs" on cron_runs;
create policy "admin read cron_runs" on cron_runs for select using (
  exists (select 1 from organization_members om
          where om.user_id = auth.uid() and om.role in ('owner','admin'))
);

-- Marca a execução de um job (upsert). Server-side (security definer).
create or replace function mark_cron_run(p_job text, p_status text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cron_runs (job, last_run_at, last_status, last_detail, updated_at)
  values (p_job, now(), p_status, left(coalesce(p_detail,''), 500), now())
  on conflict (job) do update set
    last_run_at = now(), last_status = excluded.last_status,
    last_detail = excluded.last_detail, updated_at = now();
end; $$;
grant execute on function mark_cron_run(text, text, text) to anon, authenticated;

-- Leitura p/ o runner (roda sem usuário = anon). Sem dado sensível.
create or replace function list_cron_runs()
returns setof cron_runs language sql security definer set search_path = public
as $$ select * from cron_runs $$;
grant execute on function list_cron_runs() to anon, authenticated;

notify pgrst, 'reload schema';
