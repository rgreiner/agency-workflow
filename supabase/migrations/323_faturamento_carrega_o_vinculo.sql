-- ── O faturamento passa a carregar o vínculo até o lançamento ───────────────
--
-- 01/10/2026. A migration 322 deu ao lançamento um `contato_id` e recuperou 78
-- vínculos que existiam no documento de origem. Esta faz com que os PRÓXIMOS
-- nasçam vinculados, em vez de precisarem de backfill.
--
-- As três RPCs já resolviam o cadastro — a da mídia até lia
-- `detalhe->>'producao_fornecedor_id'`, e as de produção leem
-- `detalhe->>'fornecedor_id'` — mas gravavam só o NOME. O id era descartado na
-- última linha do caminho, que é onde ele passa a valer.
--
-- Definições copiadas de produção com `pg_get_functiondef` e alteradas só no
-- necessário: variável para o id, o id no INSERT. Nada de lógica de negócio
-- mudou.

CREATE OR REPLACE FUNCTION public.gerar_lancamento_midia(p_midia_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text, p_centro_custo text DEFAULT NULL::text, p_forma text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record;
  v_comissao numeric(14,2);
  v_venc date;
  v_pagador text; v_ct text; v_cn text; v_cid uuid;
  v_prod_total numeric(14,2); v_prod_comissao numeric(14,2);
  v_prod_ct text; v_prod_cn text; v_forn_nome text; v_prod_cid uuid; v_forn_id uuid;
  v_cat text; v_centro text;
begin
  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome
    into m
    from midias mi
    join workspaces w on w.id = mi.workspace_id
    left join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = p_midia_id;
  if not found then return; end if;
  if m.situacao <> 'faturado' then return; end if;

  if m.veiculo_id is null then
    raise exception 'A mídia % não tem veículo — sem veículo não dá para gerar o lançamento da comissão. Informe o veículo na mídia e fature de novo.',
      coalesce(nullif(concat_ws(' ', m.serie, m.numero), ''), m.titulo, p_midia_id::text)
      using errcode = '23502';
  end if;

  v_cat    := coalesce(p_categoria, 'Comissão');
  v_centro := coalesce(p_centro_custo, m.cliente_nome);

  v_venc := _midia_vencimento(m.prazo, m.data_base, m.dias_agencia);

  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  -- Guarda o ID do cadastro, não só o nome: é o que dá rastreabilidade ao
  -- lançamento e o que a emissão da NFS-e usa para achar o tomador sem adivinhar.
  if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome; v_cid := m.veiculo_id;
  else v_ct := 'cliente'; v_cn := m.cliente_nome; v_cid := m.workspace_id; end if;

  -- (1) Comissão da VEICULAÇÃO.
  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  if not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id
       and coalesce(origem_parte,'veiculacao') = 'veiculacao'
  ) then
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_id, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'veiculacao', v_ct, v_cid, v_cn,
      'Desconto Padrão Agência', v_comissao, v_venc, m.data_base, 'em_aberto',
      p_conta_id, v_cat, v_centro, p_forma, m.created_by
    );
  end if;

  -- (2) Comissão da PRODUÇÃO — só quando há valor e percentual informados.
  v_prod_total := round(
    _br_num(m.detalhe->>'producao_valor')
    * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2);
  v_prod_comissao := round(v_prod_total * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2);

  if v_prod_comissao > 0 and not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id and origem_parte = 'producao'
  ) then
    if coalesce(m.detalhe->>'producao_tipo', 'no_veiculo') = 'de_terceiros' then
      v_forn_id := nullif(m.detalhe->>'producao_fornecedor_id','')::uuid;
      select f.name into v_forn_nome from fornecedores f where f.id = v_forn_id;
      v_prod_ct  := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_prod_cn  := coalesce(v_forn_nome, m.veiculo_nome);
      v_prod_cid := coalesce(v_forn_id, m.veiculo_id);
    else
      v_prod_ct := 'veiculo'; v_prod_cn := m.veiculo_nome; v_prod_cid := m.veiculo_id;
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_id, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'producao', v_prod_ct, v_prod_cid, v_prod_cn,
      'Comissão de produção', v_prod_comissao, v_venc, m.data_base, 'em_aberto',
      p_conta_id, v_cat, v_centro, p_forma, m.created_by
    );
  end if;
end; $function$

;

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

CREATE OR REPLACE FUNCTION public.gerar_lancamentos_pedido(p_producao_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cid uuid; v_forn_id uuid;
  p record; forn_nome text; parc jsonb;
  v_tipo text; v_ct text; v_cn text; v_desc text;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo <> 'pedido' then return; end if;

  -- preserva lançamentos já liquidados
  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;
  if p.situacao <> 'faturado' then return; end if;

  v_forn_id := nullif(p.detalhe->>'fornecedor_id','')::uuid;
  select name into forn_nome from fornecedores where id = v_forn_id;

  for parc in select * from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) loop
    v_tipo := parc->>'tipo';
    if v_tipo = 'receber_bv' then
      -- O ID vai junto com o nome: é ele que torna o lançamento rastreável até
      -- o cadastro, e é por ele que a emissão da NFS-e acha o tomador.
      v_ct := 'fornecedor'; v_cn := coalesce(forn_nome, 'Fornecedor'); v_cid := v_forn_id; v_desc := 'Comissão BV';
    elsif v_tipo = 'receber_honorarios' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_cid := p.workspace_id; v_desc := 'Honorários';
    else
      continue;  -- cliente_paga_fornecedor não é lançado no Financeiro
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_id, contato_nome,
      descricao, valor, vencimento, competencia, situacao, created_by
    ) values (
      p.org_id, 'entrada', 'producao', p_producao_id, v_ct, v_cid, v_cn,
      v_desc, coalesce(nullif(parc->>'valor','')::numeric, 0), nullif(parc->>'vencimento','')::date,
      p.emissao, 'em_aberto', p.created_by
    );
  end loop;
end; $function$

;

-- Backfill do que sobrou: pedido de produção, cujo fornecedor mora no `detalhe`.
update lancamentos l
   set contato_tipo = 'fornecedor',
       contato_id   = nullif(p.detalhe->>'fornecedor_id','')::uuid
  from producao p
 where p.id = l.origem_id and l.origem_tipo = 'producao'
   and l.contato_tipo = 'fornecedor' and l.contato_id is null
   and nullif(p.detalhe->>'fornecedor_id','') is not null;

update lancamentos l
   set contato_tipo = 'cliente', contato_id = p.workspace_id
  from producao p
 where p.id = l.origem_id and l.origem_tipo = 'producao'
   and l.contato_tipo = 'cliente' and l.contato_id is null
   and p.workspace_id is not null;

-- ⚠️ DEFAULT PRIVILEGES: todo `create or replace` reabre a função para anon.
revoke execute on function gerar_lancamento_midia(uuid, uuid, text, text, text) from public, anon;
revoke execute on function gerar_lancamentos_producao(uuid, uuid, text, text, text) from public, anon;
revoke execute on function gerar_lancamentos_pedido(uuid) from public, anon;

notify pgrst, 'reload schema';
