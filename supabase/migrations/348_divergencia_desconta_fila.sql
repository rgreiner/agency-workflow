-- Divergência banco × Flow descontando a FILA de conciliação.
--
-- Logo depois de importar o OFX, os movimentos novos estão 'pendente': o banco
-- já tem o dinheiro, o Flow só terá quando forem conciliados. Isso é trabalho do
-- dia, não erro — e se acendesse o vermelho a cada import, o vermelho deixaria
-- de ser lido. Separa-se:
--   diferenca      = saldo Flow − saldo banco (bruta, na data do extrato)
--   pendente       = líquido dos movimentos ainda na fila até essa data
--   diferenca_real = diferenca + pendente → o que NÃO se explica pela fila.
--                    É esta que grita.
-- O "desde" passa a olhar a mesma régua (banco sem a fila).

drop function if exists fin_divergencias(uuid, boolean);

create or replace function _fin_desde_divergencia(p_conta uuid)
returns date
language plpgsql stable security definer set search_path = public as $$
declare c record; v_ini date; d date; v_ultimo_ok date; v_banco numeric; v_pend numeric; v_flow numeric;
begin
  select id, saldo_banco, saldo_banco_data into c from contas_financeiras where id = p_conta;
  if c.saldo_banco is null then return null; end if;
  select min(data_mov) into v_ini from btg_movements where conta_id = p_conta;
  if v_ini is null then return null; end if;

  for d in
    select x.d from (
      select v_ini - 1 as d
      union select data_mov from btg_movements where conta_id = p_conta and data_mov between v_ini and c.saldo_banco_data
      union select coalesce(data_liquidacao, vencimento) from lancamentos
             where conta_id = p_conta and situacao in ('pago','recebido')
               and coalesce(data_liquidacao, vencimento) between v_ini and c.saldo_banco_data
    ) x order by x.d
  loop
    -- banco no fim do dia d, sem o que ainda está na fila até d
    select c.saldo_banco - coalesce(sum(case when tipo = 'debit' then -abs(valor) else abs(valor) end), 0)
      into v_banco from btg_movements where conta_id = p_conta and data_mov > d and data_mov <= c.saldo_banco_data;
    select coalesce(sum(case when tipo = 'debit' then -abs(valor) else abs(valor) end), 0)
      into v_pend from btg_movements where conta_id = p_conta and status = 'pendente' and data_mov <= d;
    v_flow := fin_saldo_em(p_conta, d);
    if abs(v_flow - (v_banco - v_pend)) < 0.005 then v_ultimo_ok := d; end if;
  end loop;

  if v_ultimo_ok is null then return v_ini; end if;
  return (
    select min(x.d) from (
      select data_mov as d from btg_movements where conta_id = p_conta and data_mov > v_ultimo_ok and status <> 'pendente'
      union select coalesce(data_liquidacao, vencimento) from lancamentos
             where conta_id = p_conta and situacao in ('pago','recebido') and coalesce(data_liquidacao, vencimento) > v_ultimo_ok
    ) x
  );
end $$;
revoke execute on function _fin_desde_divergencia(uuid) from public, anon, authenticated;

create or replace function fin_divergencias(p_org uuid, p_detalhe boolean default false)
returns table (conta_id uuid, conta text, saldo_banco numeric, saldo_banco_data date, saldo_flow numeric,
               diferenca numeric, pendente numeric, n_pendentes int, diferenca_real numeric, desde date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
    select c.id, c.nome, c.saldo_banco, c.saldo_banco_data, s.v,
           round(s.v - c.saldo_banco, 2),
           round(p.liq, 2), p.n,
           round(s.v - c.saldo_banco + p.liq, 2),
           case when p_detalhe and abs(s.v - c.saldo_banco + p.liq) >= 0.005 then _fin_desde_divergencia(c.id) end
      from contas_financeiras c
      cross join lateral (select fin_saldo_em(c.id, c.saldo_banco_data) as v) s
      cross join lateral (
        select coalesce(sum(case when b.tipo = 'debit' then -abs(b.valor) else abs(b.valor) end), 0) as liq,
               count(*)::int as n
          from btg_movements b
         where b.conta_id = c.id and b.status = 'pendente' and b.data_mov <= c.saldo_banco_data
      ) p
     where c.org_id = p_org and c.saldo_banco is not null and c.saldo_banco_data is not null
       and coalesce(c.ativo, true);
end $$;
revoke execute on function fin_divergencias(uuid, boolean) from public, anon;
grant execute on function fin_divergencias(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
