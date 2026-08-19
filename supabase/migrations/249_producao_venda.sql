-- 249_producao_venda.sql
-- Receita de Venda (série RV): a comissão que um cliente paga à agência sobre o
-- que ELE vende. Entra como mais um `tipo` de `producao` — não como tabela nova —
-- para herdar de graça a numeração por série, a fila do Faturamento, o
-- lançamento a receber e a lixeira/arquivamento.
--
-- Modelo (o mesmo do pedido, para não inventar semântica):
--   valor        = valor da VENDA do cliente no período (a base)
--   bv_pct       = % de comissão da agência sobre essa base
--   detalhe.parcelas = 1 parcela `receber_cliente` com o valor da comissão
--   detalhe.mes_venda = 'YYYY-MM' — o mês a que a venda se refere
--
-- Idempotente.

-- ── 1. Série RV ──────────────────────────────────────────────────────────────
create or replace function serie_de_producao(p_tipo text)
returns text language sql immutable as $$
  select case p_tipo
    when 'pedido'   then 'PP'
    when 'fee'      then 'FEE'
    when 'proposta' then 'PR'
    when 'venda'    then 'RV'
    else null
  end;
$$;

-- Começa em 1: não veio do Siga, é documento novo. `greatest` no conflito para
-- que re-rodar a migration nunca rebobine um contador que já avançou.
insert into doc_series (org_id, serie, prefixo, label, proximo_numero)
select o.id, 'RV', 'RV', 'Receita de Venda', 1
from organizations o
where exists (select 1 from producao p where p.org_id = o.id)
on conflict (org_id, serie) do update
  set proximo_numero = greatest(doc_series.proximo_numero, excluded.proximo_numero),
      label          = excluded.label,
      prefixo        = excluded.prefixo,
      updated_at     = now();

-- ── 2. Lançamento a receber da venda ─────────────────────────────────────────
-- Base: a definição EM PRODUÇÃO (144 + 220). Três mudanças, todas aditivas:
--   a) `venda` entra na lista de tipos que geram lançamento;
--   b) a parcela pode carregar `competencia` própria — é o mês da VENDA, que não
--      é o mês do vencimento (venda de julho vence em agosto). Sem isso a
--      Análise por competência jogaria a comissão no mês errado. Parcela sem a
--      chave continua caindo no vencimento, como sempre foi;
--   c) categoria padrão da venda = "Receitas de Vendas" (já existe no cadastro).
create or replace function public.gerar_lancamentos_producao(
  p_producao_id uuid, p_conta_id uuid default null, p_categoria text default null,
  p_centro_custo text default null, p_forma text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  p record; forn_nome text;
  v_ex_conta uuid; v_ex_centro text; v_ex_forma text; v_ex_categoria text;
  v_conta uuid; v_centro text; v_forma text; v_anexos jsonb;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta', 'venda') then return; end if;

  -- NÃO regenerar (não destruir) se qualquer parcela já tem baixa: total (recebido/pago)
  -- OU PARCIAL (valor_realizado > 0).
  if exists (
    select 1 from lancamentos
    where origem_tipo = 'producao' and origem_id = p_producao_id
      and (situacao in ('recebido','pago') or coalesce(valor_realizado, 0) > 0)
  ) then return; end if;

  -- Preserva a classificação já gravada (conta/centro/forma/categoria).
  select conta_id, centro_custo, forma_pagamento
    into v_ex_conta, v_ex_centro, v_ex_forma
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
    order by parcela_num nulls first limit 1;
  select categoria into v_ex_categoria
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
      and categoria is distinct from 'Comissão'
    order by parcela_num nulls first limit 1;
  select jsonb_object_agg(coalesce(parcela_num, 1)::text, anexos) into v_anexos
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
      and anexos is not null and anexos <> '[]'::jsonb;

  v_conta  := coalesce(p_conta_id, v_ex_conta);
  v_centro := coalesce(p_centro_custo, v_ex_centro, p.cliente_nome);
  v_forma  := coalesce(p_forma, v_ex_forma);

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;

  if p.situacao <> 'faturado' then return; end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;

  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
    descricao, valor, vencimento, competencia, situacao, anexos,
    parcela_num, parcela_total, conta_id, categoria, centro_custo, forma_pagamento, created_by
  )
  select
    p.org_id, 'entrada', 'producao', p_producao_id, x.ct, x.cn, x.descr,
    x.valor, x.venc, coalesce(x.comp, x.venc), 'em_aberto',
    -- anexos: reusa os que existiam naquela parcela; senão, doc na 1ª parcela.
    coalesce(
      v_anexos -> coalesce((case when x.total > 1 then x.rn::int end), 1)::text,
      case when x.rn = 1 then coalesce(p.anexos, '[]'::jsonb) else '[]'::jsonb end
    ),
    case when x.total > 1 then x.rn::int end,
    case when x.total > 1 then x.total::int end,
    v_conta,
    case x.ptipo
      when 'receber_bv'         then 'Comissão'
      when 'receber_honorarios' then coalesce(p_categoria, v_ex_categoria, 'Receitas de Serviços')
      else coalesce(p_categoria, v_ex_categoria, case p.tipo
             when 'fee' then 'Fee' when 'pedido' then 'Job' when 'proposta' then 'Job'
             when 'venda' then 'Receitas de Vendas' else 'Produção' end)
    end,
    v_centro, v_forma, p.created_by
  from (
    select b.*,
           row_number() over (partition by b.descr order by b.venc nulls last, b.ord) as rn,
           count(*)     over (partition by b.descr)                                   as total
      from (
        select
          e.parc->>'tipo' as ptipo,
          case e.parc->>'tipo' when 'receber_bv' then 'fornecedor' else 'cliente' end as ct,
          case e.parc->>'tipo' when 'receber_bv' then coalesce(forn_nome, 'Fornecedor') else p.cliente_nome end as cn,
          case e.parc->>'tipo'
            when 'receber_bv'          then 'Comissão'
            when 'receber_honorarios'  then 'Honorários'
            else coalesce(nullif(p.titulo,''), case p.tipo
                   when 'fee' then 'Fee' when 'venda' then 'Receita de venda' else 'Proposta' end)
          end as descr,
          coalesce(nullif(e.parc->>'valor','')::numeric, 0) as valor,
          nullif(e.parc->>'vencimento','')::date            as venc,
          nullif(e.parc->>'competencia','')::date           as comp,
          e.ord
        from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb))
             with ordinality as e(parc, ord)
        where e.parc->>'tipo' in ('receber_bv','receber_honorarios','receber_cliente')
      ) b
  ) x;
end; $function$;

notify pgrst, 'reload schema';
