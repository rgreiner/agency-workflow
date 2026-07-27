-- 158_faturamento_envios.sql
-- Registro dos e-mails de faturamento disparados ao cliente (rastro de "foi
-- enviado": quem, quando, pra quem, qual documento). O envio NÃO é automático —
-- sai só quando o financeiro clica "Faturar e enviar".
-- Idempotente. RPC no padrão seguro pós-143 (guard auth.uid()).

create table if not exists faturamento_envios (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  tipo         text not null check (tipo in ('midia','producao')),
  doc_id       uuid not null,
  doc_numero   text,
  destinatario text not null,
  cc           text[] not null default '{}',
  enviado_por  uuid,
  created_at   timestamptz not null default now()
);
create index if not exists faturamento_envios_doc_idx on faturamento_envios (tipo, doc_id, created_at desc);
create index if not exists faturamento_envios_org_idx on faturamento_envios (org_id, created_at desc);

alter table faturamento_envios enable row level security;

-- Quem enxerga o financeiro vê os envios (owner/admin OU can_finance).
drop policy if exists faturamento_envios_select on faturamento_envios;
create policy faturamento_envios_select on faturamento_envios for select using (
  exists (select 1 from organization_members m
          where m.org_id = faturamento_envios.org_id and m.user_id = auth.uid()
            and (m.role in ('owner','admin') or m.can_finance))
);

-- Registro do envio — só quem tem financeiro na org; p_user_id = próprio chamador.
create or replace function registrar_faturamento_envio(
  p_user_id uuid, p_org uuid, p_tipo text, p_doc_id uuid,
  p_doc_numero text, p_destinatario text, p_cc text[]
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members m
    where m.org_id = p_org and m.user_id = p_user_id
      and (m.role in ('owner','admin') or m.can_finance)
  ) then
    raise exception 'Sem acesso ao financeiro' using errcode = '42501';
  end if;

  insert into faturamento_envios (org_id, tipo, doc_id, doc_numero, destinatario, cc, enviado_por)
  values (p_org, p_tipo, p_doc_id, p_doc_numero, p_destinatario, coalesce(p_cc,'{}'), p_user_id)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function registrar_faturamento_envio(uuid, uuid, text, uuid, text, text, text[]) from public;
grant execute on function registrar_faturamento_envio(uuid, uuid, text, uuid, text, text, text[]) to authenticated;

notify pgrst, 'reload schema';
