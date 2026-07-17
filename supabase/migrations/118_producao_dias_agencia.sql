-- 118_producao_dias_agencia.sql
-- Comissão de produção (receber_bv/receber_honorarios) tem DUAS datas: a cobrança
-- (data da parcela) e o recebimento pela agência = cobrança + "dias agência"
-- (padrão 7, configurável por documento em detalhe.dias_agencia). O lançamento no
-- fluxo de caixa passa a cair na data prevista da agência. Fee/cobrança direta
-- (receber_cliente) segue com uma data só. Competência = data da cobrança.
-- Idempotente (create or replace).

create or replace function gerar_lancamentos_producao(p_producao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p record; forn_nome text; parc jsonb;
  v_tipo text; v_ct text; v_cn text; v_desc text;
  v_dias int; v_comp date; v_venc date;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;

  if p.situacao <> 'faturado' then return; end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;
  v_dias := coalesce(nullif(p.detalhe->>'dias_agencia','')::int, 7);

  for parc in select * from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) loop
    v_tipo := parc->>'tipo';
    v_comp := nullif(parc->>'vencimento','')::date;   -- competência = data da cobrança
    if v_tipo = 'receber_bv' then
      v_ct := 'fornecedor'; v_cn := coalesce(forn_nome, 'Fornecedor'); v_desc := 'Comissão';
      v_venc := v_comp + v_dias;                        -- comissão cai +dias no caixa
    elsif v_tipo = 'receber_honorarios' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := 'Honorários';
      v_venc := v_comp + v_dias;
    elsif v_tipo = 'receber_cliente' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := coalesce(nullif(p.titulo,''), case when p.tipo='fee' then 'Fee' else 'Proposta' end);
      v_venc := v_comp;                                 -- fee/direto: sem dias agência
    else
      continue;
    end if;
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao, anexos, created_by
    ) values (
      p.org_id, 'entrada', 'producao', p_producao_id, v_ct, v_cn,
      v_desc, coalesce(nullif(parc->>'valor','')::numeric, 0), v_venc,
      v_comp, 'em_aberto', coalesce(p.anexos, '[]'::jsonb), p.created_by
    );
  end loop;
end; $$;

grant execute on function gerar_lancamentos_producao(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
