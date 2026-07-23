-- 150_rh_ponto.sql
-- RH Fase 3: ponto. Jornada (padrão da org + override por pessoa), marcações do dia
-- (4 batidas), justificativas (falta/atestado → RH). Regras DURAS na marcação:
-- intervalo mínimo 1h; jornada máxima 10h (CLT). Marcação usa hora do SERVIDOR em BRT
-- (anti-fraude). Idempotente.

-- ── Jornada: padrão da org (colaborador_id null) + override por pessoa ──
create table if not exists rh_jornada (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid references rh_colaborador(id) on delete cascade,   -- null = padrão da org
  entrada        time not null default '08:30',
  intervalo_ini  time not null default '12:00',
  intervalo_fim  time not null default '13:30',
  saida          time not null default '18:00',
  carga_min      int  not null default 480,   -- 8h/dia
  intervalo_min  int  not null default 60,    -- mínimo 1h de intervalo (regra dura)
  flex_min       int  not null default 30,    -- flexibilização de entrada/saída ±30min
  max_dia_min    int  not null default 600,   -- máximo 10h/dia (CLT)
  dias_semana    int[] not null default '{1,2,3,4,5}',  -- seg..sex (ISO dow)
  consent_doc_id uuid references rh_documento(id) on delete set null,    -- doc de consentimento (horário custom)
  updated_at     timestamptz not null default now()
);
create unique index if not exists rh_jornada_org_default on rh_jornada (org_id) where colaborador_id is null;
create unique index if not exists rh_jornada_colab on rh_jornada (colaborador_id) where colaborador_id is not null;

-- ── Ponto do dia (1 linha por colaborador/dia, 4 marcações) ──
create table if not exists rh_ponto (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  data           date not null,
  entrada        time,
  intervalo_ini  time,
  intervalo_fim  time,
  saida          time,
  minutos        int  not null default 0,     -- trabalhados
  saldo_min      int  not null default 0,     -- minutos - carga (positivo=extra, negativo=devendo)
  acima_10h      boolean not null default false,
  extra_status   text,                         -- null | pendente | aprovado | rejeitado (só quando saldo>0)
  extra_por      uuid,                          -- gestor que decidiu
  extra_projeto  uuid references activities(id) on delete set null,  -- alocação em projeto (dimensionamento)
  extra_em       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists rh_ponto_uk on rh_ponto (colaborador_id, data);
create index if not exists rh_ponto_extra_idx on rh_ponto (org_id) where extra_status = 'pendente';

-- ── Justificativa (falta/atestado/esqueci) → decisão do RH ──
create table if not exists rh_justificativa (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  data_ini       date not null,
  data_fim       date not null,
  tipo           text not null,                -- falta | atestado | medico | esqueci | outro
  descricao      text,
  doc_id         uuid references rh_documento(id) on delete set null,   -- anexo (atestado)
  status         text not null default 'pendente',  -- pendente | aprovado | rejeitado | abonado | falta
  decidido_por   uuid,
  decidido_em    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists rh_justificativa_pend_idx on rh_justificativa (org_id) where status = 'pendente';

-- ── Helper: o caller é o próprio colaborador? (bate o próprio ponto) ──
create or replace function rh_is_self(p_colaborador_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from rh_colaborador where id = p_colaborador_id and membro_user_id = auth.uid());
$$;
revoke execute on function rh_is_self(uuid) from public;
grant execute on function rh_is_self(uuid) to authenticated;

-- ── RLS ──
alter table rh_jornada enable row level security;
alter table rh_ponto enable row level security;
alter table rh_justificativa enable row level security;
drop policy if exists rh_jornada_all on rh_jornada;
create policy rh_jornada_all on rh_jornada for all using (rh_can(org_id)) with check (rh_can(org_id));
drop policy if exists rh_ponto_rw on rh_ponto;
-- RH vê tudo; o colaborador vê o próprio ponto.
create policy rh_ponto_rw on rh_ponto for all using (rh_can(org_id) or rh_is_self(colaborador_id)) with check (rh_can(org_id) or rh_is_self(colaborador_id));
drop policy if exists rh_justificativa_rw on rh_justificativa;
create policy rh_justificativa_rw on rh_justificativa for all using (rh_can(org_id) or rh_is_self(colaborador_id)) with check (rh_can(org_id) or rh_is_self(colaborador_id));

-- ── Semeia a jornada padrão da org (8h30–12h / 13h30–18h) ──
insert into rh_jornada (org_id, colaborador_id)
select id, null from organizations
on conflict do nothing;

-- ── Jornada efetiva de um colaborador (override dele, senão a da org) ──
create or replace function rh_jornada_de(p_colaborador_id uuid)
returns rh_jornada language sql stable security definer set search_path to 'public' as $$
  select j.* from rh_jornada j
  where j.colaborador_id = p_colaborador_id
     or (j.colaborador_id is null and j.org_id = (select org_id from rh_colaborador where id = p_colaborador_id))
  order by j.colaborador_id nulls last
  limit 1;
$$;

-- ── Bater ponto: grava a hora do SERVIDOR (BRT) na marcação p_tipo ──
-- p_tipo ∈ entrada | intervalo_ini | intervalo_fim | saida.
-- Valida: intervalo ≥ 1h (rejeita o retorno cedo demais); credita no máx 10h/dia.
create or replace function rh_bater_ponto(p_colaborador_id uuid, p_tipo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; j rh_jornada; p rh_ponto; v_min int; v_manha int; v_tarde int;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  j := rh_jornada_de(p_colaborador_id);

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, p_colaborador_id, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = v_hoje;

  if p_tipo = 'entrada' then
    if p.entrada is not null then raise exception 'Entrada já registrada hoje'; end if;
    update rh_ponto set entrada = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'intervalo_ini' then
    if p.entrada is null then raise exception 'Bata a entrada primeiro'; end if;
    if p.intervalo_ini is not null then raise exception 'Intervalo já iniciado'; end if;
    update rh_ponto set intervalo_ini = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'intervalo_fim' then
    if p.intervalo_ini is null then raise exception 'Inicie o intervalo primeiro'; end if;
    if p.intervalo_fim is not null then raise exception 'Retorno já registrado'; end if;
    -- REGRA DURA: intervalo mínimo de 1h.
    if extract(epoch from (v_agora - p.intervalo_ini)) / 60 < coalesce(j.intervalo_min, 60) then
      raise exception 'Intervalo mínimo de % min. Aguarde para registrar o retorno.', coalesce(j.intervalo_min, 60);
    end if;
    update rh_ponto set intervalo_fim = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'saida' then
    if p.entrada is null then raise exception 'Bata a entrada primeiro'; end if;
    if p.saida is not null then raise exception 'Saída já registrada'; end if;
    update rh_ponto set saida = v_agora, updated_at = now() where id = p.id;
  else
    raise exception 'Tipo de marcação inválido';
  end if;

  -- Recalcula minutos e saldo (manhã + tarde), sempre que há saída.
  select * into p from rh_ponto where id = p.id;
  if p.saida is not null and p.entrada is not null then
    v_manha := case when p.intervalo_ini is not null
                    then (extract(epoch from (p.intervalo_ini - p.entrada)) / 60)::int
                    else (extract(epoch from (p.saida - p.entrada)) / 60)::int end;
    v_tarde := case when p.intervalo_fim is not null and p.saida is not null
                    then (extract(epoch from (p.saida - p.intervalo_fim)) / 60)::int else 0 end;
    v_min := greatest(0, coalesce(v_manha,0) + coalesce(v_tarde,0));
    update rh_ponto set
      minutos = least(v_min, coalesce(j.max_dia_min, 600)),   -- credita no máx 10h (CLT)
      acima_10h = (v_min > coalesce(j.max_dia_min, 600)),
      saldo_min = least(v_min, coalesce(j.max_dia_min, 600)) - coalesce(j.carga_min, 480),
      extra_status = case when least(v_min, coalesce(j.max_dia_min,600)) - coalesce(j.carga_min,480) > 0
                          then coalesce(extra_status, 'pendente') else extra_status end,
      updated_at = now()
    where id = p.id;
  end if;

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object('tipo', p_tipo, 'hora', v_agora, 'minutos', p.minutos, 'saldo_min', p.saldo_min, 'acima_10h', p.acima_10h);
end; $$;

revoke execute on function rh_bater_ponto(uuid,text) from public;
grant execute on function rh_bater_ponto(uuid,text) to authenticated;

notify pgrst, 'reload schema';
