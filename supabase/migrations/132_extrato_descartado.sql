-- 132_extrato_descartado.sql
-- Descartar uma linha do extrato importado marcando situacao='Perdido/Desconsiderado'
-- NÃO sobrevive: o import da Conta Azul apaga o extrato e recarrega o arquivo inteiro,
-- e a linha volta. Foi o que aconteceu na limpeza das 12 duplicadas do Times Digitais.
--
-- Aqui o descarte fica FORA do extrato, numa lista por import_ref. O import continua
-- podendo apagar e recarregar à vontade; a tela consulta esta lista e a linha segue
-- escondida. Idempotente.

create table if not exists extrato_descartado (
  org_id     uuid not null references organizations(id) on delete cascade,
  import_ref text not null,
  motivo     text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  primary key (org_id, import_ref)
);

alter table extrato_descartado enable row level security;

drop policy if exists "Finance read extrato_descartado" on extrato_descartado;
create policy "Finance read extrato_descartado" on extrato_descartado
  for select using (
    exists (select 1 from organization_members om
            where om.org_id = extrato_descartado.org_id and om.user_id = auth.uid()
              and (om.can_finance or om.role in ('owner','admin')))
  );
grant select on extrato_descartado to anon, authenticated;
-- Escrita só por RPC (security definer), igual ao resto do financeiro.

create or replace function descartar_extrato(
  p_user_id uuid, p_org_id uuid, p_import_ref text, p_motivo text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  insert into extrato_descartado (org_id, import_ref, motivo, created_by)
  values (p_org_id, p_import_ref, nullif(p_motivo, ''), p_user_id)
  on conflict (org_id, import_ref) do update set motivo = excluded.motivo;
end $$;

create or replace function restaurar_extrato(
  p_user_id uuid, p_org_id uuid, p_import_ref text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  delete from extrato_descartado where org_id = p_org_id and import_ref = p_import_ref;
end $$;

grant execute on function descartar_extrato(uuid, uuid, text, text) to anon, authenticated;
grant execute on function restaurar_extrato(uuid, uuid, text) to anon, authenticated;

-- Migra o descarte que fizemos à mão nas 12 do Times Digitais: sem isso, o próximo
-- reimport traria as duplicatas de volta.
insert into extrato_descartado (org_id, import_ref, motivo)
select e.org_id, e.import_ref, 'duplicata do Fee 65 (nativo do Flow) — limpeza 20/07/2026'
from extrato_importado e
where e.situacao = 'Perdido/Desconsiderado'
  and e.descricao ilike '%Fee 65%Times Digitais%'
on conflict (org_id, import_ref) do nothing;

notify pgrst, 'reload schema';
