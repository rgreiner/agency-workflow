-- 260_espelho_lista_mesma_regua.sql
-- A LISTA de espelhos (RH → Espelho) somava `saldo_min` CRU dos dias — o valor
-- gravado na batida, que não conhece a tolerância do resumo (223), o abono por
-- período (212), nem rejeitada/dispensado (259), e ainda mistura o saldo dos
-- dias importados. Caso medido: Heloisa com +2:42 no espelho individual e
-- −5:55 na lista (Σ dos gravados = −355: os dias abonados entravam como falta
-- cheia).
--
-- Era a TERCEIRA cópia da régua — e réguas duplicadas são a causa-raiz dessa
-- série de divergências. O saldo da lista agora vem do RESUMO do próprio
-- rh_espelho (fonte única); os contadores (dias, pendentes, almoço curto,
-- ajustados) seguem da leitura direta, que para eles é exata. Idempotente.

create or replace function rh_espelho_lista(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_out jsonb := '[]'::jsonb; c record;
  v_dias int; v_pend int; v_int int; v_aj int; v_saldo int;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  for c in
    select co.id, co.nome, co.cargo, co.membro_user_id, co.bate_ponto
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

    -- Mesma régua do espelho individual — nunca recalcular aqui.
    v_saldo := coalesce((
      (rh_espelho(p_org_id, c.id, p_competencia))->'resumo'->>'saldo_min')::int, 0);

    v_out := v_out || jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'tem_login', c.membro_user_id is not null,
      'bate_ponto', coalesce(c.bate_ponto, true),
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
