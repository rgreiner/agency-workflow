-- 389 — histórico de cotações e preços para sugerir fornecedor e projetar custo (28/10/2026)
--
-- Pedido do Rafael: a sugestão do "Pedir cotação" deve pesar quem RESPONDE, quem é
-- mais APROVADO e quem tem os MELHORES PREÇOS; e o orçamento deve mostrar uma
-- projeção de custo a partir de itens parecidos já cotados.
--
-- Fontes (tudo que já existe, sem tabela nova):
--   • opções dos orçamentos (producao tipo 'orcamento', detalhe.itens[].opcoes[]) — escolhida = selecionado;
--   • pedidos (PP) — compra de fato: item, fornecedor do pedido, quantidade e valor unitário;
--   • convites de cotação — taxa e tempo de resposta.
-- A semelhança entre itens é calculada no navegador (palavras do nome/descrição).

-- Valor digitado em pt-BR ("1.234,56", "65,60") ou com ponto decimal ("1.40").
create or replace function public._num_digitado(p text)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' then null
    when btrim(p) ~ '^\d+\.\d{1,2}$' then btrim(p)::numeric
    else nullif(_br_num(p), 0)
  end;
$$;

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
    select p.id as producao_id, p.situacao, p.created_at::date as data,
           nullif(btrim(coalesce(p.serie, '') || ' ' || coalesce(p.numero::text, '')), '') as documento,
           (i.ord - 1)::int as item_idx, btrim(i.it->>'nome') as nome, left(btrim(coalesce(i.it->>'descricao', '')), 240) as descricao,
           nullif(o.op->>'fornecedor_id', '')::uuid as fornecedor_id,
           greatest(coalesce(nullif(regexp_replace(coalesce(o.op->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1) as quant,
           coalesce(_num_digitado(o.op->>'valor_unit'),
                    _num_digitado(o.op->>'valor_total') / greatest(coalesce(nullif(regexp_replace(coalesce(o.op->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1)) as unit,
           coalesce((o.op->>'selecionado')::boolean, false) as escolhido,
           o.op ? 'cotacao_convite_id' as de_cotacao
      from producao p,
           jsonb_array_elements(coalesce(p.detalhe->'itens', '[]'::jsonb)) with ordinality i(it, ord),
           jsonb_array_elements(coalesce(i.it->'opcoes', '[]'::jsonb)) o(op)
     where p.org_id = p_org and p.tipo = 'orcamento' and not p.archived
  ), ped as (
    select p.id as producao_id, 'pedido' as situacao, coalesce(p.emissao, p.created_at::date) as data,
           nullif(btrim(coalesce(p.serie, '') || ' ' || coalesce(p.numero::text, '')), '') as documento,
           (i.ord - 1)::int as item_idx, btrim(i.it->>'nome') as nome, left(btrim(coalesce(i.it->>'descricao', '')), 240) as descricao,
           nullif(p.detalhe->>'fornecedor_id', '')::uuid as fornecedor_id,
           greatest(coalesce(nullif(regexp_replace(coalesce(i.it->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1) as quant,
           coalesce(_num_digitado(i.it->>'valor'),
                    _num_digitado(i.it->>'valor_total') / greatest(coalesce(nullif(regexp_replace(coalesce(i.it->>'quant', ''), '\D', '', 'g'), '')::int, 1), 1)) as unit,
           true as escolhido, false as de_cotacao
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
           'producao_id', m.producao_id, 'documento', m.documento, 'situacao', m.situacao, 'data', m.data,
           'nome', m.nome, 'descricao', m.descricao, 'fornecedor_id', m.fornecedor_id, 'fornecedor', f.name,
           'quant', m.quant, 'unit', round(m.unit, 4), 'escolhido', m.escolhido, 'mais_barato', m.mais_barato)
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

revoke execute on function public._num_digitado(text) from public, anon;
revoke execute on function public.cotacao_historico(uuid) from public, anon;
grant execute on function public.cotacao_historico(uuid) to authenticated;

notify pgrst, 'reload schema';
