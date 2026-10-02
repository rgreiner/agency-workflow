-- ── A categoria escolhida ao faturar vale para TODAS as parcelas ────────────
--
-- 02/10/2026, relatado pelo Rafael: faturando uma PP e escolhendo "Produção",
-- o lançamento nasce com categoria "Comissão".
--
-- Causa: em `gerar_lancamentos_producao`, a parcela `receber_bv` tinha a
-- categoria FIXA em 'Comissão'. As outras duas (`receber_honorarios` e as
-- demais) já faziam `coalesce(p_categoria, …)` — só a do BV ignorava a escolha.
--
-- O padrão continua 'Comissão' quando ninguém escolhe. O que muda é a ordem:
-- escolha explícita > classificação já gravada > padrão. Silenciosamente trocar
-- o que a pessoa escolheu é pior que não oferecer a escolha.
--
-- Lançamentos já gerados não são tocados: a correção é refaturar o documento,
-- que regera as parcelas.

CREATE OR REPLACE FUNCTION public.gerar_lancamentos_producao(p_producao_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text, p_centro_custo text DEFAULT NULL::text, p_forma text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_forn_id uuid;
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

  v_forn_id := nullif(p.detalhe->>'fornecedor_id','')::uuid;
  select name into forn_nome from fornecedores where id = v_forn_id;

  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_id, contato_nome,
    descricao, valor, vencimento, competencia, situacao, anexos,
    parcela_num, parcela_total, conta_id, categoria, centro_custo, forma_pagamento, created_by
  )
  select
    p.org_id, 'entrada', 'producao', p_producao_id, x.ct, x.cid, x.cn, x.descr,
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
      -- A escolha de quem fatura vence o padrão. Antes a parcela de BV ficava
      -- com 'Comissão' fixa: o usuário escolhia Produção ao faturar a PP e o
      -- lançamento nascia Comissão, sem dizer que a escolha fora descartada.
      when 'receber_bv'         then coalesce(p_categoria, v_ex_categoria, 'Comissão')
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
          -- O id do cadastro ao lado do nome: comissão BV é do FORNECEDOR,
          -- honorários e fee são do CLIENTE. É o que dá rastreabilidade.
          case e.parc->>'tipo' when 'receber_bv' then v_forn_id else p.workspace_id end as cid,
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
end; $function$

;


-- ⚠️ DEFAULT PRIVILEGES: `create or replace` reabre a função para anon.
revoke execute on function gerar_lancamentos_producao(uuid, uuid, text, text, text) from public, anon;

notify pgrst, 'reload schema';
