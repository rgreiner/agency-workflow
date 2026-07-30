-- 165_rh_marcacoes_livres.sql
-- O dia deixa de ter 4 (ou 6) marcações fixas e passa a ter N pares livres.
--
-- Por quê: a pessoa pode fazer uma pausa curta (30min p/ resolver algo pessoal),
-- voltar e ficar mais tarde para fechar as 8h. Com marcação fixa isso não cabia, e
-- pior: a regra dura antiga REJEITAVA o retorno antes de 1h — ou seja, o sistema
-- recusava uma pausa legítima.
--
-- Nova regra (revisa a decisão anterior): pode bater quantas vezes precisar. O
-- ALMOÇO é o MAIOR intervalo do dia e é ele que precisa ter no mínimo 1h. A
-- verificação passa a ser no fechamento do dia (flag p/ o RH), não no clique.
-- Idempotente.

create table if not exists rh_marcacao (
  id         uuid primary key default gen_random_uuid(),
  ponto_id   uuid not null references rh_ponto(id) on delete cascade,
  hora       time not null,
  seq        int  not null,           -- ordem cronológica no dia (1,2,3…)
  origem     text,                    -- null = batida no Flow · 'pontomais' · 'ajuste'
  created_at timestamptz not null default now()
);
create unique index if not exists rh_marcacao_uk on rh_marcacao (ponto_id, seq);
create index if not exists rh_marcacao_ponto_idx on rh_marcacao (ponto_id);

alter table rh_marcacao enable row level security;
drop policy if exists rh_marcacao_rw on rh_marcacao;
create policy rh_marcacao_rw on rh_marcacao for all using (
  exists (select 1 from rh_ponto p where p.id = ponto_id and (rh_can(p.org_id) or rh_is_self(p.colaborador_id)))
) with check (
  exists (select 1 from rh_ponto p where p.id = ponto_id and (rh_can(p.org_id) or rh_is_self(p.colaborador_id)))
);

-- Diagnóstico do intervalo (preenchido pelo recalc)
alter table rh_ponto add column if not exists intervalo_maior_min int;
alter table rh_ponto add column if not exists intervalo_ok boolean;

-- ── Backfill: colunas fixas → lista de marcações (só onde ainda não há lista) ──
insert into rh_marcacao (ponto_id, hora, seq, origem)
select p.id, v.hora, row_number() over (partition by p.id order by v.ord), p.origem
from rh_ponto p
cross join lateral (values
  (1, p.entrada), (2, p.intervalo_ini), (3, p.intervalo_fim),
  (4, p.saida), (5, p.entrada3), (6, p.saida3)
) as v(ord, hora)
where v.hora is not null
  and not exists (select 1 from rh_marcacao m where m.ponto_id = p.id)
on conflict do nothing;

-- ── Recalcula a partir da LISTA de marcações ──
create or replace function rh_recalc_ponto(p_ponto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  p rh_ponto; j rh_jornada; v_min int := 0; v_carga int; v_abona boolean; v_fcarga int;
  v_maior int := 0; v_n int; v_ini time; v_fim time; v_ant time; r record; v_i int := 0;
begin
  select * into p from rh_ponto where id = p_ponto_id;
  if p.id is null then return; end if;
  if p.origem is not null then return; end if;   -- histórico importado é congelado
  j := rh_jornada_de(p.colaborador_id);

  select count(*) into v_n from rh_marcacao where ponto_id = p.id;

  -- Soma os PARES (1-2, 3-4, …); intervalo = buraco entre um par e o seguinte.
  for r in select hora, seq from rh_marcacao where ponto_id = p.id order by seq loop
    v_i := v_i + 1;
    if v_i % 2 = 1 then
      v_ini := r.hora;
      if v_ant is not null then
        v_maior := greatest(v_maior, (extract(epoch from (v_ini - v_ant)) / 60)::int);
      end if;
    else
      v_fim := r.hora;
      v_min := v_min + greatest(0, (extract(epoch from (v_fim - v_ini)) / 60)::int);
      v_ant := v_fim;
    end if;
  end loop;

  -- Nº ímpar de marcações = dia em aberto (a pessoa ainda não saiu).
  if v_n = 0 or v_n % 2 = 1 then
    update rh_ponto set minutos = 0, saldo_min = 0, acima_10h = false,
      intervalo_maior_min = nullif(v_maior, 0), intervalo_ok = null, updated_at = now()
    where id = p.id;
    return;
  end if;

  v_carga := coalesce(j.carga_min, 480);
  select abona, carga_min into v_abona, v_fcarga from rh_feriado where org_id = p.org_id and data = p.data;
  if found then
    v_carga := coalesce(v_fcarga, case when coalesce(v_abona, true) then 0 else v_carga end);
  elsif not (extract(isodow from p.data)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5]))) then
    v_carga := 0;
  end if;

  update rh_ponto set
    minutos   = least(v_min, coalesce(j.max_dia_min, 600)),
    acima_10h = (v_min > coalesce(j.max_dia_min, 600)),
    saldo_min = least(v_min, coalesce(j.max_dia_min, 600)) - v_carga,
    intervalo_maior_min = v_maior,
    -- Jornada acima de 6h exige intervalo de almoço (o MAIOR do dia) de 1h.
    intervalo_ok = case when v_min > 360 then v_maior >= coalesce(j.intervalo_min, 60) else true end,
    extra_status = case
      when least(v_min, coalesce(j.max_dia_min, 600)) - v_carga > 0 then coalesce(extra_status, 'pendente')
      else extra_status end,
    -- Mantém as colunas antigas em dia (leitura/relatórios legados)
    entrada       = (select hora from rh_marcacao where ponto_id = p.id and seq = 1),
    intervalo_ini = (select hora from rh_marcacao where ponto_id = p.id and seq = 2),
    intervalo_fim = (select hora from rh_marcacao where ponto_id = p.id and seq = 3),
    saida         = (select hora from rh_marcacao where ponto_id = p.id order by seq desc limit 1),
    updated_at = now()
  where id = p.id;
end; $$;
revoke execute on function rh_recalc_ponto(uuid) from public;
grant execute on function rh_recalc_ponto(uuid) to authenticated;

-- ── Bater ponto: só acrescenta a próxima marcação (sem tipo fixo) ──
-- PostgREST é estrito com overload → derruba a assinatura antiga (uuid,text).
drop function if exists rh_bater_ponto(uuid, text);
create or replace function rh_bater_ponto(p_colaborador_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; p rh_ponto; v_n int; v_ult time;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, p_colaborador_id, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = v_hoje;

  select count(*), max(hora) into v_n, v_ult from rh_marcacao where ponto_id = p.id;

  -- Trava de duplo-clique: 1 minuto entre marcações.
  if v_ult is not null and (extract(epoch from (v_agora - v_ult)) / 60) < 1 then
    raise exception 'Você acabou de registrar uma marcação. Aguarde um instante.';
  end if;

  insert into rh_marcacao (ponto_id, hora, seq) values (p.id, v_agora, v_n + 1);
  perform rh_recalc_ponto(p.id);

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object(
    'hora', v_agora, 'seq', v_n + 1,
    'aberto', (v_n + 1) % 2 = 1,
    'minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok);
end; $$;
revoke execute on function rh_bater_ponto(uuid) from public;
grant execute on function rh_bater_ponto(uuid) to authenticated;

-- Recalcula os dias vivos (não importados) com a régua nova.
do $$ declare r record; begin
  for r in select id from rh_ponto where origem is null loop perform rh_recalc_ponto(r.id); end loop;
end $$;

notify pgrst, 'reload schema';
