-- 149_rh_folha_financeiro.sql
-- RH Fase 2: reconciliação da folha com o Financeiro. Gera até 3 lançamentos
-- "a pagar" por competência: Salários (líquido, venc dia 30), INSS e FGTS (das
-- guias, venc dia 20 do mês seguinte). Idempotente por origem_ref (uma corrente
-- por competência): reprocessar atualiza o que está em aberto; se já foi PAGO,
-- não mexe (não duplica). Idempotente.

create or replace function rh_gerar_lancamentos_folha(
  p_org_id uuid, p_competencia date,
  p_salarios numeric, p_venc_salarios date,
  p_inss numeric, p_venc_inss date,
  p_fgts numeric, p_venc_fgts date
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_comp text := to_char(p_competencia, 'YYYY-MM');
  v_compbr text := to_char(p_competencia, 'MM/YYYY');
  v_ger int := 0;
  r record;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  for r in
    select * from (values
      ('sal',  'Salários',       'Folha — Salários '  || v_compbr, p_salarios, p_venc_salarios),
      ('inss', 'Encargos - INSS','Folha — INSS '      || v_compbr, p_inss,     p_venc_inss),
      ('fgts', 'Encargos - FGTS','Folha — FGTS '      || v_compbr, p_fgts,     p_venc_fgts)
    ) as t(corrente, categoria, descricao, valor, venc)
  loop
    if coalesce(r.valor, 0) <= 0 or r.venc is null then continue; end if;

    -- Já existe a corrente desta competência?
    perform 1 from lancamentos
      where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = 'folha:' || v_comp || ':' || r.corrente;

    if found then
      -- Atualiza só se ainda está em aberto (não mexer em algo já pago/conciliado).
      update lancamentos set
        valor = r.valor, vencimento = r.venc, competencia = p_competencia,
        descricao = r.descricao, categoria = r.categoria, updated_at = now()
      where org_id = p_org_id and origem_tipo = 'folha'
        and origem_ref = 'folha:' || v_comp || ':' || r.corrente
        and situacao = 'em_aberto';
      if found then v_ger := v_ger + 1; end if;
    else
      insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
        descricao, valor, vencimento, competencia, situacao, categoria, forma_pagamento, created_by)
      values (p_org_id, 'saida', 'folha', 'folha:' || v_comp || ':' || r.corrente, 'outro', 'Folha de pagamento',
        r.descricao, r.valor, r.venc, p_competencia, 'em_aberto', r.categoria, 'transferencia', auth.uid());
      v_ger := v_ger + 1;
    end if;
  end loop;

  return jsonb_build_object('gerados', v_ger);
end; $$;

revoke execute on function rh_gerar_lancamentos_folha(uuid,date,numeric,date,numeric,date,numeric,date) from public;
grant execute on function rh_gerar_lancamentos_folha(uuid,date,numeric,date,numeric,date,numeric,date) to authenticated;

notify pgrst, 'reload schema';
