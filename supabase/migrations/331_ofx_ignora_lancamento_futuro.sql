-- OFX com lançamento futuro: extrato é o que ACONTECEU.
--
-- A Cresol manda, no mesmo OFX, as parcelas de empréstimo ainda por debitar.
-- Medido em 05/10/2026, logo depois do primeiro import dessa conta: de 6
-- movimentos, 2 estavam no futuro — 15/10 (R$ 7.620,74) e 15/11 (R$ 5.355,98) —
-- e entraram como 'pendente', isto é, disponíveis para conciliar. Conciliar um
-- deles baixaria um lançamento contra dinheiro que não saiu da conta.
--
-- E havia um segundo estrago, mais silencioso: o dedup é por FITID
-- ('ofx:<conta>:<fitid>'). Quando a parcela DE VERDADE aparecer no extrato do
-- mês que vem, ou ela repete o FITID — e é descartada como duplicata, deixando
-- a linha agendada no lugar do fato — ou traz outro, e ficam duas linhas para
-- um pagamento só. Nos dois caminhos a conciliação fica errada.
--
-- Por isso o corte é na entrada, e não um status novo: a previsão do pagamento
-- já mora em `lancamentos` (é lá que o fluxo de caixa olha). O extrato não
-- precisa repeti-la, e o próximo OFX traz a linha quando ela for fato.

create or replace function importar_ofx(p_org_id uuid, p_conta_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $function$
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

-- DEFAULT PRIVILEGES deste banco dá EXECUTE a anon/authenticated em toda função
-- recriada; revogar de PUBLIC não toca nesses dois.
revoke execute on function importar_ofx(uuid, uuid, jsonb) from public, anon;
grant execute on function importar_ofx(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
