-- 211_rh_espelho_lista_bate_ponto.sql
-- A lista de espelhos passa a dizer quem é dispensado de bater ponto, para o
-- RH não ficar procurando marcação de quem nunca teve jornada. Complementa a
-- 209/210 — só expõe o flag, não muda cálculo nenhum.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.rh_espelho_lista(p_org_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           count(*) filter (where p.ajuste_em is not null),
           coalesce(sum(p.saldo_min), 0)
      into v_dias, v_pend, v_int, v_aj, v_saldo
      from rh_ponto p
     where p.colaborador_id = c.id and p.data between v_ini and v_fim;

    v_out := v_out || jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'tem_login', c.membro_user_id is not null,
      'bate_ponto', coalesce(c.bate_ponto, true),
      'dias_com_ponto', coalesce(v_dias, 0), 'extras_pendentes', coalesce(v_pend, 0),
      'intervalo_curto', coalesce(v_int, 0), 'ajustados', coalesce(v_aj, 0),
      'saldo_min', coalesce(v_saldo, 0));
  end loop;

  return jsonb_build_object('ini', v_ini, 'fim', v_fim,
    'competencia', to_char(p_competencia, 'YYYY-MM'), 'colaboradores', v_out);
end; $function$

;

notify pgrst, 'reload schema';
