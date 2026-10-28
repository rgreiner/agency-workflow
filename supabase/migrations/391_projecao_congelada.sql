-- 391 — projeção congelada no PP (28/10/2026)
--
-- Ao gerar os PPs de um orçamento, o item do PP guarda `projecao` (o que o histórico
-- dizia naquele dia) e `orcado_unit` (a opção escolhida). O histórico devolve isso
-- junto com a margem do PP (comissão + honorários) para o quadro "Projeção × custo
-- real" medir o erro registrado na época e quanto a margem cobriu.

create or replace function public.cotacao_historico(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_precos jsonb; v_forn jsonb;
begin
  if not is_org_member(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  with opc as (
    select p.id as producao_id, null::uuid as origem_orcamento_id, p.situacao, p.created_at::date as data,
           nullif(btrim(coalesce(p.serie, '') || ' ' || coalesce(p.numero::text, '')), '') as documento,
           (i.ord - 1)::int as item_idx, btrim(i.it->>'nome') as nome, left(btrim(coalesce(i.it->>'descricao', '')), 240) as descricao,
           nullif(o.op->>'fornecedor_id', '')::uuid as fornecedor_id,
           greatest(coalesce(nullif(regexp_replace(coalesce(o.op->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1) as quant,
           coalesce(_num_digitado(o.op->>'valor_unit'),
                    _num_digitado(o.op->>'valor_total') / greatest(coalesce(nullif(regexp_replace(coalesce(o.op->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1)) as unit,
           coalesce((o.op->>'selecionado')::boolean, false) as escolhido,
           o.op ? 'cotacao_convite_id' as de_cotacao,
           null::jsonb as projecao, null::numeric as orcado_unit, null::numeric as margem_pct
      from producao p,
           jsonb_array_elements(coalesce(p.detalhe->'itens', '[]'::jsonb)) with ordinality i(it, ord),
           jsonb_array_elements(coalesce(i.it->'opcoes', '[]'::jsonb)) o(op)
     where p.org_id = p_org and p.tipo = 'orcamento' and not p.archived
  ), ped as (
    select p.id as producao_id, p.origem_orcamento_id, 'pedido' as situacao, coalesce(p.emissao, p.created_at::date) as data,
           nullif(btrim(coalesce(p.serie, '') || ' ' || coalesce(p.numero::text, '')), '') as documento,
           (i.ord - 1)::int as item_idx, btrim(i.it->>'nome') as nome, left(btrim(coalesce(i.it->>'descricao', '')), 240) as descricao,
           nullif(p.detalhe->>'fornecedor_id', '')::uuid as fornecedor_id,
           greatest(coalesce(nullif(regexp_replace(coalesce(i.it->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1) as quant,
           coalesce(_num_digitado(i.it->>'valor'),
                    _num_digitado(i.it->>'valor_total') / greatest(coalesce(nullif(regexp_replace(coalesce(i.it->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1)) as unit,
           true as escolhido, false as de_cotacao,
           case when jsonb_typeof(i.it->'projecao') = 'object' then i.it->'projecao' end as projecao,
           nullif(i.it->>'orcado_unit', '')::numeric as orcado_unit,
           coalesce(p.bv_pct, 0) + coalesce(p.honorarios_pct, 0) as margem_pct
      from producao p, jsonb_array_elements(coalesce(p.detalhe->'itens', '[]'::jsonb)) with ordinality i(it, ord)
     where p.org_id = p_org and p.tipo = 'pedido' and not p.archived and p.situacao <> 'cancelado'
  ), tudo as (
    select * from opc union all select * from ped
  ), validos as (
    select t.* from tudo t
     where t.fornecedor_id is not null and t.unit is not null and t.unit > 0 and coalesce(t.nome, '') <> ''
       and t.nome !~* '^teste'
  ), menor as (
    -- "Melhor preço": no mesmo item e quantidade de um orçamento, o menor unitário entre ≥ 2 fornecedores.
    select v.*, v.unit = min(v.unit) over (partition by v.producao_id, v.item_idx, v.quant)
                and count(*) over (partition by v.producao_id, v.item_idx, v.quant) > 1 as mais_barato
      from validos v
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producao_id', m.producao_id, 'origem_orcamento_id', m.origem_orcamento_id, 'tipo', nullif(btrim(f.tipo), ''), 'documento', m.documento, 'situacao', m.situacao, 'data', m.data,
           'nome', m.nome, 'descricao', m.descricao, 'fornecedor_id', m.fornecedor_id, 'fornecedor', f.name,
           'quant', m.quant, 'unit', round(m.unit, 4), 'escolhido', m.escolhido, 'mais_barato', m.mais_barato,
           'projecao', m.projecao, 'orcado_unit', m.orcado_unit, 'margem_pct', m.margem_pct)
           order by m.data desc), '[]'::jsonb)
    into v_precos
    from menor m join fornecedores f on f.id = m.fornecedor_id;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_forn from (
    select f.id as fornecedor_id,
           (select count(*) from cotacao_convites c where c.fornecedor_id = f.id) as convidados,
           (select count(*) from cotacao_convites c where c.fornecedor_id = f.id and c.respondido_em is not null) as responderam,
           (select round(avg(extract(epoch from (c.respondido_em - coalesce(c.email_enviado_em, c.whatsapp_em, c.created_at))) / 3600)::numeric, 1)
              from cotacao_convites c where c.fornecedor_id = f.id and c.respondido_em is not null) as horas_resposta,
           (select count(*) from producao p where p.org_id = p_org and p.tipo = 'pedido' and not p.archived
               and p.situacao <> 'cancelado' and p.detalhe->>'fornecedor_id' = f.id::text) as pedidos
      from fornecedores f where f.org_id = p_org and not f.archived
  ) t where t.convidados > 0 or t.pedidos > 0;

  return jsonb_build_object('precos', v_precos, 'fornecedores', v_forn);
end $$;

notify pgrst, 'reload schema';
