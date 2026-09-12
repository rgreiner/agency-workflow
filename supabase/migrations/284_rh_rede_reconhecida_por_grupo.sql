-- 284_rh_rede_reconhecida_por_grupo.sql
-- O IP público do escritório NÃO é fixo. Medido em produção (11/09/2026, 90 dias):
-- 56 IPs distintos em 34 faixas /24, e o IP do escritório trocou 5 vezes em ~30
-- dias úteis (186.224.74.76 → .44 → .130 → 177.188.18.113 → 177.102.43.146 →
-- 152.250.98.87). No dia da troca a rede deixa de ser reconhecida e o TIME
-- INTEIRO cai na fila do RH: das 182 marcações "fora" em 60 dias, 123 estavam
-- num IP com 3+ pessoas diferentes no mesmo dia. Cadastrar faixa não resolve
-- (os blocos mudam inteiros) e o degrau da coordenada só cobre quem autoriza.
--
-- Decisão do Rafael (12/09/2026): a própria equipe prova qual é a rede. Três
-- pessoas diferentes batendo do mesmo IP no mesmo dia = escritório, com ou sem
-- cadastro. Fica REGISTRADO que foi o grupo (reconhecido_por = 'grupo'), para o
-- RH enxergar o caso em que um time inteiro trabalhou junto fora da agência.
--
-- Idempotente.

-- ── Como a rede foi reconhecida ─────────────────────────────────────────────
alter table rh_marcacao add column if not exists reconhecido_por text;   -- null | 'grupo'
comment on column rh_marcacao.reconhecido_por is
  'grupo = rede reconhecida por 3+ pessoas no mesmo IP no mesmo dia, não por cadastro (mig. 284)';

-- ── Quantas pessoas DIFERENTES bateram deste IP neste dia ───────────────────
-- Helper interno: sem grant (a chamada de dentro da RPC vale pelo dono).
create or replace function rh_pessoas_no_ip(p_org uuid, p_data date, p_ip text)
returns int language sql stable security definer set search_path to 'public' as $$
  select count(distinct pt.colaborador_id)::int
    from rh_marcacao m join rh_ponto pt on pt.id = m.ponto_id
   where pt.org_id = p_org and pt.data = p_data
     and m.ip is not null and btrim(m.ip) = btrim(p_ip)
$$;
revoke execute on function rh_pessoas_no_ip(uuid, date, text) from public, anon;

-- ── Bater ponto: cascata + reconhecimento pelo grupo ────────────────────────
-- Base: a versão viva (mig. 255). Muda só o trecho do reconhecimento.
create or replace function rh_bater_ponto(
  p_colaborador_id uuid,
  p_lat numeric default null, p_lon numeric default null,
  p_ip text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; p rh_ponto; v_n int; v_ult timestamptz;
  v_local uuid; v_fora boolean; v_exige boolean;
  v_ip text; v_grupo boolean := false; v_local_unico uuid;
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
  v_ip    := nullif(btrim(coalesce(p_ip, '')), '');

  insert into rh_marcacao (ponto_id, hora, seq, lat, lon, ip, local_id, fora, fora_status, fora_motivo)
  values (p.id, v_agora, v_n + 1, p_lat, p_lon, v_ip, v_local,
          v_fora, case when v_fora then 'pendente' end,
          case when v_fora then nullif(btrim(coalesce(p_motivo, '')), '') end);

  -- ── Rede reconhecida pelo GRUPO ───────────────────────────────────────────
  -- 3 pessoas diferentes no mesmo IP no mesmo dia é o escritório, mesmo sem
  -- cadastro. A contagem roda DEPOIS do insert, então a 3ª pessoa do dia já
  -- entra reconhecida — e as duas primeiras, que caíram como "fora" antes de
  -- existir grupo, são reclassificadas junto. Decisão do RH já tomada
  -- (aprovado/rejeitado) não é tocada.
  if v_fora and v_ip is not null and rh_pessoas_no_ip(v_org, v_hoje, v_ip) >= 3 then
    -- Um único local ativo: a batida fica amarrada a ele. Com mais de um, não
    -- dá pra saber qual — fica sem local, só com o reconhecimento registrado.
    select l.id into v_local_unico from rh_local l
     where l.org_id = v_org and l.ativo
       and (select count(*) from rh_local x where x.org_id = v_org and x.ativo) = 1;

    update rh_marcacao m
       set fora = false, fora_status = null, reconhecido_por = 'grupo',
           local_id = coalesce(m.local_id, v_local_unico)
      from rh_ponto pt
     where pt.id = m.ponto_id and pt.org_id = v_org and pt.data = v_hoje
       and m.ip is not null and btrim(m.ip) = v_ip
       and m.fora and m.fora_status = 'pendente';

    v_fora := false; v_grupo := true;
  end if;

  -- A batida fora CONTA: o recálculo roda igual. A revisão é do RH, depois.
  perform rh_recalc_ponto(p.id);

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object(
    'hora', v_agora, 'seq', v_n + 1,
    'aberto', (v_n + 1) % 2 = 1,
    'fora', coalesce(v_fora, false),
    'local', (select nome from rh_local where id = coalesce(v_local, v_local_unico)),
    -- 'grupo' = a rede foi reconhecida pela equipe, não pelo cadastro.
    'reconhecido_por', case when v_grupo then 'grupo' end,
    'minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
    -- Estado da extra do dia: o front pergunta o contexto quando a batida
    -- FECHOU o período (aberto=false), a extra pende e ainda não há contexto.
    'extra_status', p.extra_status,
    'tem_contexto', (p.motivo is not null or p.extra_projeto is not null));
end $$;
revoke execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) from public, anon;
grant  execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) to authenticated;

-- ── O que o grupo reconheceu (visão do RH) ──────────────────────────────────
create or replace function rh_redes_do_grupo(p_org uuid, p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.ultima desc, x.marcacoes desc) from (
      select m.ip,
             min(pt.data)::text as primeira, max(pt.data)::text as ultima,
             count(*)::int as marcacoes,
             count(distinct pt.colaborador_id)::int as pessoas,
             -- Já está cadastrado num local? Mesma régua da batida, sem cópia.
             (rh_local_de(p_org, m.ip, null, null) is not null) as cadastrado
        from rh_marcacao m join rh_ponto pt on pt.id = m.ponto_id
       where pt.org_id = p_org and m.reconhecido_por = 'grupo'
         and pt.data >= current_date - p_dias
       group by m.ip) x), '[]'::jsonb);
end $$;
revoke execute on function rh_redes_do_grupo(uuid, int) from public, anon;
grant  execute on function rh_redes_do_grupo(uuid, int) to authenticated;

-- ── Passivo: aplicar a mesma régua no que já está na fila ───────────────────
-- As marcações pendentes que estão num IP com 3+ pessoas no mesmo dia são o
-- mesmo caso (IP do escritório trocado) — sai da fila e fica marcado como
-- reconhecido pelo grupo. Só mexe em 'pendente': o que o RH já decidiu fica.
do $$
declare v_n int;
begin
  with grupo as (
    select pt.org_id, pt.data, m.ip
      from rh_marcacao m join rh_ponto pt on pt.id = m.ponto_id
     where m.ip is not null
     group by pt.org_id, pt.data, m.ip
    having count(distinct pt.colaborador_id) >= 3
  ), unico as (
    select l.org_id, min(l.id::text)::uuid as local_id
      from rh_local l where l.ativo group by l.org_id having count(*) = 1
  )
  update rh_marcacao m
     set fora = false, fora_status = null, reconhecido_por = 'grupo',
         local_id = coalesce(m.local_id, u.local_id)
    from rh_ponto pt
    join grupo g on g.org_id = pt.org_id and g.data = pt.data
    left join unico u on u.org_id = pt.org_id
   where pt.id = m.ponto_id and m.ip is not null and btrim(m.ip) = btrim(g.ip)
     and m.fora and m.fora_status = 'pendente';
  get diagnostics v_n = row_count;
  raise notice 'marcações reclassificadas como rede do grupo: %', v_n;
end $$;

notify pgrst, 'reload schema';
