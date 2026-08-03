-- 166_rh_espelho_ponto.sql
-- Espelho de ponto: a tela onde o RH valida DIA A DIA o ciclo atual.
-- Traz, por dia: marcações, o registro ORIGINAL, a justificativa, quem aprovou e o
-- que foi modificado — e permite o RH editar o dia (com trilha de auditoria).
--
-- Faltava: (a) o RH não tinha como corrigir um dia direto (só pelo caminho da
-- justificativa) e (b) rh_ponto.ajuste_de guarda só a PRIMEIRA marcação original,
-- não o histórico de alterações. Aqui entra o log completo.
-- Idempotente.

-- ── Trilha de auditoria de cada alteração no dia ──
create table if not exists rh_ponto_log (
  id         uuid primary key default gen_random_uuid(),
  ponto_id   uuid not null references rh_ponto(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  acao       text not null,               -- edicao_rh | ajuste_justificativa
  antes      jsonb,                       -- ['08:35','12:01',…]
  depois     jsonb,
  motivo     text,
  por        uuid,
  em         timestamptz not null default now()
);
create index if not exists rh_ponto_log_ponto_idx on rh_ponto_log (ponto_id, em desc);
alter table rh_ponto_log enable row level security;
drop policy if exists rh_ponto_log_rw on rh_ponto_log;
create policy rh_ponto_log_rw on rh_ponto_log for all using (
  rh_can(org_id) or exists (select 1 from rh_ponto p where p.id = ponto_id and rh_is_self(p.colaborador_id))
) with check (rh_can(org_id));

-- ── RH edita as marcações de um dia ──
-- p_horas: ['08:35','12:01','13:30','18:02'] (lista completa, em ordem). [] limpa o dia.
create or replace function rh_editar_ponto(
  p_org_id uuid, p_colaborador_id uuid, p_data date, p_horas jsonb, p_motivo text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare p rh_ponto; v_antes jsonb; v_h text; v_i int := 0;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da alteração'; end if;

  insert into rh_ponto (org_id, colaborador_id, data) values (p_org_id, p_colaborador_id, p_data)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = p_data;
  if p.org_id <> p_org_id then raise exception 'Registro de outra organização'; end if;

  -- Dia importado é o registro legal do sistema anterior: não se edita por aqui.
  if p.origem is not null then
    raise exception 'Dia importado do %. Histórico importado não é editável.', p.origem;
  end if;

  select coalesce(jsonb_agg(to_char(hora, 'HH24:MI') order by seq), '[]'::jsonb)
    into v_antes from rh_marcacao where ponto_id = p.id;

  delete from rh_marcacao where ponto_id = p.id;
  for v_h in select jsonb_array_elements_text(coalesce(p_horas, '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into rh_marcacao (ponto_id, hora, seq, origem) values (p.id, v_h::time, v_i, 'ajuste');
  end loop;

  -- Preserva a PRIMEIRA versão original (não sobrescreve a trilha em edições seguintes).
  update rh_ponto set
    ajuste_de = coalesce(ajuste_de, jsonb_build_object('marcacoes', v_antes)),
    ajuste_por = auth.uid(), ajuste_em = now(), updated_at = now()
  where id = p.id;

  insert into rh_ponto_log (ponto_id, org_id, acao, antes, depois, motivo, por)
  values (p.id, p_org_id, 'edicao_rh', v_antes, coalesce(p_horas, '[]'::jsonb), btrim(p_motivo), auth.uid());

  perform rh_recalc_ponto(p.id);
  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object('minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok);
end; $$;
revoke execute on function rh_editar_ponto(uuid, uuid, date, jsonb, text) from public;
grant execute on function rh_editar_ponto(uuid, uuid, date, jsonb, text) to authenticated;

-- ── Espelho: TODOS os dias do ciclo de um colaborador, com tudo que aconteceu ──
create or replace function rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_dias jsonb := '[]'::jsonb; d date;
  c record; j rh_jornada; p rh_ponto; v_marc jsonb; v_fer record; v_just record;
  v_log jsonb; v_por text; v_esp boolean; v_carga int;
  v_hn int := 0; v_falta int := 0; v_ex int := 0;
begin
  if not (rh_can(p_org_id) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);
  select id, nome, cargo, cpf into c from rh_colaborador where id = p_colaborador_id and org_id = p_org_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  j := rh_jornada_de(p_colaborador_id);

  d := v_ini;
  while d <= v_fim loop
    select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = d;

    select coalesce(jsonb_agg(to_char(hora, 'HH24:MI') order by seq), '[]'::jsonb)
      into v_marc from rh_marcacao where ponto_id = p.id;

    select nome, tipo, abona, carga_min into v_fer from rh_feriado where org_id = p_org_id and data = d;

    select x.tipo, x.descricao, x.status, x.decidido_em,
           (select pr.full_name from profiles pr where pr.id = x.decidido_por) as decidido_por_nome
      into v_just
      from rh_justificativa x
     where x.colaborador_id = p_colaborador_id and d between x.data_ini and x.data_fim
     order by x.created_at desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'acao', l.acao, 'antes', l.antes, 'depois', l.depois, 'motivo', l.motivo, 'em', l.em,
             'por', (select pr.full_name from profiles pr where pr.id = l.por)) order by l.em desc), '[]'::jsonb)
      into v_log from rh_ponto_log l where l.ponto_id = p.id;

    select pr.full_name into v_por from profiles pr where pr.id = p.ajuste_por;

    -- Dia esperado (para marcar falta): dia de jornada e não abonado por feriado.
    v_esp := (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    v_carga := coalesce(j.carga_min, 480);
    if v_fer.nome is not null or v_fer.tipo is not null then
      v_carga := coalesce(v_fer.carga_min, case when coalesce(v_fer.abona, true) then 0 else v_carga end);
      if v_carga = 0 then v_esp := false; end if;
    end if;

    if v_esp then
      v_hn := v_hn + least(coalesce(p.minutos, 0), v_carga);
      if coalesce(p.minutos, 0) < v_carga
         and not exists (select 1 from rh_justificativa x where x.colaborador_id = p_colaborador_id
                          and x.status in ('aprovado','abonado') and d between x.data_ini and x.data_fim)
      then v_falta := v_falta + (v_carga - coalesce(p.minutos, 0)); end if;
    end if;
    v_ex := v_ex + greatest(0, coalesce(p.minutos, 0) - v_carga);

    v_dias := v_dias || jsonb_build_object(
      'data', d, 'dow', extract(isodow from d)::int,
      'esperado_min', case when v_esp then v_carga else 0 end,
      'marcacoes', v_marc,
      'minutos', coalesce(p.minutos, 0), 'saldo_min', coalesce(p.saldo_min, 0),
      'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
      'extra_status', p.extra_status, 'origem', p.origem, 'motivo', p.motivo,
      'feriado', case when v_fer.tipo is null then null else
        jsonb_build_object('nome', v_fer.nome, 'tipo', v_fer.tipo, 'carga_min', v_fer.carga_min) end,
      'justificativa', case when v_just.status is null then null else
        jsonb_build_object('tipo', v_just.tipo, 'descricao', v_just.descricao, 'status', v_just.status,
          'decidido_por', v_just.decidido_por_nome, 'decidido_em', v_just.decidido_em) end,
      'ajuste', case when p.ajuste_em is null then null else
        jsonb_build_object('de', p.ajuste_de, 'por', v_por, 'em', p.ajuste_em) end,
      'log', v_log);

    d := d + 1;
  end loop;

  return jsonb_build_object(
    'colaborador', jsonb_build_object('id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'cpf', c.cpf),
    'jornada', jsonb_build_object('carga_min', j.carga_min, 'entrada', j.entrada, 'saida', j.saida,
                                  'intervalo_min', j.intervalo_min, 'dias_semana', j.dias_semana),
    'ini', v_ini, 'fim', v_fim, 'competencia', to_char(p_competencia, 'YYYY-MM'),
    'resumo', jsonb_build_object('hn_min', v_hn, 'faltas_min', v_falta, 'extra_min', v_ex,
                                 'saldo_min', v_ex - v_falta),
    'dias', v_dias);
end; $$;
revoke execute on function rh_espelho(uuid, uuid, date) from public;
grant execute on function rh_espelho(uuid, uuid, date) to authenticated;

-- ── Lista de colaboradores com resumo do ciclo (tela 1) ──
create or replace function rh_espelho_lista(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_out jsonb := '[]'::jsonb; c record;
  v_dias int; v_pend int; v_int int; v_aj int; v_saldo int;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  for c in
    select co.id, co.nome, co.cargo, co.membro_user_id
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
      'dias_com_ponto', coalesce(v_dias, 0), 'extras_pendentes', coalesce(v_pend, 0),
      'intervalo_curto', coalesce(v_int, 0), 'ajustados', coalesce(v_aj, 0),
      'saldo_min', coalesce(v_saldo, 0));
  end loop;

  return jsonb_build_object('ini', v_ini, 'fim', v_fim,
    'competencia', to_char(p_competencia, 'YYYY-MM'), 'colaboradores', v_out);
end; $$;
revoke execute on function rh_espelho_lista(uuid, date) from public;
grant execute on function rh_espelho_lista(uuid, date) to authenticated;

notify pgrst, 'reload schema';
