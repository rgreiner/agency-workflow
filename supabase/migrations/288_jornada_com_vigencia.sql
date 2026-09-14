-- 288_jornada_com_vigencia.sql
-- A JORNADA PASSA A TER LINHA DO TEMPO (14/09/2026).
--
-- Caso que revelou: a Luiza Medeiros era estagiária de 6h e virou CLT de 8h.
-- `rh_jornada` guardava UM estado por pessoa, sem vigência, e todo cálculo de
-- carga lia esse estado atual — inclusive para dias do passado. Medido em
-- prod antes de mexer: trocar a jornada dela de 360 para 480 min fazia a
-- falta do ciclo 26/08–25/09 saltar de **6h para 29h43** — ~23h40 inventadas
-- em dias que ela cumpriu corretamente as 6h, e que iriam para a
-- contabilidade no fechamento.
--
-- É a mesma família de "falta inventada" das migrations 228–230: carga
-- esperada errada por ler o presente e aplicar ao passado.
--
-- Agora cada linha de `rh_jornada` vale A PARTIR de uma data. Mudar a jornada
-- hoje cria uma vigência nova; o histórico continua com a jornada que valia
-- no dia. O que já existe recebe 1900-01-01 (sempre valeu).
--
-- `rh_jornada_de(uuid)` SOBREVIVE com a mesma assinatura (8 funções a usam) e
-- passa a significar "a vigente hoje". Quem calcula carga de um DIA usa a
-- nova `rh_jornada_em(uuid, date)`.
-- Idempotente.

alter table rh_jornada add column if not exists vigencia_ini date not null default date '1900-01-01';

-- Uma jornada por pessoa POR VIGÊNCIA (antes era uma só por pessoa).
drop index if exists rh_jornada_colab;
drop index if exists rh_jornada_org_default;
create unique index if not exists rh_jornada_colab_vig
  on rh_jornada (colaborador_id, vigencia_ini) where colaborador_id is not null;
create unique index if not exists rh_jornada_org_default_vig
  on rh_jornada (org_id, vigencia_ini) where colaborador_id is null;

-- ── A jornada que valia num DIA ────────────────────────────────────────────
-- Override da pessoa vence o padrão da org; dentro de cada um, a vigência
-- mais recente que já começou naquele dia.
create or replace function rh_jornada_em(p_colaborador_id uuid, p_data date)
returns rh_jornada language sql stable security definer set search_path to 'public' as $$
  select j.* from rh_jornada j
  where (j.colaborador_id = p_colaborador_id
         or (j.colaborador_id is null
             and j.org_id = (select org_id from rh_colaborador where id = p_colaborador_id)))
    and j.vigencia_ini <= p_data
  order by (j.colaborador_id is not null) desc, j.vigencia_ini desc
  limit 1;
$$;
revoke execute on function rh_jornada_em(uuid, date) from public, anon, authenticated;

-- Mesma assinatura de sempre: a jornada vigente HOJE.
create or replace function rh_jornada_de(p_colaborador_id uuid)
returns rh_jornada language sql stable security definer set search_path to 'public' as $$
  select * from rh_jornada_em(p_colaborador_id, (now() at time zone 'America/Sao_Paulo')::date);
$$;

notify pgrst, 'reload schema';
