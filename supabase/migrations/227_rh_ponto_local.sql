-- 227_rh_ponto_local.sql
-- Trava de presença no ponto — a pergunta aberta desde 22/07, agora respondida
-- pelo Rafael (10/08): detectar por IP da rede E geolocalização, em cascata; e
-- marcação feita fora vai para aprovação do RH.
--
-- Régua definida por ele: quem bate fora da agência **conta normalmente** e fica
-- SINALIZADO para revisão. É a mesma régua do resto do ponto — sinalizar em vez
-- de bloquear. Barrar a batida deixaria quem trabalha de casa sem registro
-- nenhum, que é pior do que registrar e revisar depois.
--
-- Cascata (mais barato → mais invasivo):
--   1. IP casa com a rede cadastrada  → dentro, sem pedir nada ao usuário
--   2. senão, coordenada dentro do raio → dentro
--   3. nenhum dos dois                  → fora, entra na fila do RH
--
-- O IP vem da server action (header do request); a coordenada, do navegador.
-- Quem negar a permissão de localização simplesmente cai no caso 3 — nunca é
-- impedido de bater.
--
-- Idempotente.

-- ── Locais autorizados ──────────────────────────────────────────────────────
create table if not exists rh_local (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  nome     text not null,
  -- IPs ou faixas CIDR da rede ('189.x.y.z' ou '189.x.y.0/24').
  ips      text[] not null default '{}',
  lat      numeric,
  lon      numeric,
  raio_m   int not null default 150,
  ativo    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rh_local_org_idx on rh_local (org_id) where ativo;

alter table rh_local enable row level security;
drop policy if exists rh_local_rw on rh_local;
create policy rh_local_rw on rh_local for all using (rh_can(org_id)) with check (rh_can(org_id));

-- ── Onde a batida aconteceu ─────────────────────────────────────────────────
alter table rh_marcacao add column if not exists lat         numeric;
alter table rh_marcacao add column if not exists lon         numeric;
alter table rh_marcacao add column if not exists ip          text;
alter table rh_marcacao add column if not exists local_id    uuid references rh_local(id) on delete set null;
alter table rh_marcacao add column if not exists fora        boolean;
alter table rh_marcacao add column if not exists fora_status text;   -- pendente|aprovado|rejeitado
alter table rh_marcacao add column if not exists fora_motivo text;   -- o que a pessoa escreveu ao bater
alter table rh_marcacao add column if not exists fora_por    uuid;
alter table rh_marcacao add column if not exists fora_em     timestamptz;
create index if not exists rh_marcacao_fora_idx on rh_marcacao (fora_status) where fora_status = 'pendente';

-- ── Qual local reconhece esta batida? ───────────────────────────────────────
-- Distância pela fórmula do haversine (raio da Terra 6371 km). Precisão de
-- metros é de sobra para "está no escritório?" e evita depender de PostGIS.
create or replace function rh_local_de(p_org uuid, p_ip text, p_lat numeric, p_lon numeric)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  -- 1. IP da rede: silencioso, não pede permissão nenhuma.
  if coalesce(btrim(p_ip), '') <> '' then
    select l.id into v_id from rh_local l
     where l.org_id = p_org and l.ativo
       and exists (
         select 1 from unnest(l.ips) as faixa
          where (faixa like '%/%' and inet(p_ip) << faixa::cidr)
             or (faixa not like '%/%' and btrim(faixa) = btrim(p_ip)))
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- 2. Coordenada dentro do raio.
  if p_lat is not null and p_lon is not null then
    select l.id into v_id from rh_local l
     where l.org_id = p_org and l.ativo and l.lat is not null and l.lon is not null
       and 6371000 * 2 * asin(sqrt(
             power(sin(radians(p_lat - l.lat) / 2), 2)
             + cos(radians(l.lat)) * cos(radians(p_lat))
             * power(sin(radians(p_lon - l.lon) / 2), 2))) <= l.raio_m
     order by 6371000 * 2 * asin(sqrt(
             power(sin(radians(p_lat - l.lat) / 2), 2)
             + cos(radians(l.lat)) * cos(radians(p_lat))
             * power(sin(radians(p_lon - l.lon) / 2), 2)))
     limit 1;
  end if;

  return v_id;
end $$;
revoke execute on function rh_local_de(uuid, text, numeric, numeric) from public, anon;
grant  execute on function rh_local_de(uuid, text, numeric, numeric) to authenticated;

-- ── Bater ponto com localização ─────────────────────────────────────────────
-- PostgREST é estrito com overload: derruba a assinatura de 1 argumento.
drop function if exists rh_bater_ponto(uuid);
create or replace function rh_bater_ponto(
  p_colaborador_id uuid,
  p_lat numeric default null, p_lon numeric default null,
  p_ip text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; p rh_ponto; v_n int; v_ult timestamptz;
  v_local uuid; v_fora boolean; v_exige boolean;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  -- O segundo morre aqui: o ponto é no nível do minuto (mig. 221).
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  v_agora := make_time(extract(hour from v_agora)::int, extract(minute from v_agora)::int, 0);

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, p_colaborador_id, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = v_hoje;

  select count(*), max(created_at) into v_n, v_ult from rh_marcacao where ponto_id = p.id;

  -- Trava de duplo-clique: 1 minuto de relógio REAL entre marcações.
  if v_ult is not null and now() - v_ult < interval '1 minute' then
    raise exception 'Você acabou de registrar uma marcação. Aguarde um instante.';
  end if;

  -- Só classifica quando a org cadastrou algum local; sem cadastro, ninguém
  -- vira "fora" (senão ligar a migration marcaria o time inteiro).
  select exists (select 1 from rh_local where org_id = v_org and ativo) into v_exige;
  v_local := case when v_exige then rh_local_de(v_org, p_ip, p_lat, p_lon) end;
  v_fora  := v_exige and v_local is null;

  insert into rh_marcacao (ponto_id, hora, seq, lat, lon, ip, local_id, fora, fora_status, fora_motivo)
  values (p.id, v_agora, v_n + 1, p_lat, p_lon, nullif(btrim(coalesce(p_ip, '')), ''), v_local,
          v_fora, case when v_fora then 'pendente' end,
          case when v_fora then nullif(btrim(coalesce(p_motivo, '')), '') end);

  -- A batida fora CONTA: o recálculo roda igual. A revisão é do RH, depois.
  perform rh_recalc_ponto(p.id);

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object(
    'hora', v_agora, 'seq', v_n + 1,
    'aberto', (v_n + 1) % 2 = 1,
    'fora', coalesce(v_fora, false),
    'local', (select nome from rh_local where id = v_local),
    'minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok);
end $$;
revoke execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) from public, anon;
grant  execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) to authenticated;

-- ── Fila do RH: marcações fora aguardando decisão ───────────────────────────
create or replace function rh_marcacoes_fora(p_org uuid, p_status text default 'pendente')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'marcacao_id', m.id, 'data', p.data, 'hora', to_char(m.hora, 'HH24:MI'), 'seq', m.seq,
      'colaborador_id', c.id, 'nome', c.nome, 'cargo', c.cargo,
      'lat', m.lat, 'lon', m.lon, 'ip', m.ip,
      'motivo', m.fora_motivo, 'status', m.fora_status,
      'decidido_por', (select pr.full_name from profiles pr where pr.id = m.fora_por),
      'decidido_em', m.fora_em)
      order by p.data desc, m.seq)
      from rh_marcacao m
      join rh_ponto p on p.id = m.ponto_id
      join rh_colaborador c on c.id = p.colaborador_id
     where p.org_id = p_org and m.fora and m.fora_status = coalesce(p_status, 'pendente')), '[]'::jsonb);
end $$;
revoke execute on function rh_marcacoes_fora(uuid, text) from public, anon;
grant  execute on function rh_marcacoes_fora(uuid, text) to authenticated;

-- ── Decidir uma marcação fora ───────────────────────────────────────────────
-- Aprovar/rejeitar aqui é AUDITORIA: a hora já contou desde a batida. Rejeitar
-- não apaga marcação — corrigir o dia continua sendo `rh_editar_ponto`, o
-- caminho único (mig. 193), que grava motivo e histórico.
create or replace function rh_marcacao_decidir_fora(p_marcacao uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select p.org_id into v_org from rh_marcacao m join rh_ponto p on p.id = m.ponto_id where m.id = p_marcacao;
  if v_org is null then raise exception 'Marcação não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_status not in ('aprovado','rejeitado') then raise exception 'Status inválido'; end if;

  update rh_marcacao set fora_status = p_status, fora_por = auth.uid(), fora_em = now()
   where id = p_marcacao;
end $$;
revoke execute on function rh_marcacao_decidir_fora(uuid, text) from public, anon;
grant  execute on function rh_marcacao_decidir_fora(uuid, text) to authenticated;

notify pgrst, 'reload schema';
