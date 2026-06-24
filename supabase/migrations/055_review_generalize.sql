-- ── Generaliza a revisão por IA (Redação → Design → Finalização) ─────────────
-- Antes só havia revisão de Redação (colunas redacao_review_*). Como as revisões
-- são sequenciais (uma tarefa só está em uma revisão por vez), renomeia o estado
-- para genérico review_* + review_kind ('redacao' | 'design' | 'finalizacao').

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='activities' and column_name='redacao_review_status') then
    alter table activities rename column redacao_review_status to review_status;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='activities' and column_name='redacao_review_errors') then
    alter table activities rename column redacao_review_errors to review_errors;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='activities' and column_name='redacao_review_target') then
    alter table activities rename column redacao_review_target to review_target;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='activities' and column_name='redacao_review_at') then
    alter table activities rename column redacao_review_at to review_at;
  end if;
end $$;

-- Garantia (DB que nunca teve as colunas redacao_review_*).
alter table activities add column if not exists review_status text;   -- reviewing | clean | errors | overridden
alter table activities add column if not exists review_errors jsonb;  -- [{ trecho, problema, sugestao, tipo }]
alter table activities add column if not exists review_target text;    -- status que tentaram avançar (p/ "avançar mesmo assim")
alter table activities add column if not exists review_at timestamptz;
alter table activities add column if not exists review_kind text;      -- redacao | design | finalizacao

-- Salva o resultado da última revisão (chamado pelo servidor, em 2º plano).
create or replace function set_review(
  p_user_id uuid, p_activity_id uuid,
  p_kind text, p_status text, p_errors jsonb, p_target text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then raise exception 'Acesso negado'; end if;
  update activities set
    review_kind   = p_kind,
    review_status = p_status,
    review_errors = p_errors,
    review_target = p_target,
    review_at     = now()
  where id = p_activity_id;
end; $$;

-- Compat: mantém set_redacao_review como fachada (kind = 'redacao') para o código
-- antigo durante a janela de deploy.
create or replace function set_redacao_review(
  p_user_id uuid, p_activity_id uuid,
  p_status text, p_errors jsonb, p_target text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_review(p_user_id, p_activity_id, 'redacao', p_status, p_errors, p_target);
end; $$;

grant execute on function set_review(uuid, uuid, text, text, jsonb, text) to anon, authenticated;
grant execute on function set_redacao_review(uuid, uuid, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
