-- 046_fee_lancamentos.sql
-- Generaliza a geração de lançamentos da Produção para cobrir também o FEE.
-- Tipos de parcela: receber_bv (fornecedor), receber_honorarios (cliente),
-- receber_cliente (cliente, usado no Fee), cliente_paga_fornecedor (não lança).
-- Idempotente.

create or replace function gerar_lancamentos_producao(p_producao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p record; forn_nome text; parc jsonb;
  v_tipo text; v_ct text; v_cn text; v_desc text;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee') then return; end if;

  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;
  if p.situacao <> 'faturado' then return; end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;

  for parc in select * from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) loop
    v_tipo := parc->>'tipo';
    if v_tipo = 'receber_bv' then
      v_ct := 'fornecedor'; v_cn := coalesce(forn_nome, 'Fornecedor'); v_desc := 'Comissão BV';
    elsif v_tipo = 'receber_honorarios' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := 'Honorários';
    elsif v_tipo = 'receber_cliente' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := coalesce(nullif(p.titulo,''), 'Fee');
    else
      continue;
    end if;
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao, created_by
    ) values (
      p.org_id, 'entrada', 'producao', p_producao_id, v_ct, v_cn,
      v_desc, coalesce(nullif(parc->>'valor','')::numeric, 0), nullif(parc->>'vencimento','')::date,
      nullif(parc->>'vencimento','')::date, 'em_aberto', p.created_by
    );
  end loop;
end; $$;

create or replace function set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update producao set situacao = p_situacao, updated_at = now() where id = p_producao_id;
  perform gerar_lancamentos_producao(p_producao_id);
end; $$;

grant execute on function gerar_lancamentos_producao(uuid) to anon, authenticated;
grant execute on function set_producao_situacao(uuid,uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';
