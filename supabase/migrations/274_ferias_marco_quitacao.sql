-- 274_ferias_marco_quitacao.sql
-- MARCO DE QUITAÇÃO DAS FÉRIAS ANTERIORES AO FLOW (decisão do Rafael, 01/09).
--
-- A casa fecha no recesso de fim de ano e paga férias e 13º do ano corrente —
-- então, quando o Flow entrou, não havia passivo antigo. Só que `rh_ferias`
-- nasceu vazia e a visão CLT (calculada da admissão) lia isso como férias NÃO
-- gozadas: medido em prod, a Danielle aparecia com DOIS períodos vencidos
-- (60 dias) que na prática foram tirados nos recessos de 2023 e 2024 — e
-- período vencido tem peso legal (art. 137, pagamento em dobro).
--
-- Rota escolhida: nem lançar três anos de recesso (ninguém tem as datas
-- exatas, e o Flow guarda só o ciclo corrente — ver a régua da casa), nem
-- esquecer em silêncio. Um MARCO por org: períodos encerrados até a data
-- entram como `quitado_pre_flow`, dizendo por que sumiram do passivo.
--
-- Não mexe na régua da casa (2,5 dias/mês por ano civil, recesso absorve,
-- janeiro zera) — aquela nunca dependeu de histórico.
-- Idempotente.

alter table org_settings add column if not exists ferias_quitadas_ate date;

create or replace function rh_set_ferias_marco(p_org uuid, p_data date)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- org_settings só escreve por RPC (016/130): update direto afeta 0 linhas
  -- e a tela diz "salvo" com o banco intacto.
  insert into org_settings (org_id, ferias_quitadas_ate) values (p_org, p_data)
  on conflict (org_id) do update set ferias_quitadas_ate = excluded.ferias_quitadas_ate;
end $$;
revoke execute on function rh_set_ferias_marco(uuid, date) from public, anon;
grant  execute on function rh_set_ferias_marco(uuid, date) to authenticated;

-- ── Períodos: o marco entra ANTES de qualquer outra classificação ───────────
CREATE OR REPLACE FUNCTION public.rh_ferias_periodos(p_org uuid)
 RETURNS TABLE(colaborador_id uuid, pessoa text, data_admissao date, periodo_inicio date, periodo_fim date, limite date, dias_direito integer, dias_gozados integer, dias_programados integer, dias_saldo integer, em_formacao boolean, dias_para_limite integer, situacao text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  return query
  with pessoas as (
    select c.id, c.nome, c.data_admissao
      from rh_colaborador c
     where c.org_id = p_org and c.tipo_vinculo = 'clt'
       and c.status = 'ativo' and coalesce(c.arquivado, false) = false
       and c.data_admissao is not null
  ),
  ciclos as (
    select p.id, p.nome, p.data_admissao,
           (p.data_admissao + (n * interval '1 year'))::date as p_ini
      from pessoas p
      -- Um ciclo por ano completo desde a admissão, mais o que está em formação.
      cross join generate_series(0,
        greatest(0, floor(extract(epoch from age(current_date, p.data_admissao)) / (365.2425 * 86400))::int)) n
  ),
  base as (
    select c.id as colaborador_id, c.nome as pessoa, c.data_admissao,
           c.p_ini as periodo_inicio,
           (c.p_ini + interval '1 year' - interval '1 day')::date as periodo_fim,
           (c.p_ini + interval '2 years' - interval '1 day')::date as limite
      from ciclos c
  )
  select b.colaborador_id, b.pessoa, b.data_admissao,
         b.periodo_inicio, b.periodo_fim, b.limite,
         30 as dias_direito,
         coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status = 'gozada'), 0)::int as dias_gozados,
         coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status = 'programada'), 0)::int as dias_programados,
         (30 - coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status in ('gozada','programada')), 0))::int as dias_saldo,
         (b.periodo_fim > current_date) as em_formacao,
         (b.limite - current_date)::int as dias_para_limite,
         case
           -- Antes do Flow a casa quitava tudo no recesso de fim de ano: o
           -- período que fechou até o marco NÃO é passivo (mig. 274). Sem
           -- isso a tela acusava 60 dias vencidos que já tinham sido gozados.
           when b.periodo_fim <= (select ferias_quitadas_ate from org_settings
                                  where org_id = p_org) then 'quitado_pre_flow'
           when b.periodo_fim > current_date then 'em_formacao'
           when (30 - coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status in ('gozada','programada')), 0)) <= 0 then 'quitado'
           -- Passou do concessivo: a partir daqui é férias em dobro (art. 137).
           when b.limite < current_date then 'vencido'
           when (b.limite - current_date) <= 90 then 'vence_em_breve'
           else 'aberto'
         end as situacao
    from base b
   order by b.pessoa, b.periodo_inicio;
end $function$;

notify pgrst, 'reload schema';
