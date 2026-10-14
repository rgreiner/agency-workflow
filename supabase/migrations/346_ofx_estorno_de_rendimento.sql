-- Estorno de rendimento entra sozinho, como o rendimento.
--
-- O BTG às vezes devolve o centavo de rendimento que creditou ("ESTORNO DO VALOR
-- DE RENDIMENTO", débito). A importação só tratava rendimento a CRÉDITO; o
-- estorno caía na fila de conciliação, alguém o ignorava (02/10) ou lançava à mão
-- (10/10, como tarifa), e o saldo ficava R$ 0,01 acima do banco. Medido em
-- 14/10/2026: era exatamente o centavo que sobrava na conta BTG.
--
-- Corpo idêntico ao que estava no ar (pg_get_functiondef), + o ramo do débito.

create or replace function public.importar_ofx(p_org_id uuid, p_conta_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; v_btgid text; v_tipo text; v_valor numeric; v_lanc uuid; v_mov uuid;
  v_inserted int := 0; v_total int := 0; v_futuros int := 0;
begin
  if not (fin_can(p_org_id) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    fitid text, data_mov date, valor numeric, tipo text, descricao text
  ) loop
    v_total := v_total + 1;
    if r.fitid is null or r.data_mov is null or r.valor is null then continue; end if;

    -- Lançamento com data futura é agendamento do banco, não extrato. Fica de
    -- fora e é CONTADO, para a tela poder dizer o que não entrou — import que
    -- descarta em silêncio é pior que import que não descarta.
    if r.data_mov > current_date then
      v_futuros := v_futuros + 1;
      continue;
    end if;

    v_btgid := 'ofx:' || p_conta_id::text || ':' || r.fitid;
    if exists (select 1 from btg_movements where org_id = p_org_id and btg_id = v_btgid) then continue; end if;  -- dedup
    v_tipo := case when r.tipo in ('credit','debit') then r.tipo when r.valor < 0 then 'debit' else 'credit' end;
    v_valor := abs(r.valor);

    if eh_transferencia_interna(r.descricao) then
      -- varredura interna da conta remunerada: se anula, não concilia
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, categoria, status, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'Transferência interna', 'ignorado', jsonb_build_object('fitid', r.fitid));

    elsif v_tipo = 'credit' and eh_rendimento(r.descricao) then
      -- rendimento: cria a receita e concilia automaticamente
      insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria, centro_custo)
      values (p_org_id, 'entrada', 'ofx', 'Rendimento', v_valor, r.data_mov, r.data_mov, 'em_aberto', p_conta_id, 'Rendimentos',
              fin_centro_padrao(p_org_id))
      returning id into v_lanc;
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, categoria, status, lancamento_id, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'Rendimentos', 'conciliado', v_lanc, jsonb_build_object('fitid', r.fitid))
      returning id into v_mov;
      insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor) values (p_org_id, v_mov, v_lanc, v_valor);
      perform _recompute_lanc_conciliacao(v_lanc);

    elsif v_tipo = 'debit' and eh_rendimento(r.descricao) then
      -- estorno de rendimento ("ESTORNO DO VALOR DE RENDIMENTO"): o banco tira
      -- de volta o centavo que creditou. Mesma régua do crédito, com sinal
      -- trocado: vira saída em Rendimentos, que abate o rendimento na DRE.
      insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria, centro_custo)
      values (p_org_id, 'saida', 'ofx', 'Estorno de rendimento', v_valor, r.data_mov, r.data_mov, 'em_aberto', p_conta_id, 'Rendimentos',
              fin_centro_padrao(p_org_id))
      returning id into v_lanc;
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, categoria, status, lancamento_id, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'Rendimentos', 'conciliado', v_lanc, jsonb_build_object('fitid', r.fitid))
      returning id into v_mov;
      insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor) values (p_org_id, v_mov, v_lanc, v_valor);
      perform _recompute_lanc_conciliacao(v_lanc);

    else
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, status, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'pendente', jsonb_build_object('fitid', r.fitid));
    end if;

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_total - v_inserted - v_futuros,
    'futuros', v_futuros,
    'total', v_total);
end; $function$;

revoke execute on function importar_ofx(uuid, uuid, jsonb) from public, anon;
grant execute on function importar_ofx(uuid, uuid, jsonb) to authenticated;

-- O estorno de 02/10 que ficou ignorado: vira o lançamento que a regra nova teria criado.
do $$
declare m record; v_lanc uuid;
begin
  for m in select * from btg_movements
            where tipo = 'debit' and status = 'ignorado' and lancamento_id is null
              and eh_rendimento(descricao) and not eh_transferencia_interna(descricao)
  loop
    insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria, centro_custo)
    values (m.org_id, 'saida', 'ofx', 'Estorno de rendimento', m.valor, m.data_mov, m.data_mov, 'em_aberto', m.conta_id, 'Rendimentos',
            fin_centro_padrao(m.org_id))
    returning id into v_lanc;
    insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor) values (m.org_id, m.id, v_lanc, m.valor);
    update btg_movements set status = 'conciliado', categoria = 'Rendimentos', lancamento_id = v_lanc,
           conciliado_modo = 'auto', conciliado_em = now(), updated_at = now() where id = m.id;
    perform _recompute_lanc_conciliacao(v_lanc);
  end loop;
end $$;

notify pgrst, 'reload schema';
