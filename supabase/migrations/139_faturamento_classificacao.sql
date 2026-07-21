-- 139_faturamento_classificacao.sql
-- Faturar passa a gravar centro de custo / categoria / conta / forma no lançamento.
-- Hoje as geradoras inserem esses 4 campos NULL — é a origem dos lançamentos sem
-- centro que travam o gráfico. Rafael decidiu preencher NA TELA de Faturamento.
--
-- Os 4 params entram OPCIONAIS (default null): quem chama sem eles (re-sync,
-- mudança de status na tela de Produção) não quebra, e as geradoras PRESERVAM a
-- classificação já existente em vez de zerá-la. Ordem de resolução:
--   valor da tela  ->  o que já estava no lançamento  ->  default inteligente.
--
-- PostgREST é estrito com overload (1 assinatura por RPC). Como a assinatura muda,
-- é DROP + CREATE (não CREATE OR REPLACE). Idempotente via `drop ... if exists`.

drop function if exists gerar_lancamento_midia(uuid);
drop function if exists lancar_midia(uuid, uuid);
drop function if exists gerar_lancamentos_producao(uuid);
drop function if exists set_producao_situacao(uuid, uuid, text);

-- ── Mídia: comissão de veiculação (+ produção) ────────────────────────────────
create function gerar_lancamento_midia(
  p_midia_id uuid,
  p_conta_id uuid default null, p_categoria text default null,
  p_centro_custo text default null, p_forma text default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  m record;
  v_comissao numeric(14,2);
  v_venc date;
  v_pagador text; v_ct text; v_cn text;
  v_prod_total numeric(14,2); v_prod_comissao numeric(14,2);
  v_prod_ct text; v_prod_cn text; v_forn_nome text;
  v_cat text; v_centro text;   -- classificação resolvida (categoria/centro)
begin
  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome
    into m
    from midias mi
    join workspaces w on w.id = mi.workspace_id
    join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = p_midia_id;
  if not found then return; end if;
  if m.situacao <> 'faturado' then return; end if;

  -- categoria da comissão = 'Comissão'; centro (fonte de receita) = o CLIENTE.
  v_cat    := coalesce(p_categoria, 'Comissão');
  v_centro := coalesce(p_centro_custo, m.cliente_nome);

  v_venc := _midia_vencimento(m.prazo, m.data_base, m.dias_agencia);

  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome;
  else v_ct := 'cliente'; v_cn := m.cliente_nome; end if;

  -- (1) Comissão da VEICULAÇÃO.
  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  if not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id
       and coalesce(origem_parte,'veiculacao') = 'veiculacao'
  ) then
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'veiculacao', v_ct, v_cn,
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
      select f.name into v_forn_nome from fornecedores f
       where f.id = nullif(m.detalhe->>'producao_fornecedor_id','')::uuid;
      v_prod_ct := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_prod_cn := coalesce(v_forn_nome, m.veiculo_nome);
    else
      v_prod_ct := 'veiculo'; v_prod_cn := m.veiculo_nome;
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'producao', v_prod_ct, v_prod_cn,
      'Comissão de produção', v_prod_comissao, v_venc, m.data_base, 'em_aberto',
      p_conta_id, v_cat, v_centro, p_forma, m.created_by
    );
  end if;
end; $function$;

create function lancar_midia(
  p_user_id uuid, p_midia_id uuid,
  p_conta_id uuid default null, p_categoria text default null,
  p_centro_custo text default null, p_forma text default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = 'faturado' where id = p_midia_id;
  perform gerar_lancamento_midia(p_midia_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $function$;

-- ── Produção: Fee / Pedido (parcelas a receber) ───────────────────────────────
create function gerar_lancamentos_producao(
  p_producao_id uuid,
  p_conta_id uuid default null, p_categoria text default null,
  p_centro_custo text default null, p_forma text default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  p record; forn_nome text;
  v_ex_conta uuid; v_ex_centro text; v_ex_forma text;  -- classificação já existente
  v_conta uuid; v_centro text; v_forma text;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  -- Preserva conta/centro/forma já gravados (só a tela de Faturamento os define; o
  -- modal de Lançamentos é read-only p/ origem 'producao'). Sem isso, uma mudança de
  -- status na tela de Produção — que chama sem os 4 params — zeraria a classificação.
  select conta_id, centro_custo, forma_pagamento
    into v_ex_conta, v_ex_centro, v_ex_forma
    from lancamentos
    where origem_tipo = 'producao' and origem_id = p_producao_id
    order by parcela_num nulls first limit 1;

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
    case when x.rn = 1 then coalesce(p.anexos, '[]'::jsonb) else '[]'::jsonb end,
    case when x.total > 1 then x.rn::int end,
    case when x.total > 1 then x.total::int end,
    v_conta,
    -- categoria por PARCELA: comissão sempre 'Comissão'; o resto usa o valor da tela
    -- (p_categoria) e cai no default pelo tipo do documento quando a tela não mandou.
    case x.ptipo
      when 'receber_bv'         then 'Comissão'
      when 'receber_honorarios' then coalesce(p_categoria, 'Receitas de Serviços')
      else coalesce(p_categoria, case p.tipo when 'fee' then 'Fee' when 'pedido' then 'Job' else 'Produção' end)
    end,
    v_centro, v_forma, p.created_by
  from (
    select b.*,
           row_number() over (partition by b.descr order by b.venc nulls last, b.ord) as rn,
           count(*)     over (partition by b.descr)                                   as total
      from (
        select
          e.parc->>'tipo' as ptipo,
          case e.parc->>'tipo'
            when 'receber_bv'         then 'fornecedor'
            else                           'cliente'
          end as ct,
          case e.parc->>'tipo'
            when 'receber_bv'         then coalesce(forn_nome, 'Fornecedor')
            else                           p.cliente_nome
          end as cn,
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
end; $function$;

create function set_producao_situacao(
  p_user_id uuid, p_producao_id uuid, p_situacao text,
  p_conta_id uuid default null, p_categoria text default null,
  p_centro_custo text default null, p_forma text default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if p_situacao in ('faturar','faturado') and exists (
    select 1 from producao where id = p_producao_id and tipo = 'fee'
      and jsonb_array_length(coalesce(detalhe->'parcelas','[]'::jsonb)) = 0
  ) then raise exception 'Gere as parcelas do Fee antes de aprovar (é o que vira o faturamento).'; end if;

  update producao set situacao = p_situacao, updated_at = now() where id = p_producao_id;
  perform gerar_lancamentos_producao(p_producao_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $function$;

grant execute on function gerar_lancamento_midia(uuid,uuid,text,text,text) to anon, authenticated;
grant execute on function lancar_midia(uuid,uuid,uuid,text,text,text) to anon, authenticated;
grant execute on function gerar_lancamentos_producao(uuid,uuid,text,text,text) to anon, authenticated;
grant execute on function set_producao_situacao(uuid,uuid,text,uuid,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
