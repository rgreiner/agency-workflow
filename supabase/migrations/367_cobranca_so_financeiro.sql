-- 367 — cobrança pelo WhatsApp SÓ para contato marcado como FINANCEIRO (26/10/2026)
--
-- O lembrete da IMDM foi cumprimentando o dono (Thiago, o contato principal do
-- cadastro), e clientes sem telefone "Financeiro" caíam no 1º número da lista ou
-- no principal (Evolua → Márcio). Agora: telefone da lista com rótulo financeiro;
-- senão, o principal só se o contato principal estiver marcado como financeiro
-- ("Caroline | Financeiro"). Nome = o do rótulo ("Financeiro | Gi" → Gi), nunca
-- o contato principal (sem nome no rótulo, a saudação vai à empresa). Sem financeiro → fora da régua e na lista de de-para.
create or replace function public._fin_whats_cliente(w workspaces)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with fin as (
    select e.t from jsonb_array_elements(coalesce(w.telefones, '[]'::jsonb)) with ordinality as e(t, i)
     where coalesce(e.t->>'tipo', '') ilike '%financ%'
       and regexp_replace(coalesce(e.t->>'numero', ''), '\D', '', 'g') ~ '^\d{10,13}$'
     order by e.i limit 1
  )
  select case
    when exists (select 1 from fin) then (
      select jsonb_build_object(
        'telefone', regexp_replace(t->>'numero', '\D', '', 'g'),
        'nome', coalesce(nullif(btrim(split_part(coalesce(t->>'tipo', ''), '|', 2)), ''), w.name))
      from fin)
    when coalesce(w.contact_name, '') ilike '%financ%' and regexp_replace(coalesce(w.phone, ''), '\D', '', 'g') ~ '^\d{10,13}$' then
      jsonb_build_object('telefone', regexp_replace(w.phone, '\D', '', 'g'),
                         'nome', coalesce(nullif(btrim(regexp_replace(split_part(w.contact_name, '|', 1), '(?i)financeiro', '', 'g')), ''), w.name))
    else null end;
$$;
revoke execute on function public._fin_whats_cliente(workspaces) from public, anon, authenticated;

-- De-para: clientes com cobrança automática e SEM contato financeiro no WhatsApp.
create or replace function public.fin_clientes_sem_financeiro(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'cliente', w.name,
           'em_aberto', (select count(*) from lancamentos l where l.workspace_id = w.id and l.tipo = 'entrada' and l.situacao = 'em_aberto'))
           order by w.name), '[]'::jsonb) into v
    from workspaces w
   where w.org_id = p_org and not w.archived and w.cobranca_auto and _fin_whats_cliente(w) is null;
  return v;
end $$;
revoke execute on function public.fin_clientes_sem_financeiro(uuid) from public, anon;
grant execute on function public.fin_clientes_sem_financeiro(uuid) to authenticated;

notify pgrst, 'reload schema';
