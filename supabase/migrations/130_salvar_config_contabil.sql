-- 130_salvar_config_contabil.sql
-- Fix: os e-mails da contabilidade nunca eram gravados.
--
-- A 129 criou as colunas contabil_* em org_settings, mas a tela salvava com um
-- UPDATE direto pelo usuário autenticado. org_settings só tem policy de SELECT
-- (016) — toda escrita passa por RPC security definer. O UPDATE então batia na
-- RLS, afetava 0 linhas e o PostgREST devolvia SUCESSO SEM ERRO: a tela dizia
-- "Configuração salva" e o banco seguia com contabil_emails = '{}'. O fechamento
-- depois reclamava, com razão, que não havia destinatário.
--
-- Mesmo padrão das outras escritas em org_settings (098): upsert, porque a linha
-- da org pode nem existir — e aí o UPDATE também não escreveria nada.
-- Idempotente.

create or replace function salvar_config_contabil(
  p_org_id uuid, p_user_id uuid,
  p_emails text[], p_dia integer, p_ativo boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- Security definer roda com privilégio: a permissão é conferida aqui, não só
  -- na server action.
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
      and (om.can_finance or om.role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  if p_dia < 1 or p_dia > 28 then
    raise exception 'O dia precisa estar entre 1 e 28';
  end if;
  if p_ativo and coalesce(array_length(p_emails, 1), 0) = 0 then
    raise exception 'Defina ao menos um e-mail antes de ativar';
  end if;

  insert into org_settings (org_id, contabil_emails, contabil_dia, contabil_ativo, updated_at)
  values (p_org_id, coalesce(p_emails, '{}'), p_dia, p_ativo, now())
  on conflict (org_id) do update set
    contabil_emails = excluded.contabil_emails,
    contabil_dia    = excluded.contabil_dia,
    contabil_ativo  = excluded.contabil_ativo,
    updated_at      = now();
end $$;

grant execute on function salvar_config_contabil(uuid, uuid, text[], integer, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
