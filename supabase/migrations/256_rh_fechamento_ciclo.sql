-- 256_rh_fechamento_ciclo.sql
-- FECHAMENTO DO PONTO VIRA UM ATO (modelo do fechamento contábil, mig. 129/130)
--
-- Até aqui a tela de fechamento era um relatório VIVO: recalculava a cada
-- visita e nada ficava registrado. Agora "fechar o ciclo" congela um snapshot
-- (rh_fechamento_run + linhas), com três novidades pedidas pelo Rafael:
--
--  1) ESCOLHER QUEM ENTRA no corte — checkbox no ato + regra permanente na
--     ficha (`entra_fechamento`): sócio que bate ponto só para medir custo por
--     tarefa não vai para a contabilidade.
--  2) PERÍODO PRÓPRIO POR PESSOA — desligamento dia 31 com corte no 25: o
--     último ciclo da pessoa estica até a demissão (34 dias) em vez de vazar
--     6 dias para um ciclo seguinte em que ela não existe mais.
--  3) HISTÓRICO + ENVIO — o snapshot é o que se navega depois e o que vai por
--     e-mail para o RH da contabilidade (PDF do espelho + resumo), com VR/VT
--     digitados na hora (o valor nasce fora do Flow).
--
-- A régua de cálculo NÃO muda: o miolo do rh_fechamento (206/210/213/223/
-- 228–230) foi extraído em rh_fechamento_linha_calc(colaborador, ini, fim) e
-- as duas funções passam a usar o mesmo helper — fechamento vivo e snapshot
-- nunca podem divergir.

-- ── Ficha: quem entra no fechamento da contabilidade ────────────────────────
-- Separado de bate_ponto DE PROPÓSITO: o Rafael bate ponto (custo/hora por
-- tarefa) e não entra no fechamento; um desligado pode não bater mais e ainda
-- precisar entrar no último ciclo.
alter table rh_colaborador add column if not exists entra_fechamento boolean not null default true;

create or replace function rh_set_entra_fechamento(p_colaborador uuid, p_entra boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_colaborador set entra_fechamento = coalesce(p_entra, true) where id = p_colaborador;
end $$;
revoke execute on function rh_set_entra_fechamento(uuid, boolean) from public, anon;
grant  execute on function rh_set_entra_fechamento(uuid, boolean) to authenticated;

-- ── E-mails do RH da contabilidade (separado do fechamento financeiro) ──────
alter table org_settings add column if not exists rh_contabil_emails text[];

-- org_settings só tem policy de SELECT (016): toda escrita é RPC (ver 130 — o
-- UPDATE direto afetava 0 linhas e a tela dizia "salvo" com o banco vazio).
create or replace function rh_salvar_contabil_emails(p_org_id uuid, p_emails text[])
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into org_settings (org_id, rh_contabil_emails) values (p_org_id, p_emails)
  on conflict (org_id) do update set rh_contabil_emails = excluded.rh_contabil_emails;
end $$;
revoke execute on function rh_salvar_contabil_emails(uuid, text[]) from public, anon;
grant  execute on function rh_salvar_contabil_emails(uuid, text[]) to authenticated;

-- ── O ciclo fechado (snapshot) ──────────────────────────────────────────────
create table if not exists rh_fechamento_run (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  competencia     date not null,                    -- YYYY-MM-01
  ini             date not null,
  fim             date not null,
  status          text not null default 'fechado',  -- fechado | reaberto | enviado
  versao          int  not null default 1,
  fechado_por     uuid,
  fechado_em      timestamptz not null default now(),
  reaberto_por    uuid,
  reaberto_em     timestamptz,
  reaberto_motivo text,
  enviado_em      timestamptz,
  destinatarios   text[],
  envios          int not null default 0,
  vr_valor        numeric,                          -- informado no envio (nasce fora do Flow)
  vt_valor        numeric,
  corpo           text,                             -- o corpo do e-mail como saiu
  unique (org_id, competencia)
);

-- Linhas congeladas: nome/CPF/cargo são snapshot de propósito — o histórico
-- não muda se a ficha mudar depois. ini/fim são O PERÍODO DA PESSOA (o do
-- desligado pode diferir do período do run).
create table if not exists rh_fechamento_run_linha (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references rh_fechamento_run(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  nome           text not null,
  cpf            text,
  cargo          text,
  ini            date not null,
  fim            date not null,
  hn_min         int not null default 0,
  he50_min       int not null default 0,
  he100_min      int not null default 0,
  faltas_min     int not null default 0,
  total_min      int not null default 0,
  quitacao_min   int not null default 0,
  pendente_min   int not null default 0,
  dias_com_ponto int not null default 0,
  unique (run_id, colaborador_id)
);
create index if not exists rh_fechamento_run_org_idx on rh_fechamento_run (org_id, competencia desc);

alter table rh_fechamento_run enable row level security;
alter table rh_fechamento_run_linha enable row level security;
drop policy if exists rh_fech_run_sel on rh_fechamento_run;
create policy rh_fech_run_sel on rh_fechamento_run for select using (rh_can(org_id));
drop policy if exists rh_fech_linha_sel on rh_fechamento_run_linha;
create policy rh_fech_linha_sel on rh_fechamento_run_linha for select using (
  exists (select 1 from rh_fechamento_run r where r.id = run_id and rh_can(r.org_id))
);
-- Escrita só pelas RPCs abaixo (security definer). Sem policy de insert/update.

-- ── A régua de UMA pessoa em UM período (miolo extraído do rh_fechamento) ───
-- Helper INTERNO (revoke geral, sem grant): quem confere acesso são as funções
-- públicas que o chamam. Regra da revisão de 15/08: helper interno = REVOKE,
-- nunca guard no corpo.
create or replace function rh_fechamento_linha_calc(p_colaborador_id uuid, p_ini date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  c record; j rh_jornada; d date;
  v_hn int := 0; v_h50 int := 0; v_h100 int := 0; v_falta int := 0; v_pend int := 0; v_edit timestamptz;
  v_carga int; v_trab int; v_esp boolean; v_ab boolean; v_100 boolean; v_extra int;
  v_status text; v_upd timestamptz; v_dias int := 0; v_esperados int := 0;
  v_abono int; v_origem text; v_i_norm int; v_i_deb int; v_i_falt int; v_i_50 int; v_i_100 int;
  v_tol int; v_saldo int;
begin
  select co.org_id, co.id, co.nome, co.cpf, co.cargo, co.bate_ponto, co.entra_fechamento, co.data_demissao
    into c from rh_colaborador co where co.id = p_colaborador_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;

  j := rh_jornada_de(c.id);
  v_tol := coalesce(j.tolerancia_min, 10);

  d := p_ini;
  while d <= p_fim loop
    v_carga := coalesce(j.carga_min, 480);
    -- Dia esperado = está nos dias_semana da jornada E não é feriado/emenda que abona.
    -- Dispensado de jornada (sócio, cargo de confiança): sem carga esperada.
    v_esp := coalesce(c.bate_ponto, true) and rh_no_vinculo(c.id, d) and d < (now() at time zone 'America/Sao_Paulo')::date
             and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    select f.abona, f.extra_100 into v_ab, v_100 from rh_feriado f where f.org_id = c.org_id and f.data = d;
    if found and coalesce(v_ab, true) then v_esp := false; end if;
    if not found then v_100 := false; end if;
    -- Emenda de feriado: abona só quem aderiu (ver rh_ponte_abona).
    if v_esp and rh_ponte_abona(c.id, d) then v_esp := false; end if;
    -- Mesma régua do espelho: o abono sai da carga exigida.
    v_abono := 0;
    if v_esp then
      v_abono := rh_abono_min(c.id, d, v_carga);
      if v_abono > 0 then
        v_carga := greatest(0, v_carga - v_abono);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;

    select p.minutos, p.extra_status, p.updated_at, p.origem,
           p.imp_normais_min, p.imp_debito_min, p.imp_faltantes_min, p.imp_he50_min, p.imp_he100_min
      into v_trab, v_status, v_upd, v_origem, v_i_norm, v_i_deb, v_i_falt, v_i_50, v_i_100
    from rh_ponto p where p.colaborador_id = c.id and p.data = d;
    if not found then v_trab := 0; v_status := null; v_upd := null; else v_dias := v_dias + 1; end if;
    v_trab := coalesce(v_trab, 0);
    if v_upd is not null and (v_edit is null or v_upd > v_edit) then v_edit := v_upd; end if;

    if v_origem = 'pontomais' then
      -- Dia congelado: usa a apuração do Pontomais (ver rh_espelho).
      if v_esp then v_esperados := v_esperados + 1; end if;
      v_hn    := v_hn + coalesce(v_i_norm, 0);
      v_falta := v_falta + greatest(0, coalesce(v_i_deb, v_i_falt, 0));
      v_h50   := v_h50 + coalesce(v_i_50, 0);
      v_h100  := v_h100 + coalesce(v_i_100, 0);
    elsif v_esp then
      v_esperados := v_esperados + 1;
      -- Tolerância do dia (mesma do espelho e do rh_recalc_ponto): variação
      -- pequena não vai para a folha nem como falta, nem como extra.
      v_saldo := rh_saldo_tolerado(v_trab, v_carga, v_tol);
      -- Dia absorvido credita a carga cheia de horas normais.
      v_hn := v_hn + v_carga + least(0, v_saldo);
      v_extra := greatest(0, v_saldo);
      if v_extra > 0 then
        -- Só entra na folha o que o gestor aprovou; o resto fica sinalizado.
        if v_status = 'aprovado' then
          if v_100 then v_h100 := v_h100 + v_extra; else v_h50 := v_h50 + v_extra; end if;
        else v_pend := v_pend + v_extra; end if;
      elsif v_saldo < 0 then
        -- Justificativa aprovada/abonada credita o dia (não vira falta).
        -- Carga já líquida do abono: o que faltar é da pessoa.
        v_falta := v_falta + (-v_saldo);
      end if;
    elsif v_trab > 0 then
      -- Dia não esperado (fim de semana, feriado, emenda): tudo é extra.
      if v_status = 'aprovado' then
        if v_100 then v_h100 := v_h100 + v_trab; else v_h50 := v_h50 + v_trab; end if;
      else v_pend := v_pend + v_trab; end if;
    end if;

    d := d + 1;
  end loop;

  return jsonb_build_object(
    'colaborador_id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'cargo', c.cargo,
    'hn_min', v_hn, 'he50_min', v_h50, 'he100_min', v_h100, 'faltas_min', v_falta,
    'total_min', v_hn + v_h50 + v_h100 - v_falta,
    'quitacao_min', v_h50 + v_h100 - v_falta,
    'pendente_min', v_pend, 'editado_em', v_edit,
    'dias_com_ponto', v_dias, 'dias_esperados', v_esperados,
    -- Para a UI de seleção do corte:
    'entra_fechamento', coalesce(c.entra_fechamento, true), 'data_demissao', c.data_demissao);
end $$;
revoke execute on function rh_fechamento_linha_calc(uuid, date, date) from public, anon, authenticated;

-- ── rh_fechamento (vivo) passa a usar o helper — resultado idêntico ─────────
create or replace function rh_fechamento(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_linhas jsonb := '[]'::jsonb; c record;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  for c in
    select co.id
    from rh_colaborador co
    where co.org_id = p_org_id and not co.arquivado
      and (co.status <> 'desligado'
           or exists (select 1 from rh_ponto p where p.colaborador_id = co.id and p.data between v_ini and v_fim))
    order by co.nome
  loop
    v_linhas := v_linhas || rh_fechamento_linha_calc(c.id, v_ini, v_fim);
  end loop;

  return jsonb_build_object('ini', v_ini, 'fim', v_fim,
    'competencia', to_char(p_competencia, 'YYYY-MM'), 'linhas', v_linhas);
end $$;

-- ── Fechar o ciclo: congela as linhas escolhidas ────────────────────────────
-- p_pessoas = [{id, ini?, fim?}] — ini/fim por pessoa (default: o do ciclo).
-- Run já fechado/enviado exige reabrir antes (trava contra sobrescrita).
create or replace function rh_fechar_ciclo(p_org_id uuid, p_competencia date, p_pessoas jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_run uuid; v_status text;
  item jsonb; r jsonb; v_colab uuid; v_pini date; v_pfim date; v_n int := 0;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_pessoas is null or jsonb_array_length(p_pessoas) = 0 then
    raise exception 'Selecione ao menos uma pessoa para fechar o ciclo';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  select id, status into v_run, v_status from rh_fechamento_run
   where org_id = p_org_id and competencia = date_trunc('month', p_competencia)::date;
  if v_run is not null and v_status in ('fechado', 'enviado') then
    raise exception 'Este ciclo já está fechado. Reabra antes de refazer.';
  end if;

  if v_run is null then
    insert into rh_fechamento_run (org_id, competencia, ini, fim, fechado_por)
    values (p_org_id, date_trunc('month', p_competencia)::date, v_ini, v_fim, auth.uid())
    returning id into v_run;
  else
    -- Reaberto: refaz por cima, guardando a contagem de versões.
    delete from rh_fechamento_run_linha where run_id = v_run;
    update rh_fechamento_run
       set status = 'fechado', versao = versao + 1,
           fechado_por = auth.uid(), fechado_em = now(), ini = v_ini, fim = v_fim
     where id = v_run;
  end if;

  for item in select * from jsonb_array_elements(p_pessoas) loop
    v_colab := (item->>'id')::uuid;
    perform 1 from rh_colaborador where id = v_colab and org_id = p_org_id;
    if not found then raise exception 'Colaborador fora da organização'; end if;
    v_pini := coalesce((item->>'ini')::date, v_ini);
    v_pfim := coalesce((item->>'fim')::date, v_fim);
    if v_pfim < v_pini then raise exception 'Período da pessoa está invertido'; end if;

    r := rh_fechamento_linha_calc(v_colab, v_pini, v_pfim);
    insert into rh_fechamento_run_linha
      (run_id, colaborador_id, nome, cpf, cargo, ini, fim,
       hn_min, he50_min, he100_min, faltas_min, total_min, quitacao_min, pendente_min, dias_com_ponto)
    values
      (v_run, v_colab, r->>'nome', r->>'cpf', r->>'cargo', v_pini, v_pfim,
       (r->>'hn_min')::int, (r->>'he50_min')::int, (r->>'he100_min')::int, (r->>'faltas_min')::int,
       (r->>'total_min')::int, (r->>'quitacao_min')::int, (r->>'pendente_min')::int, (r->>'dias_com_ponto')::int);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('run_id', v_run, 'linhas', v_n);
end $$;
revoke execute on function rh_fechar_ciclo(uuid, date, jsonb) from public, anon;
grant  execute on function rh_fechar_ciclo(uuid, date, jsonb) to authenticated;

-- ── Reabrir (motivo obrigatório — mesmo espírito da assinatura, mig. 169) ───
create or replace function rh_reabrir_fechamento(p_run uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_fechamento_run where id = p_run;
  if v_org is null then raise exception 'Fechamento não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da reabertura'; end if;
  update rh_fechamento_run
     set status = 'reaberto', reaberto_por = auth.uid(), reaberto_em = now(), reaberto_motivo = btrim(p_motivo)
   where id = p_run;
end $$;
revoke execute on function rh_reabrir_fechamento(uuid, text) from public, anon;
grant  execute on function rh_reabrir_fechamento(uuid, text) to authenticated;

-- ── Marca o envio (chamada pela action DEPOIS do e-mail sair) ───────────────
create or replace function rh_fechamento_marcar_envio(
  p_run uuid, p_destinatarios text[], p_vr numeric, p_vt numeric, p_corpo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_fechamento_run where id = p_run;
  if v_org is null then raise exception 'Fechamento não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_fechamento_run
     set status = 'enviado', enviado_em = now(), destinatarios = p_destinatarios,
         envios = envios + 1, vr_valor = p_vr, vt_valor = p_vt, corpo = p_corpo
   where id = p_run;
end $$;
revoke execute on function rh_fechamento_marcar_envio(uuid, text[], numeric, numeric, text) from public, anon;
grant  execute on function rh_fechamento_marcar_envio(uuid, text[], numeric, numeric, text) to authenticated;

-- ── rh_espelho aceita período explícito (o desligado com ciclo esticado) ────
-- PostgREST não tolera overload: DROP da assinatura antiga e CREATE com os
-- parâmetros novos com default — as chamadas existentes (3 args nomeados)
-- continuam válidas.
drop function if exists rh_espelho(uuid, uuid, date);
create function rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date, p_ini date default null, p_fim date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_dias jsonb := '[]'::jsonb; d date;
  c record; j rh_jornada; p rh_ponto; v_marc jsonb; v_fer record; v_just record;
  v_saldo_dia int; v_abono int; v_tol int; v_absorvido int;
  v_log jsonb; v_por text; v_esp boolean; v_carga int;
  v_hn int := 0; v_falta int := 0; v_ex int := 0;
begin
  if not (rh_can(p_org_id) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);
  -- Período explícito (fechamento com ciclo próprio) vence o do config.
  v_ini := coalesce(p_ini, v_ini);
  v_fim := coalesce(p_fim, v_fim);
  select id, nome, cargo, cpf, bate_ponto into c from rh_colaborador where id = p_colaborador_id and org_id = p_org_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  j := rh_jornada_de(p_colaborador_id);
  v_tol := coalesce(j.tolerancia_min, 10);

  d := v_ini;
  while d <= v_fim loop
    select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = d;

    select coalesce(jsonb_agg(to_char(hora, 'HH24:MI') order by seq), '[]'::jsonb)
      into v_marc from rh_marcacao where ponto_id = p.id;

    select nome, tipo, abona, carga_min into v_fer from rh_feriado where org_id = p_org_id and data = d;

    select x.tipo, x.descricao, x.status, x.decidido_em,
           (select pr.full_name from profiles pr where pr.id = x.decidido_por) as decidido_por_nome,
           x.doc_id, x.ausencia_ini, x.ausencia_fim
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
    -- Quem não bate ponto não tem carga esperada: sem jornada a cumprir não
    -- existe falta. Os registros que ele porventura tiver seguem visíveis.
    v_esp := coalesce(c.bate_ponto, true) and rh_no_vinculo(c.id, d) and d < (now() at time zone 'America/Sao_Paulo')::date
             and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    v_carga := coalesce(j.carga_min, 480);
    if v_fer.nome is not null or v_fer.tipo is not null then
      v_carga := coalesce(v_fer.carga_min, case when coalesce(v_fer.abona, true) then 0 else v_carga end);
      if v_carga = 0 then v_esp := false; end if;
    end if;
    -- Emenda de feriado: abona só quem ADERIU. O calendário (rh_feriado) vale
    -- para a org inteira e numa ponte parte do time trabalha — abonar todos
    -- daria hora extra a quem estava no escritório.
    if v_esp and rh_ponte_abona(p_colaborador_id, d) then
      v_carga := 0; v_esp := false;
    end if;

    -- Abono da justificativa: sai da CARGA exigida, não do saldo inteiro. Só o
    -- tempo que o documento cobre (ver rh_abono_min) — atraso na entrada e
    -- volta depois do fim da consulta continuam contando.
    v_abono := 0;
    if v_esp then
      v_abono := rh_abono_min(p_colaborador_id, d, v_carga);
      if v_abono > 0 then
        v_carga := greatest(0, v_carga - v_abono);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;

    -- Saldo do dia com a MESMA tolerância do rh_recalc_ponto. Antes daqui o
    -- espelho refazia `minutos - carga` cru e mostrava -0:05 num dia cujo
    -- próprio saldo gravado era 0.
    if p.origem = 'pontomais' then
      v_saldo_dia := coalesce(p.saldo_min, 0);       -- dia congelado (mig. 206)
    elsif v_esp then
      v_saldo_dia := rh_saldo_tolerado(coalesce(p.minutos, 0), v_carga, v_tol);
    else
      v_saldo_dia := coalesce(p.saldo_min, 0);
    end if;

    -- Quanto a tolerância absorveu neste dia (0 = nada). A tela usa para
    -- explicar por que 7:55 trabalhadas ficaram com saldo zero.
    v_absorvido := case when v_esp and p.origem is null and v_saldo_dia = 0
                        then coalesce(p.minutos, 0) - v_carga else 0 end;

    if p.origem = 'pontomais' then
      -- Dia congelado: a apuração é a DELES (ver comentário na versão anterior).
      v_hn    := v_hn + coalesce(p.imp_normais_min, 0);
      v_falta := v_falta + greatest(0, coalesce(p.imp_debito_min, p.imp_faltantes_min, 0));
      v_ex    := v_ex + coalesce(p.imp_he50_min, 0) + coalesce(p.imp_he100_min, 0);
    elsif v_esp then
      -- Absorvido pela tolerância ⇒ o dia vale a CARGA CHEIA de horas normais.
      v_hn    := v_hn + v_carga + least(0, v_saldo_dia);
      v_falta := v_falta + greatest(0, -v_saldo_dia);
      v_ex    := v_ex + greatest(0, v_saldo_dia);
    else
      v_ex := v_ex + greatest(0, coalesce(p.minutos, 0) - v_carga);
    end if;

    v_dias := v_dias || jsonb_build_object(
      'data', d, 'dow', extract(isodow from d)::int,
      'esperado_min', case when v_esp then v_carga else 0 end, 'abono_min', v_abono,
      'marcacoes', v_marc,
      'minutos', coalesce(p.minutos, 0), 'saldo_min', v_saldo_dia,
      'tolerado_min', v_absorvido,
      'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
      'extra_status', p.extra_status, 'origem', p.origem, 'motivo', p.motivo,
      'feriado', case when v_fer.tipo is null then null else
        jsonb_build_object('nome', v_fer.nome, 'tipo', v_fer.tipo, 'carga_min', v_fer.carga_min) end,
      'justificativa', case when v_just.status is null then null else
        jsonb_build_object('tipo', v_just.tipo, 'descricao', v_just.descricao, 'status', v_just.status,
          'decidido_por', v_just.decidido_por_nome, 'decidido_em', v_just.decidido_em,
          'doc_id', v_just.doc_id,
          'ausencia_ini', v_just.ausencia_ini, 'ausencia_fim', v_just.ausencia_fim) end,
      'ajuste', case when p.ajuste_em is null then null else
        jsonb_build_object('de', p.ajuste_de, 'por', v_por, 'em', p.ajuste_em) end,
      'log', v_log);

    d := d + 1;
  end loop;

  return jsonb_build_object(
    'colaborador', jsonb_build_object('id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'cpf', c.cpf, 'bate_ponto', coalesce(c.bate_ponto, true)),
    'jornada', jsonb_build_object('carga_min', j.carga_min, 'entrada', j.entrada, 'saida', j.saida,
                                  'intervalo_min', j.intervalo_min, 'dias_semana', j.dias_semana,
                                  'tolerancia_min', v_tol),
    'ini', v_ini, 'fim', v_fim, 'competencia', to_char(p_competencia, 'YYYY-MM'),
    'resumo', jsonb_build_object('hn_min', v_hn, 'faltas_min', v_falta, 'extra_min', v_ex,
                                 'saldo_min', v_ex - v_falta,
                                 'ate', least(v_fim, (now() at time zone 'America/Sao_Paulo')::date - 1)),
    'dias', v_dias);
end $$;
revoke execute on function rh_espelho(uuid, uuid, date, date, date) from public, anon;
grant  execute on function rh_espelho(uuid, uuid, date, date, date) to authenticated;

notify pgrst, 'reload schema';
