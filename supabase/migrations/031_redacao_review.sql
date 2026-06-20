-- Revisão de Redação por IA no gate "sair de Redação para avançar".
-- Guarda o resultado da última revisão na própria atividade.

alter table activities add column if not exists redacao_review_status text;     -- reviewing | clean | errors | overridden
alter table activities add column if not exists redacao_review_errors jsonb;    -- [{ trecho, problema, sugestao, tipo }]
alter table activities add column if not exists redacao_review_target text;     -- status que tentaram avançar (p/ "avançar mesmo assim")
alter table activities add column if not exists redacao_review_at timestamptz;

-- Salva o resultado da revisão (chamado pelo servidor, em 2º plano, após revisar).
create or replace function set_redacao_review(
  p_user_id uuid, p_activity_id uuid,
  p_status text, p_errors jsonb, p_target text
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
    redacao_review_status = p_status,
    redacao_review_errors = p_errors,
    redacao_review_target = p_target,
    redacao_review_at = now()
  where id = p_activity_id;
end; $$;

grant execute on function set_redacao_review(uuid, uuid, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
