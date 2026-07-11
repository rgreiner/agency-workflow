-- 088_org_docs.sql
-- Textos dos documentos editáveis pela org (antes fixos em lib/agency.ts):
-- dados da agência + observações legais de Produção e de Mídia. Idempotente.

alter table org_settings add column if not exists agency_info     jsonb;
alter table org_settings add column if not exists doc_nf_notes    jsonb;  -- [{text, highlight}]
alter table org_settings add column if not exists doc_midia_notes jsonb;  -- [{text, highlight}]

create or replace function set_org_docs(
  p_user_id uuid, p_org_id uuid, p_agency jsonb, p_nf_notes jsonb, p_midia_notes jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role not in ('owner','admin') then
    raise exception 'Apenas administradores podem alterar as configurações';
  end if;
  insert into org_settings (org_id, agency_info, doc_nf_notes, doc_midia_notes, updated_at)
  values (p_org_id, p_agency, p_nf_notes, p_midia_notes, now())
  on conflict (org_id) do update set
    agency_info     = excluded.agency_info,
    doc_nf_notes    = excluded.doc_nf_notes,
    doc_midia_notes = excluded.doc_midia_notes,
    updated_at      = now();
end; $$;
grant execute on function set_org_docs(uuid, uuid, jsonb, jsonb, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
