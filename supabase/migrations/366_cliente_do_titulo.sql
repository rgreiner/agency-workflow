-- 366 — de quem é a PP/MX? (para a Flávia repassar ao CLIENTE a NF e o boleto que o
-- fornecedor mandou — fluxo da Erika: "Nota fiscal pedido 1927" para a Evolua)
create or replace function public.fin_cliente_do_titulo(p_lancamento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb; v_org uuid;
begin
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null or not fin_can(v_org) then raise exception 'Título não encontrado'; end if;
  select jsonb_build_object(
           'workspace_id', w.id, 'cliente', w.name,
           'email', coalesce(nullif(btrim(w.finance_email), ''),
                    (select lower(btrim(e->>'email')) from jsonb_array_elements(coalesce(w.emails, '[]'::jsonb)) e
                      where coalesce(e->>'email', '') like '%@%' order by (coalesce(e->>'tipo', '') ilike '%financ%') desc limit 1)),
           'contato_nome', nullif(btrim(split_part(coalesce((select t->>'tipo' from jsonb_array_elements(coalesce(w.telefones, '[]'::jsonb)) t where coalesce(t->>'tipo','') ilike '%financ%' limit 1), ''), '|', 2)), ''),
           'documento', nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), ''))
    into v
    from lancamentos l
    join lancamentos_doc d on d.id = l.id
    left join producao p on l.origem_tipo = 'producao' and p.id = l.origem_id
    left join midias m   on l.origem_tipo = 'midia' and m.id = l.origem_id
    join workspaces w on w.id = coalesce(p.workspace_id, m.workspace_id)
   where l.id = p_lancamento_id;
  return v;
end $$;
revoke execute on function public.fin_cliente_do_titulo(uuid) from public, anon;
grant execute on function public.fin_cliente_do_titulo(uuid) to authenticated;

notify pgrst, 'reload schema';
