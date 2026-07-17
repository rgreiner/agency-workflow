-- 121_ofx_rendimento_lancamento.sql
-- Rendimento diário da conta remunerada do BTG ("VALOR DE RENDIMENTO REMUNERA+") é
-- receita real (centavos/dia). No import do OFX ele vira automaticamente um lançamento
-- de entrada categoria 'Rendimentos', já conciliado com o movimento (o saldo bate sozinho,
-- sem clique manual). Transferências internas seguem ignoradas (120). Idempotente.

create or replace function eh_rendimento(p_desc text)
returns boolean language sql immutable as $$
  select coalesce(p_desc, '') ~* 'rendimento';
$$;

create or replace function importar_ofx(p_org_id uuid, p_conta_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v_btgid text; v_tipo text; v_valor numeric; v_lanc uuid; v_mov uuid;
  v_inserted int := 0; v_total int := 0;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    fitid text, data_mov date, valor numeric, tipo text, descricao text
  ) loop
    v_total := v_total + 1;
    if r.fitid is null or r.data_mov is null or r.valor is null then continue; end if;
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
      insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria)
      values (p_org_id, 'entrada', 'ofx', 'Rendimento', v_valor, r.data_mov, r.data_mov, 'em_aberto', p_conta_id, 'Rendimentos')
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

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_total - v_inserted, 'total', v_total);
end; $$;

grant execute on function eh_rendimento(text) to anon, authenticated;
grant execute on function importar_ofx(uuid, uuid, jsonb) to anon, authenticated;

-- Retroage: rendimentos JÁ importados que ficaram pendentes viram lançamento conciliado.
-- Idempotente (depois viram 'conciliado' e não recaem no filtro).
do $$
declare mv record; v_lanc uuid;
begin
  for mv in select * from btg_movements
            where fonte = 'ofx' and status = 'pendente' and tipo = 'credit' and eh_rendimento(descricao) loop
    insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria)
    values (mv.org_id, 'entrada', 'ofx', 'Rendimento', mv.valor, mv.data_mov, mv.data_mov, 'em_aberto', mv.conta_id, 'Rendimentos')
    returning id into v_lanc;
    insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor) values (mv.org_id, mv.id, v_lanc, mv.valor);
    update btg_movements set status = 'conciliado', lancamento_id = v_lanc, categoria = 'Rendimentos', updated_at = now() where id = mv.id;
    perform _recompute_lanc_conciliacao(v_lanc);
  end loop;
end $$;

notify pgrst, 'reload schema';
