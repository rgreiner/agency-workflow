-- 373 — a conta do BTG está conciliada? (27/10/2026)
--
-- A Flávia só cobra cliente quando o BTG já foi conferido: enquanto há movimento
-- na fila ou o saldo do Flow difere do banco, ainda não se sabe se o boleto/Pix
-- foi pago. "Conciliada" = extrato (OFX) importado até o último dia útil anterior
-- a hoje + fila de pendentes vazia + diferença real zerada. Gate = fin_can.
create or replace function public.fin_btg_conciliado(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := fin_hoje();
  v_exigido date := v_hoje - 1;
  c record;
  v_motivo text;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  while not fin_dia_util(p_org, v_exigido) loop v_exigido := v_exigido - 1; end loop;

  select d.conta, d.saldo_banco_data, d.n_pendentes, d.diferenca_real into c
    from fin_divergencias(p_org) d
    join contas_financeiras cf on cf.id = d.conta_id
   where cf.nome ilike 'BTG%' and coalesce(cf.ativo, true)
   order by d.saldo_banco_data desc limit 1;

  if not found then
    v_motivo := 'sem extrato do BTG importado';
  elsif c.saldo_banco_data < v_exigido then
    v_motivo := 'extrato do BTG só vai até ' || to_char(c.saldo_banco_data, 'DD/MM') || ' (falta importar até ' || to_char(v_exigido, 'DD/MM') || ')';
  elsif c.n_pendentes > 0 then
    v_motivo := c.n_pendentes || ' movimento(s) do BTG ainda sem conciliar';
  elsif abs(c.diferenca_real) >= 0.01 then
    v_motivo := 'saldo do Flow difere do banco em R$ ' || to_char(abs(c.diferenca_real), 'FM999G999D00');
  end if;

  return jsonb_build_object('ok', v_motivo is null, 'motivo', v_motivo,
                            'extrato_ate', c.saldo_banco_data, 'exigido_ate', v_exigido,
                            'pendentes', coalesce(c.n_pendentes, 0));
end $$;
revoke execute on function public.fin_btg_conciliado(uuid) from public, anon;
grant execute on function public.fin_btg_conciliado(uuid) to authenticated;

notify pgrst, 'reload schema';
