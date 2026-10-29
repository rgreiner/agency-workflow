-- 392 — correções da revisão de 28/10/2026
--
-- 1) fin_cadastro_publico: a lista de "ativos" tinha NULL (lançamento/pedido sem
--    fornecedor vinculado) e a onda 2 vinha VAZIA — `f.id in (… NULL …)` dá NULL,
--    não false. Medido: onda 1 = 45, onda 2 = 0 antes da correção.
-- 2) _num_digitado é helper interno: fecha também para authenticated (regra da casa).

create or replace function fin_cadastro_publico(p_org uuid, p_onda int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  with ativos_brutos as (
    select contato_id as id from lancamentos where org_id = p_org and contato_tipo = 'fornecedor'
       and coalesce(vencimento, created_at::date) >= current_date - 540
    union select nullif(detalhe->>'fornecedor_id', '')::uuid from producao where org_id = p_org and created_at >= now() - interval '540 days'
    union select fornecedor_id from cotacao_convites where org_id = p_org and created_at >= now() - interval '540 days'
  ), ativos as (
    -- Sem NULL: um NULL na lista faz o "not in"/"in" da onda 2 dar NULL e esvaziar tudo.
    select id from ativos_brutos where id is not null
  )
  select coalesce(jsonb_agg(row_to_json(t) order by t.nome), '[]'::jsonb) into v from (
    select f.id as fornecedor_id, f.name as nome, f.tipo,
           (select lower(btrim(e->>'email')) from jsonb_array_elements(coalesce(f.emails, '[]')) with ordinality x(e, i)
             where coalesce(e->>'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
             order by (coalesce(e->>'tipo', '') ~* 'comerc|vend|orc') desc, i limit 1) as email,
           (select regexp_replace(t->>'numero', '\D', '', 'g') from jsonb_array_elements(coalesce(f.telefones, '[]')) with ordinality x(t, i)
             where regexp_replace(coalesce(t->>'numero', ''), '\D', '', 'g') ~ '^\d{10,13}$'
               and regexp_replace(t->>'numero', '\D', '', 'g') !~ '^(55)?\d{2}[2-5]\d{7}$'   -- fixo não recebe WhatsApp
             order by (coalesce(t->>'tipo', '') ~* 'whats|comerc|cel') desc, i limit 1) as whatsapp,
           nullif(btrim(split_part(coalesce((select t->>'tipo' from jsonb_array_elements(coalesce(f.telefones, '[]')) t
                                             where coalesce(t->>'tipo', '') like '%|%' limit 1), ''), '|', 2)), '') as contato_nome,
           f.id in (select id from ativos) as ativo
      from fornecedores f
     where f.org_id = p_org and not f.archived
       and (p_onda = 2 or f.id in (select id from ativos))
       and not (p_onda = 2 and f.id in (select id from ativos))
       and not exists (select 1 from fornecedor_cadastro_convites c where c.fornecedor_id = f.id and (c.enviado_em is not null or c.respondido_em is not null))
  ) t where t.email is not null or t.whatsapp is not null;
  return v;
end $$;

revoke execute on function public._num_digitado(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
