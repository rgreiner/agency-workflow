-- Estrutura da DRE ajustável pela org (Financeiro → Estrutura da DRE).
--
-- A estrutura vivia só no código (lib/dre-template.ts): categoria nova caía em
-- "99 Fora da estrutura contábil" até alguém mexer no código. Agora a org move a
-- categoria para a linha certa e cria subgrupo (ex.: 06.2.1 Desligamentos) pela
-- tela. Guarda-se só a DIFERENÇA sobre o padrão do código:
--   { "subs": [{code, label, grupo}], "mapa": { "<categoria>": "<código do subgrupo>" | "" } }
-- O que a org não mexeu continua seguindo o padrão.

alter table org_settings add column if not exists dre_estrutura jsonb;

comment on column org_settings.dre_estrutura is
  'Ajustes da org sobre a estrutura padrão da DRE: subgrupos criados e categoria→subgrupo. Null = só o padrão.';

-- org_settings só tem policy de SELECT: update direto some em silêncio.
-- Mesmas guardas de set_org_payment_info: confronto com auth.uid() (fecha o
-- bypass por p_user_id) e o recorte de quem mexe em dado financeiro.
create or replace function set_dre_estrutura(p_user_id uuid, p_org_id uuid, p_estrutura jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))) then raise exception 'Acesso negado'; end if;
  if p_estrutura is not null and jsonb_typeof(p_estrutura) <> 'object' then
    raise exception 'Estrutura inválida';
  end if;

  update org_settings set dre_estrutura = p_estrutura where org_id = p_org_id;
  if not found then
    insert into org_settings (org_id, dre_estrutura) values (p_org_id, p_estrutura);
  end if;
end $$;

-- Toda função nova nasce chamável por anon/authenticated por DEFAULT PRIVILEGES
-- neste banco; revogar de PUBLIC não toca nesses dois.
revoke execute on function set_dre_estrutura(uuid, uuid, jsonb) from public, anon;
grant execute on function set_dre_estrutura(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
