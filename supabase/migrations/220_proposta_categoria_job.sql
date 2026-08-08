-- 220_proposta_categoria_job.sql
-- "A categoria esperada é Job lá no financeiro." (Rafael, 05/08)
--
-- A proposta faturada nela mesma (job: cobrança pelas parcelas, sem gerar
-- mídia/produção/fee) caía no `else` do default e virava "Produção". A tela de
-- Faturamento já classifica certo — `fee ? 'Fee' : 'Job'` —, mas quem marca a
-- situação direto no formulário da proposta não passa por lá, e aí valia o
-- default do banco.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.gerar_lancamentos_producao(p_producao_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text, p_centro_custo text DEFAULT NULL::text, p_forma text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p record; forn_nome text;
  v_ex_conta uuid; v_ex_centro text; v_ex_forma text; v_ex_categoria text;
  v_conta uuid; v_centro text; v_forma text; v_anexos jsonb;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  -- NÃO regenerar (não destruir) se qualquer parcela já tem baixa: total (recebido/pago)
  -- OU PARCIAL (valor_realizado > 0). A parcial estava desprotegida — o delete apagava a
  -- baixa e, por cascade, a conciliação bancária.
  if exists (
    select 1 from lancamentos
    where origem_tipo = 'producao' and origem_id = p_producao_id
      and (situacao in ('recebido','pago') or coalesce(valor_realizado, 0) > 0)
  ) then return; end if;

  -- Preserva a classificação já gravada (conta/centro/forma/categoria). Só a tela de
  -- Faturamento a define; uma mudança de status na tela de Produção chama sem os params
  -- e, sem isto, zeraria a classificação de volta ao default.
  select conta_id, centro_custo, forma_pagamento
    into v_ex_conta, v_ex_centro, v_ex_forma
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
    order by parcela_num nulls first limit 1;
  -- categoria: de uma parcela NÃO-comissão (a que o usuário classifica; a comissão é sempre 'Comissão').
  select categoria into v_ex_categoria
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
      and categoria is distinct from 'Comissão'
    order by parcela_num nulls first limit 1;
  -- anexos por parcela (NF/boleto anexados nas parcelas 2..N não somem na regen).
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
    x.valor, x.venc, x.venc, 'em_aberto',
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
      else coalesce(p_categoria, v_ex_categoria, case p.tipo when 'fee' then 'Fee' when 'pedido' then 'Job' when 'proposta' then 'Job' else 'Produção' end)
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
            else coalesce(nullif(p.titulo,''), case when p.tipo = 'fee' then 'Fee' else 'Proposta' end)
          end as descr,
          coalesce(nullif(e.parc->>'valor','')::numeric, 0) as valor,
          nullif(e.parc->>'vencimento','')::date            as venc,
          e.ord
        from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb))
             with ordinality as e(parc, ord)
        where e.parc->>'tipo' in ('receber_bv','receber_honorarios','receber_cliente')
      ) b
  ) x;
end; $function$

;

-- Corrige o que já nasceu com a categoria errada.
update lancamentos l set categoria = 'Job'
  from producao p
 where p.id = l.origem_id and l.origem_tipo = 'producao'
   and p.tipo = 'proposta' and l.categoria = 'Produção';

notify pgrst, 'reload schema';
