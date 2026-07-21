-- 141_transferencia_vinculo.sql
-- Vínculo explícito de transferência entre contas: os 2 lançamentos (saída na
-- origem + entrada no destino) passam a compartilhar um transferencia_id.
-- É dinheiro mudando de conta, NÃO venda nem despesa (já excluído dos gráficos).
-- Idempotente.

alter table lancamentos add column if not exists transferencia_id uuid;
create index if not exists lancamentos_transferencia_id_idx on lancamentos (transferencia_id) where transferencia_id is not null;

-- ── Criar transferência: 2 lançamentos ligados, já realizados (movem o saldo) ──
create or replace function criar_transferencia(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_tid uuid := gen_random_uuid();
  v_origem uuid := nullif(p_data->>'conta_origem_id','')::uuid;
  v_destino uuid := nullif(p_data->>'conta_destino_id','')::uuid;
  v_val numeric := coalesce(nullif(p_data->>'valor','')::numeric, 0);
  v_data date := coalesce(nullif(p_data->>'data','')::date, current_date);
  v_desc text := nullif(p_data->>'descricao','');
  v_forma text := coalesce(nullif(p_data->>'forma_pagamento',''), 'transferencia');
  v_no text; v_nd text;  -- nomes das contas origem/destino
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if v_origem is null or v_destino is null then raise exception 'Escolha a conta de origem e a de destino'; end if;
  if v_origem = v_destino then raise exception 'Origem e destino têm que ser contas diferentes'; end if;
  if v_val <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  select nome into v_no from contas_financeiras where id = v_origem and org_id = p_org_id;
  select nome into v_nd from contas_financeiras where id = v_destino and org_id = p_org_id;
  if v_no is null or v_nd is null then raise exception 'Conta não encontrada nesta organização'; end if;

  -- Saída na conta de origem
  insert into lancamentos (
    org_id, tipo, origem_tipo, transferencia_id, contato_tipo, contato_nome,
    descricao, valor, valor_realizado, vencimento, competencia, data_liquidacao,
    situacao, conta_id, categoria, forma_pagamento, created_by
  ) values (
    p_org_id, 'saida', 'transferencia', v_tid, 'conta', v_nd,
    coalesce(v_desc, 'Transferência para ' || v_nd), v_val, v_val, v_data, v_data, v_data,
    'pago', v_origem, 'Transferência de Saída', v_forma, p_user_id
  );

  -- Entrada na conta de destino
  insert into lancamentos (
    org_id, tipo, origem_tipo, transferencia_id, contato_tipo, contato_nome,
    descricao, valor, valor_realizado, vencimento, competencia, data_liquidacao,
    situacao, conta_id, categoria, forma_pagamento, created_by
  ) values (
    p_org_id, 'entrada', 'transferencia', v_tid, 'conta', v_no,
    coalesce(v_desc, 'Transferência de ' || v_no), v_val, v_val, v_data, v_data, v_data,
    'recebido', v_destino, 'Transferência de Entrada', v_forma, p_user_id
  );

  return v_tid;
end; $$;

-- ── Excluir transferência: apaga os 2 lados de uma vez ──
-- Transferência é 'pago'/'recebido', que o delete_lancamento normal barra ("reabra a
-- baixa"). Aqui não há baixa a reabrir — o bloqueio real é só a conciliação bancária.
create or replace function excluir_transferencia(p_user_id uuid, p_transferencia_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_n int;
begin
  select org_id into v_org from lancamentos where transferencia_id = p_transferencia_id limit 1;
  if v_org is null then return jsonb_build_object('ok', true, 'escopo', 'nada'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if exists (
    select 1 from btg_conciliacao_itens i
    join lancamentos l on l.id = i.lancamento_id
    where l.transferencia_id = p_transferencia_id
  ) then raise exception 'Um lado da transferência está conciliado com o extrato. Desfaça a conciliação antes de excluir.'; end if;

  delete from lancamentos where transferencia_id = p_transferencia_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'escopo', 'transferencia', 'excluidos', v_n);
end; $$;

-- ── delete_lancamento: excluir um lado apaga o par (recria a função) ──
create or replace function delete_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare l record; v_bloqueio text; v_n int;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('ok', true, 'escopo', 'nada'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Transferência: apaga os dois lados (via a RPC dedicada, que trata o bloqueio certo).
  if l.transferencia_id is not null then
    return excluir_transferencia(p_user_id, l.transferencia_id);
  end if;

  v_bloqueio := _lancamento_bloqueio_exclusao(l.id);
  if v_bloqueio is not null then raise exception '%', v_bloqueio; end if;

  -- Documento (produção/mídia): estorna o faturamento inteiro.
  if l.origem_tipo in ('producao','midia') then
    select string_agg(distinct b, ' ') into v_bloqueio from (
      select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
      where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo and l2.origem_id = l.origem_id
    ) t where b is not null;
    if v_bloqueio is not null then
      raise exception 'Outra parcela deste documento já foi movimentada: %', v_bloqueio;
    end if;

    delete from lancamentos
     where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;
    get diagnostics v_n = row_count;

    if l.origem_tipo = 'producao' then
      update producao set situacao = 'faturar', updated_at = now() where id = l.origem_id;
    else
      update midias   set situacao = 'faturar', updated_at = now() where id = l.origem_id;
    end if;

    return jsonb_build_object('ok', true, 'escopo', 'documento', 'excluidos', v_n);
  end if;

  delete from lancamentos where id = p_lancamento_id;
  return jsonb_build_object('ok', true, 'escopo', 'lancamento', 'excluidos', 1);
end; $function$;

-- ── Backfill: liga os pares já existentes (apenas os inequívocos) ──
-- Grupo por (org, competência, |valor|) com EXATAMENTE 1 entrada + 1 saída de
-- categoria Transferência e ainda sem vínculo. Pares ambíguos (2+2 no mesmo dia/valor)
-- ficam de fora de propósito — vincular errado seria pior.
do $$
declare r record; v_tid uuid;
begin
  for r in
    select org_id, competencia, abs(valor) as v
    from lancamentos
    where lower(coalesce(categoria,'')) like 'transfer%' and transferencia_id is null
    group by org_id, competencia, abs(valor)
    having count(*) filter (where tipo='entrada') = 1
       and count(*) filter (where tipo='saida')   = 1
  loop
    v_tid := gen_random_uuid();
    update lancamentos set transferencia_id = v_tid
    where org_id = r.org_id and competencia = r.competencia and abs(valor) = r.v
      and lower(coalesce(categoria,'')) like 'transfer%' and transferencia_id is null;
  end loop;
end $$;

grant execute on function criar_transferencia(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function excluir_transferencia(uuid,uuid) to anon, authenticated;
grant execute on function delete_lancamento(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
