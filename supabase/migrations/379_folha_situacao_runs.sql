-- 379 — situação da folha mostra os fechamentos da competência (27/10/2026)
--
-- O Rafael fechou outubro na tela e o que falta é o "Enviar para a contabilidade".
-- A Flávia precisa ver o fechamento FECHADO e não enviado (e quem está nele) para
-- propor só o envio. Mesma assinatura da 378 (create or replace, grants mantidos).

create or replace function public.fin_folha_situacao(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_hoje date := fin_hoje();
  v_comp date := date_trunc('month', v_hoje)::date;
  v_ini date; v_fim date; v_mes_ini date; v_mes_fim date;
  v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org, v_comp);
  if v_fim >= v_hoje then  -- ciclo do mês ainda correndo: a folha da vez é a do anterior
    v_comp := (v_comp - interval '1 month')::date;
    select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org, v_comp);
  end if;
  v_mes_ini := v_comp;
  v_mes_fim := (v_comp + interval '1 month - 1 day')::date;

  select jsonb_build_object(
    'competencia', to_char(v_comp, 'YYYY-MM'), 'ini', v_ini, 'fim', v_fim,
    'dias_uteis_mes', (select count(*) from generate_series(v_mes_ini, v_mes_fim, '1 day') d where fin_dia_util(p_org, d::date)),
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'vinculo', c.tipo_vinculo,
        'admissao', c.data_admissao, 'demissao', c.data_demissao, 'status', c.status,
        'fechado', exists (select 1 from rh_fechamento_run r join rh_fechamento_run_linha l on l.run_id = r.id
                            where r.org_id = p_org and r.competencia = v_comp and r.status <> 'reaberto' and l.colaborador_id = c.id),
        'run_id', (select r.id from rh_fechamento_run r join rh_fechamento_run_linha l on l.run_id = r.id
                    where r.org_id = p_org and r.competencia = v_comp and r.status <> 'reaberto' and l.colaborador_id = c.id limit 1),
        'dias_uteis_mes', (select count(*) from generate_series(greatest(coalesce(c.data_admissao, v_mes_ini), v_mes_ini),
                                                               least(coalesce(c.data_demissao, v_mes_fim), v_mes_fim), '1 day') d
                            where fin_dia_util(p_org, d::date))
      ) order by c.nome)
        from rh_colaborador c
       where c.org_id = p_org and not c.arquivado and coalesce(c.entra_fechamento, true)
         and coalesce(c.data_admissao, v_ini) <= v_fim
         and (c.status <> 'desligado' or c.data_demissao >= v_ini)), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'sem_envio', r.sem_envio, 'enviado_em', r.enviado_em,
               'fechado_em', r.fechado_em, 'nomes', (select jsonb_agg(l.nome order by l.nome) from rh_fechamento_run_linha l where l.run_id = r.id))
               order by r.fechado_em)
        from rh_fechamento_run r where r.org_id = p_org and r.competencia = v_comp and r.status <> 'reaberto'), '[]'::jsonb),
    'justificativas_pendentes', coalesce((
      select jsonb_agg(jsonb_build_object('nome', c.nome, 'data', j.data_ini, 'tipo', j.tipo) order by j.data_ini)
        from rh_justificativa j join rh_colaborador c on c.id = j.colaborador_id
       where j.org_id = p_org and j.status = 'pendente' and j.data_ini <= v_fim and j.data_fim >= v_ini), '[]'::jsonb),
    'ultimo_envio', (
      select jsonb_build_object('competencia', to_char(r.competencia, 'YYYY-MM'), 'vr_valor', r.vr_valor, 'vt_valor', r.vt_valor, 'corpo', r.corpo,
             'dias_uteis_mes', (select count(*) from generate_series(r.competencia, (r.competencia + interval '1 month - 1 day')::date, '1 day') d where fin_dia_util(p_org, d::date)))
        from rh_fechamento_run r
       where r.org_id = p_org and r.status = 'enviado' and r.vr_valor is not null
       order by r.enviado_em desc limit 1)
  ) into v;
  return v;
end $fn$;
revoke execute on function public.fin_folha_situacao(uuid) from public, anon;
grant execute on function public.fin_folha_situacao(uuid) to authenticated;

notify pgrst, 'reload schema';
