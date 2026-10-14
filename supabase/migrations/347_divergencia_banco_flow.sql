-- Diferença entre o Flow e o banco tem que GRITAR no dia em que nasce.
--
-- Contexto (14/10/2026): R$ 12 mil de diferença no BTG ficaram seis semanas
-- parados (conciliação parcial) e R$ 0,01 duas (estorno de rendimento ignorado).
-- O número "Difere em R$ X" existia na tela da conta, mas comparava o saldo do
-- banco NA DATA DO EXTRATO com o saldo do Flow de HOJE — qualquer baixa feita
-- depois do último OFX virava falso alarme, e alarme falso ensina a não olhar.
--
-- Aqui:
--  1. fin_saldo_em(conta, data): o saldo do Flow numa data (mesma fórmula de
--     contas_saldo, cortada no dia).
--  2. fin_divergencias(org, detalhe): por conta com OFX, saldo do banco × saldo do
--     Flow NA MESMA DATA, e — com detalhe — desde quando a diferença existe.
--  3. "Ignorar" só para o que se anula (aplicação/resgate da conta remunerada).
--     Ignorar dinheiro que mexeu na conta é o jeito mais curto de abrir diferença;
--     o resto se lança e concilia (botão "Lançar e conciliar").

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function fin_saldo_em(p_conta uuid, p_data date)
returns numeric
language sql stable security definer set search_path = public as $$
  select round(
    c.saldo_inicial
    + coalesce((select sum(e.valor) from extrato_importado e
                 where e.org_id = c.org_id and e.conta = c.nome
                   and e.situacao in ('Conciliado','Quitado','Transferido')
                   and e.data_mov <= p_data), 0)
    + coalesce((select sum(case when l.tipo = 'saida' then -coalesce(l.valor_realizado, l.valor)
                                else coalesce(l.valor_realizado, l.valor) end)
                  from lancamentos l
                 where l.org_id = c.org_id and l.conta_id = c.id
                   and l.situacao in ('pago','recebido')
                   and coalesce(l.data_liquidacao, l.vencimento) <= p_data
                   and (l.origem_ref is null or not exists (
                         select 1 from extrato_importado e
                          where e.org_id = l.org_id and e.import_ref = l.origem_ref
                            and e.situacao in ('Conciliado','Quitado','Transferido')))), 0)
  , 2)
  from contas_financeiras c where c.id = p_conta;
$$;
revoke execute on function fin_saldo_em(uuid, date) from public, anon, authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- Saldo do banco num dia d = saldo do último OFX − o que o banco movimentou
-- depois de d. Vale enquanto os OFX forem contínuos (dedup por FITID garante
-- que reimportar não duplica).
create or replace function _fin_desde_divergencia(p_conta uuid)
returns date
language plpgsql stable security definer set search_path = public as $$
declare c record; v_ini date; d date; v_ultimo_ok date; v_banco numeric; v_flow numeric;
begin
  select id, saldo_banco, saldo_banco_data into c from contas_financeiras where id = p_conta;
  if c.saldo_banco is null then return null; end if;
  select min(data_mov) into v_ini from btg_movements where conta_id = p_conta;
  if v_ini is null then return null; end if;

  -- Último dia em que os dois batiam; a diferença começa no primeiro dia com
  -- movimento depois dele. Só dias com movimento (de um lado ou do outro).
  for d in
    select x.d from (
      select v_ini - 1 as d
      union select data_mov from btg_movements where conta_id = p_conta and data_mov between v_ini and c.saldo_banco_data
      union select coalesce(data_liquidacao, vencimento) from lancamentos
             where conta_id = p_conta and situacao in ('pago','recebido')
               and coalesce(data_liquidacao, vencimento) between v_ini and c.saldo_banco_data
    ) x order by x.d
  loop
    select c.saldo_banco - coalesce(sum(case when tipo = 'debit' then -abs(valor) else abs(valor) end), 0)
      into v_banco from btg_movements where conta_id = p_conta and data_mov > d and data_mov <= c.saldo_banco_data;
    v_flow := fin_saldo_em(p_conta, d);
    if abs(v_flow - v_banco) < 0.005 then v_ultimo_ok := d; end if;
  end loop;

  if v_ultimo_ok is null then return v_ini; end if;
  return (
    select min(x.d) from (
      select data_mov as d from btg_movements where conta_id = p_conta and data_mov > v_ultimo_ok
      union select coalesce(data_liquidacao, vencimento) from lancamentos
             where conta_id = p_conta and situacao in ('pago','recebido') and coalesce(data_liquidacao, vencimento) > v_ultimo_ok
    ) x
  );
end $$;
revoke execute on function _fin_desde_divergencia(uuid) from public, anon, authenticated;

create or replace function fin_divergencias(p_org uuid, p_detalhe boolean default false)
returns table (conta_id uuid, conta text, saldo_banco numeric, saldo_banco_data date, saldo_flow numeric, diferenca numeric, desde date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
    select c.id, c.nome, c.saldo_banco, c.saldo_banco_data, s.v,
           round(s.v - c.saldo_banco, 2),
           case when p_detalhe and abs(s.v - c.saldo_banco) >= 0.005 then _fin_desde_divergencia(c.id) end
      from contas_financeiras c
      cross join lateral (select fin_saldo_em(c.id, c.saldo_banco_data) as v) s
     where c.org_id = p_org and c.saldo_banco is not null and c.saldo_banco_data is not null
       and coalesce(c.ativo, true);
end $$;
revoke execute on function fin_divergencias(uuid, boolean) from public, anon;
grant execute on function fin_divergencias(uuid, boolean) to authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function ignorar_btg_movimento(p_user_id uuid, p_movement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_desc text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id, descricao into v_org, v_desc from btg_movements where id = p_movement_id;
  if v_org is null then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Só se ignora o que se anula sozinho (aplicação/resgate da conta remunerada).
  -- Qualquer outro movimento é dinheiro que mexeu na conta: ignorá-lo abre uma
  -- diferença entre o Flow e o banco (foi o R$ 0,01 de 02/10/2026).
  if not eh_transferencia_interna(v_desc) then
    raise exception 'Este movimento mexeu no saldo do banco — ignorar abriria uma diferença com o Flow. Use "Lançar e conciliar".';
  end if;

  update btg_movements set status = 'ignorado', lancamento_id = null, updated_at = now()
  where id = p_movement_id;
end $$;
revoke execute on function ignorar_btg_movimento(uuid, uuid) from public, anon;
grant execute on function ignorar_btg_movimento(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
