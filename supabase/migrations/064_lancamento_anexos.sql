-- 064_lancamento_anexos.sql
-- Tela 3 (interna do lançamento): anexos (NF, boleto, outros) por lançamento.
-- anexos: jsonb [{url, nome, tipo}]  (tipo: NF | Boleto | Outro)
-- Idempotente.

alter table lancamentos add column if not exists anexos jsonb not null default '[]'::jsonb;

create or replace function set_lancamento_anexos(p_user_id uuid, p_lancamento_id uuid, p_anexos jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from lancamentos l
    join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set anexos = coalesce(p_anexos, '[]'::jsonb), updated_at = now()
  where id = p_lancamento_id;
end; $$;

grant execute on function set_lancamento_anexos(uuid,uuid,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
