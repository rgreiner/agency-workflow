-- 164_rh_import_pontomais.sql
-- Importação do histórico do Pontomais (relatório Jornada) + saldo inicial do banco
-- de horas + feriado de meio período.
--
-- ⚠️ Dia importado é CONGELADO: guarda os totais do Pontomais como estão e o Flow
-- NÃO recalcula. Motivo: o Pontomais credita 8h fixas de "horas normais" e joga o
-- excedente em hora extra — régua diferente da do Flow. Recalcular faria o histórico
-- divergir do que as pessoas já viram e assinaram. Por isso rh_recalc_ponto passa a
-- ignorar linhas com origem='pontomais'.
-- Idempotente.

-- ── 3º par de marcações (o Pontomais tem 3; o Flow tinha 2) ──
alter table rh_ponto add column if not exists entrada3 time;
alter table rh_ponto add column if not exists saida3   time;

-- ── Origem + totais congelados do sistema de origem ──
alter table rh_ponto add column if not exists origem          text;   -- null = Flow · 'pontomais'
alter table rh_ponto add column if not exists imp_credito_min   int;
alter table rh_ponto add column if not exists imp_debito_min    int;
alter table rh_ponto add column if not exists imp_faltantes_min int;
alter table rh_ponto add column if not exists imp_intervalo_min int;
alter table rh_ponto add column if not exists imp_normais_min   int;
alter table rh_ponto add column if not exists imp_he50_min      int;
alter table rh_ponto add column if not exists imp_he100_min     int;
alter table rh_ponto add column if not exists imp_noturno_min   int;
alter table rh_ponto add column if not exists imp_saldo_acum_min int;  -- saldo acumulado do banco
alter table rh_ponto add column if not exists motivo          text;

-- ── Feriado de meio período (Cinzas, Jogos da copa): espera carga parcial ──
-- null = abona o dia inteiro (comportamento atual); 240 = espera 4h.
alter table rh_feriado add column if not exists carga_min int;

-- ── Saldo inicial do banco de horas (o que vem do sistema anterior) ──
create table if not exists rh_banco_inicial (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  data_ref       date not null,             -- saldo APURADO até esta data
  saldo_min      int  not null,
  origem         text not null default 'pontomais',
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create unique index if not exists rh_banco_inicial_uk on rh_banco_inicial (colaborador_id, data_ref);
alter table rh_banco_inicial enable row level security;
drop policy if exists rh_banco_inicial_rw on rh_banco_inicial;
create policy rh_banco_inicial_rw on rh_banco_inicial for all
  using (rh_can(org_id) or rh_is_self(colaborador_id)) with check (rh_can(org_id));

-- ── rh_recalc_ponto: não toca em dia importado (congelado) ──
create or replace function rh_recalc_ponto(p_ponto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  p rh_ponto; j rh_jornada; v_manha int; v_tarde int; v_noite int; v_min int;
  v_carga int; v_abona boolean; v_fcarga int;
begin
  select * into p from rh_ponto where id = p_ponto_id;
  if p.id is null then return; end if;
  -- Histórico importado é registro legal do sistema anterior: não recalcula.
  if p.origem is not null then return; end if;
  j := rh_jornada_de(p.colaborador_id);

  if p.entrada is null or p.saida is null then
    update rh_ponto set minutos = 0, saldo_min = 0, acima_10h = false, updated_at = now() where id = p.id;
    return;
  end if;

  v_manha := case when p.intervalo_ini is not null
                  then (extract(epoch from (p.intervalo_ini - p.entrada)) / 60)::int
                  else (extract(epoch from (p.saida - p.entrada)) / 60)::int end;
  v_tarde := case when p.intervalo_fim is not null
                  then (extract(epoch from (p.saida - p.intervalo_fim)) / 60)::int else 0 end;
  v_noite := case when p.entrada3 is not null and p.saida3 is not null
                  then (extract(epoch from (p.saida3 - p.entrada3)) / 60)::int else 0 end;
  v_min := greatest(0, coalesce(v_manha, 0) + coalesce(v_tarde, 0) + coalesce(v_noite, 0));

  v_carga := coalesce(j.carga_min, 480);
  select abona, carga_min into v_abona, v_fcarga from rh_feriado where org_id = p.org_id and data = p.data;
  if found then
    -- Feriado de meio período: espera carga_min; sem carga_min, abona o dia todo.
    v_carga := coalesce(v_fcarga, case when coalesce(v_abona, true) then 0 else v_carga end);
  elsif not (extract(isodow from p.data)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5]))) then
    v_carga := 0;
  end if;

  update rh_ponto set
    minutos   = least(v_min, coalesce(j.max_dia_min, 600)),
    acima_10h = (v_min > coalesce(j.max_dia_min, 600)),
    saldo_min = least(v_min, coalesce(j.max_dia_min, 600)) - v_carga,
    extra_status = case
      when least(v_min, coalesce(j.max_dia_min, 600)) - v_carga > 0 then coalesce(extra_status, 'pendente')
      else extra_status end,
    updated_at = now()
  where id = p.id;
end; $$;
revoke execute on function rh_recalc_ponto(uuid) from public;
grant execute on function rh_recalc_ponto(uuid) to authenticated;

-- ── Importa um colaborador do Pontomais ──
-- p_dias: [{data, m1..m6, credito_min, debito_min, faltantes_min, intervalo_min,
--           normais_min, he50_min, he100_min, noturno_min, saldo_min, motivo}]
-- Casa o colaborador por nome normalizado (rh_norm). Não cria ficha: se não achar, devolve erro.
create or replace function rh_importar_pontomais(
  p_org_id uuid, p_nome text, p_dias jsonb, p_saldo_final_min int, p_data_ref date
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_colab uuid; v_n int := 0; d jsonb; v_id uuid;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select id into v_colab from rh_colaborador
   where org_id = p_org_id and rh_norm(nome) = rh_norm(p_nome) and not arquivado
   limit 1;
  -- Nome do Pontomais costuma ser curto ("Danielle Silva") e a ficha vem da folha
  -- com o nome completo ("DANIELLE LAIS DA SILVA") → tenta casar por prefixo/contido.
  if v_colab is null then
    select id into v_colab from rh_colaborador
     where org_id = p_org_id and not arquivado
       and (rh_norm(nome) like rh_norm(split_part(p_nome, ' ', 1)) || '%'
            and rh_norm(nome) like '%' || rh_norm(split_part(p_nome, ' ', -1)) || '%')
     limit 1;
  end if;
  if v_colab is null then
    return jsonb_build_object('nome', p_nome, 'erro', 'Colaborador não encontrado no Flow', 'dias', 0);
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb))
  loop
    insert into rh_ponto (org_id, colaborador_id, data) values (p_org_id, v_colab, (d->>'data')::date)
      on conflict (colaborador_id, data) do nothing;
    select id into v_id from rh_ponto where colaborador_id = v_colab and data = (d->>'data')::date;

    update rh_ponto set
      entrada = nullif(d->>'m1','')::time, intervalo_ini = nullif(d->>'m2','')::time,
      intervalo_fim = nullif(d->>'m3','')::time, saida = nullif(d->>'m4','')::time,
      entrada3 = nullif(d->>'m5','')::time,  saida3 = nullif(d->>'m6','')::time,
      origem = 'pontomais',
      imp_credito_min = (d->>'credito_min')::int, imp_debito_min = (d->>'debito_min')::int,
      imp_faltantes_min = (d->>'faltantes_min')::int, imp_intervalo_min = (d->>'intervalo_min')::int,
      imp_normais_min = (d->>'normais_min')::int, imp_he50_min = (d->>'he50_min')::int,
      imp_he100_min = (d->>'he100_min')::int, imp_noturno_min = (d->>'noturno_min')::int,
      imp_saldo_acum_min = (d->>'saldo_min')::int, motivo = nullif(d->>'motivo',''),
      -- minutos/saldo do dia derivam dos totais do Pontomais (não da conta do Flow)
      minutos = coalesce((d->>'normais_min')::int, 0)
              + coalesce((d->>'he50_min')::int, 0) + coalesce((d->>'he100_min')::int, 0),
      saldo_min = coalesce((d->>'credito_min')::int, 0)
                - coalesce((d->>'debito_min')::int, 0) - coalesce((d->>'faltantes_min')::int, 0),
      updated_at = now()
    where id = v_id;
    v_n := v_n + 1;
  end loop;

  if p_saldo_final_min is not null and p_data_ref is not null then
    insert into rh_banco_inicial (org_id, colaborador_id, data_ref, saldo_min, origem, created_by)
    values (p_org_id, v_colab, p_data_ref, p_saldo_final_min, 'pontomais', auth.uid())
    on conflict (colaborador_id, data_ref) do update set saldo_min = excluded.saldo_min;
  end if;

  return jsonb_build_object('nome', p_nome, 'colaborador_id', v_colab, 'dias', v_n);
end; $$;
revoke execute on function rh_importar_pontomais(uuid, text, jsonb, int, date) from public;
grant execute on function rh_importar_pontomais(uuid, text, jsonb, int, date) to authenticated;

notify pgrst, 'reload schema';
