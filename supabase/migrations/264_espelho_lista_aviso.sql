-- 264_espelho_lista_aviso.sql
-- A lista de espelhos etiqueta quem está EM AVISO PRÉVIO (migs. 262/263) —
-- estado derivado da ficha, não um status novo: a pessoa segue ativa e
-- batendo ponto até o último dia; o chip explica por que a carga dela caiu.
-- Idempotente.

create or replace function rh_espelho_lista(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_out jsonb := '[]'::jsonb; c record;
  v_dias int; v_pend int; v_int int; v_aj int; v_saldo int; v_aviso_ate date;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  for c in
    select co.id, co.nome, co.cargo, co.membro_user_id, co.bate_ponto,
           co.aviso_previo_ini, co.aviso_previo_fim, co.aviso_previo_modo, co.data_demissao
    from rh_colaborador co
    where co.org_id = p_org_id and not co.arquivado and co.status <> 'desligado'
    order by co.nome
  loop
    select count(*) filter (where p.minutos > 0),
           count(*) filter (where p.extra_status = 'pendente'),
           count(*) filter (where p.intervalo_ok = false),
           count(*) filter (where p.ajuste_em is not null)
      into v_dias, v_pend, v_int, v_aj
      from rh_ponto p
     where p.colaborador_id = c.id and p.data between v_ini and v_fim;

    -- Mesma régua do espelho individual — nunca recalcular aqui (mig. 260).
    v_saldo := coalesce((
      (rh_espelho(p_org_id, c.id, p_competencia))->'resumo'->>'saldo_min')::int, 0);

    -- Em aviso HOJE (fim = último dia próprio, fallback demissão).
    v_aviso_ate := case
      when c.aviso_previo_modo is not null and c.aviso_previo_ini is not null
           and current_date >= c.aviso_previo_ini
           and current_date <= coalesce(c.aviso_previo_fim, c.data_demissao)
      then coalesce(c.aviso_previo_fim, c.data_demissao) end;

    v_out := v_out || jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'tem_login', c.membro_user_id is not null,
      'bate_ponto', coalesce(c.bate_ponto, true),
      'aviso_ate', v_aviso_ate, 'aviso_modo', case when v_aviso_ate is not null then c.aviso_previo_modo end,
      'dias_com_ponto', coalesce(v_dias, 0), 'extras_pendentes', coalesce(v_pend, 0),
      'intervalo_curto', coalesce(v_int, 0), 'ajustados', coalesce(v_aj, 0),
      'saldo_min', v_saldo);
  end loop;

  return jsonb_build_object('ini', v_ini, 'fim', v_fim,
    'competencia', to_char(p_competencia, 'YYYY-MM'), 'colaboradores', v_out);
end; $$;
revoke execute on function rh_espelho_lista(uuid, date) from public, anon;
grant  execute on function rh_espelho_lista(uuid, date) to authenticated;

notify pgrst, 'reload schema';
