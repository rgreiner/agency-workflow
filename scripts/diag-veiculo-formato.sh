#!/usr/bin/env bash
# Levantamento de Veículo / Formato / Título da demanda no histórico de tarefas.
#
# Responde: (1) o que da lista fixa NUNCA foi usado, (2) o que a equipe mais
# DIGITA no "Outro" e deveria virar opção, (3) que padrão novo apareceu.
#
# Contexto que muda a leitura do resultado — ler antes de concluir qualquer coisa:
#  · Veículo e formato NÃO são colunas. Vivem dentro de `activities.title`, no
#    padrão "AAMMDD - Veículo - Formato - Título da demanda" (src/lib/atividade-titulo.ts).
#    Tudo aqui é parsing de texto: título fora do padrão é ruído, não ausência de uso.
#  · Duas origens escrevem nesse mesmo formato com vocabulários DIFERENTES:
#    a pauta (NewActivityForm → plataformas: Meta, TikTok…) e a entrega de mídia
#    (midia-hub.tituloDaTarefa → veículo do CADASTRO: jornal, rádio, OOH…).
#    Por isso todo ranking sai também quebrado por origem.
#  · drive-sync (nome da pasta), import-specs (nome da peça) e a criação inline
#    gravam título livre — caem em "fora do padrão" sem ter fugido de nada.
#
# Uso no VPS: bash diag-veiculo-formato.sh
set -euo pipefail

DB=""
for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc \
    "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null || true)
  if [ "$HAS" = "1" ]; then DB="$N"; break; fi
done
[ -n "$DB" ] && echo ">>> Flow em $DB" || { echo "!! container do Flow não encontrado"; exit 1; }

docker exec -i "$DB" psql -U postgres -d postgres <<'SQL'
\pset pager off

-- Parsing do título em (data, veículo, formato, demanda) + origem.
create temp view t as
with cru as (
  select a.id, a.title, a.created_at, a.archived,
         (e.id is not null) as da_midia,
         string_to_array(a.title, ' - ') as arr
    from activities a
    left join midia_entrega e on e.activity_id = a.id
),
sem_data as (
  select id, title, created_at, archived, da_midia, arr,
         (btrim(coalesce(arr[1],'')) ~ '^\d{6}$') as tem_data,
         case when btrim(coalesce(arr[1],'')) ~ '^\d{6}$' then arr[2:] else arr end as p
    from cru
)
select id, title, created_at, archived, da_midia, tem_data,
       cardinality(p) as segmentos,
       case when cardinality(p) >= 3 then btrim(p[1]) end as veiculo,
       case when cardinality(p) >= 3 then btrim(p[2]) end as formato,
       case when cardinality(p) >= 3 then array_to_string(p[3:], ' - ')
            else array_to_string(p, ' - ') end as demanda
  from sem_data;

-- As listas fixas de hoje (espelho de src/lib/atividade-titulo.ts).
create temp view lista_veiculo as
select unnest(array['Meta','Instagram','Facebook','WhatsApp','TikTok','YouTube',
                    'Google Ads','LinkedIn','E-mail','Impresso','TV','Rádio','Site']) as v;
create temp view lista_formato as
select unnest(array['Carrossel','Post','Stories','Reels','Vídeo','Banner',
                    'Arte estática','GIF','Identidade Visual','Texto','Roteiro',
                    'Apresentação']) as f;

\echo
\echo ====== 0. Universo ======
select count(*) as tarefas,
       count(*) filter (where archived) as arquivadas,
       count(*) filter (where da_midia) as abertas_pela_midia,
       min(created_at)::date as primeira, max(created_at)::date as ultima
  from t;

\echo
\echo ====== 1. Cobertura do padrao (o parsing e confiavel?) ======
select case when segmentos >= 3 and tem_data then 'completo (data+veic+form+titulo)'
            when segmentos >= 3               then 'sem data, resto no padrao'
            when segmentos = 2                then 'ambiguo (2 segmentos)'
            else 'fora do padrao (titulo livre)' end as forma,
       count(*), round(100.0*count(*)/sum(count(*)) over (), 1) as pct
  from t group by 1 order by 2 desc;

\echo
\echo ====== 2. Cobertura por origem e por mes (o padrao esta pegando ou afrouxando?) ======
select date_trunc('month', created_at)::date as mes,
       count(*) filter (where not da_midia) as pauta,
       count(*) filter (where not da_midia and segmentos >= 3) as pauta_no_padrao,
       count(*) filter (where da_midia) as midia
  from t group by 1 order by 1;

\echo
\echo ====== 3. VEICULO: uso de cada item da lista (0 = NUNCA USADO) ======
select l.v as veiculo_da_lista,
       count(t.id) as usos,
       count(t.id) filter (where t.created_at > now() - interval '90 days') as usos_90d,
       max(t.created_at)::date as ultimo_uso
  from lista_veiculo l
  left join t on lower(t.veiculo) = lower(l.v) and not t.da_midia
 group by l.v order by usos asc, l.v;

\echo
\echo ====== 4. VEICULO digitado no "Outro" (candidatos a virar opcao) ======
select lower(veiculo) as digitado, count(*) as vezes,
       count(*) filter (where created_at > now() - interval '90 days') as em_90d,
       min(veiculo) as grafia_1, max(veiculo) as grafia_2,
       max(created_at)::date as ultimo
  from t
 where veiculo is not null and not da_midia
   and lower(veiculo) not in (select lower(v) from lista_veiculo)
 group by 1 having count(*) >= 2 order by vezes desc limit 40;

\echo
\echo ====== 5. FORMATO: uso de cada item da lista (0 = NUNCA USADO) ======
select l.f as formato_da_lista,
       count(t.id) as usos,
       count(t.id) filter (where t.da_midia) as via_midia,
       count(t.id) filter (where t.created_at > now() - interval '90 days') as usos_90d,
       max(t.created_at)::date as ultimo_uso
  from lista_formato l
  left join t on lower(t.formato) = lower(l.f)
 group by l.f order by usos asc, l.f;

\echo
\echo ====== 6. FORMATO digitado no "Outro" (candidatos a virar opcao) ======
select lower(formato) as digitado, count(*) as vezes,
       count(*) filter (where da_midia) as via_midia,
       count(*) filter (where created_at > now() - interval '90 days') as em_90d,
       max(created_at)::date as ultimo
  from t
 where formato is not null
   and lower(formato) not in (select lower(f) from lista_formato)
 group by 1 having count(*) >= 2 order by vezes desc limit 40;

\echo
\echo ====== 6b. CONCENTRACAO do "Outro" (decide a rota) ======
-- Se poucos valores concentram os digitados, ampliar a lista resolve.
-- Se e cauda longa de valores unicos, o problema nao e a lista: o campo
-- esta sendo usado para outra coisa (ou nao deveria ser lista fechada).
with fora as (
  select 'veiculo' as campo, lower(veiculo) as valor from t
    where veiculo is not null and not da_midia
      and lower(veiculo) not in (select lower(v) from lista_veiculo)
  union all
  select 'formato', lower(formato) from t
    where formato is not null
      and lower(formato) not in (select lower(f) from lista_formato)
),
cont as (select campo, valor, count(*) as n from fora group by 1,2),
rk as (select *, row_number() over (partition by campo order by n desc) as pos from cont)
select campo,
       sum(n) as digitados_total,
       count(*) as valores_distintos,
       count(*) filter (where n = 1) as usados_uma_vez,
       sum(n) filter (where pos <= 5) as no_top5,
       round(100.0 * sum(n) filter (where pos <= 5) / nullif(sum(n),0), 1) as pct_top5
  from rk group by campo;

\echo
\echo ====== 7. DERIVA: o que cresceu e o que morreu (90d vs. antes) ======
select 'veiculo' as campo, coalesce(lower(veiculo),'(vazio)') as valor,
       count(*) filter (where created_at > now() - interval '90 days') as ult_90d,
       count(*) filter (where created_at <= now() - interval '90 days') as antes
  from t where not da_midia and veiculo is not null group by 1,2
union all
select 'formato', coalesce(lower(formato),'(vazio)'),
       count(*) filter (where created_at > now() - interval '90 days'),
       count(*) filter (where created_at <= now() - interval '90 days')
  from t where formato is not null group by 1,2
 order by ult_90d desc limit 40;

\echo
\echo ====== 8. Combinacoes veiculo x formato mais frequentes ======
select lower(veiculo) as veiculo, lower(formato) as formato, count(*) as vezes
  from t where veiculo is not null and not da_midia
 group by 1,2 order by vezes desc limit 25;

\echo
\echo ====== 9. Palavras recorrentes no TITULO DA DEMANDA (campo escondido?) ======
select palavra, count(*) as vezes, count(distinct id) as tarefas
  from (
    select id, lower(regexp_split_to_table(demanda, '[^[:alnum:]]+')) as palavra
      from t where demanda is not null and demanda <> ''
  ) w
 where length(palavra) >= 4 and palavra !~ '^\d+$'
   and palavra not in ('para','pela','pelo','como','esse','essa','este','esta',
                       'sobre','entre','ainda','onde','mais','todo','toda','sem')
 group by 1 having count(*) >= 5 order by vezes desc limit 50;

\echo
\echo ====== 10. Titulos renomeados depois da criacao (o padrao nao coube) ======
select count(*) as renomeacoes, count(distinct activity_id) as tarefas,
       count(*) filter (where old_value ~ '^\d{6} - ' and new_value !~ '^\d{6} - ') as saiu_do_padrao,
       count(*) filter (where old_value !~ '^\d{6} - ' and new_value ~ '^\d{6} - ') as entrou_no_padrao
  from activity_field_history where field_name = 'title';

\echo
\echo ====== 11. Amostra de titulo fora do padrao (para ler com o olho) ======
select left(title, 90) as titulo, da_midia, created_at::date
  from t where segmentos < 3 and not da_midia
 order by created_at desc limit 30;
SQL
