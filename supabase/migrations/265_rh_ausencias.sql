-- 265_rh_ausencias.sql
-- CALENDÁRIO DE AUSÊNCIAS DO TIME (pedido do Rafael, 28/08): "quem está fora
-- quando", numa grade só. Os dados já existiam — espalhados por cinco tabelas
-- e visíveis apenas na tela de cada assunto, o que obrigava a abrir Férias,
-- Ponto e Calendário para planejar a pauta de uma semana.
--
-- Fontes, nesta ordem de precedência quando o mesmo dia tem mais de uma:
--   1. feriado/emenda da org (rh_feriado)          → vale para todo mundo
--   2. ponte/recesso com adesão (rh_ferias_ponte)  → só quem aderiu (204/205)
--   3. férias programadas/gozadas (rh_ferias)
--   4. dias avulsos de férias (rh_ferias_lancamento)
--   5. justificativa decidida (atestado, médico, falta) — só aprovada/abonada
--      ou 'falta'; pendente NÃO entra (ainda não é ausência confirmada)
--      ⚠️ 'esqueci' e 'outro' SEM período declarado ficam de fora: medido em
--      prod, o time usa os dois para CORRIGIR marcação ("Flow falhou", "bati
--      sem querer") — 19 casos que apareceriam como gente fora do escritório.
--   6. aviso prévio na dispensa da última semana (262/263)
--
-- Uma linha por pessoa/dia AUSENTE — a tela monta a grade. Dia sem carga
-- (fim de semana / fora da escala) não vira ausência: seria ruído.
-- Só leitura, guard rh_can. Idempotente.

create or replace function rh_ausencias(p_org uuid, p_ini date, p_fim date)
returns table (
  colaborador_id uuid, nome text, cargo text,
  data date, tipo text, rotulo text, parcial boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_fim < p_ini or p_fim - p_ini > 400 then
    raise exception 'Período inválido (máximo 400 dias)';
  end if;

  return query
  with dias as (
    select generate_series(p_ini, p_fim, interval '1 day')::date as d
  ),
  pessoas as (
    select c.id, c.nome, c.cargo, c.bate_ponto, c.data_demissao,
           c.aviso_previo_ini, c.aviso_previo_fim, c.aviso_previo_modo
    from rh_colaborador c
    where c.org_id = p_org and not c.arquivado
      and (c.status <> 'desligado' or c.data_demissao is null or c.data_demissao >= p_ini)
  ),
  -- Grade só com dia ÚTIL da escala de cada pessoa e dentro do vínculo: fim de
  -- semana não é ausência, e ninguém "falta" antes de ser contratado.
  grade as (
    select p.*, d.d
    from pessoas p
    cross join dias d
    where coalesce(p.bate_ponto, true)
      and rh_no_vinculo(p.id, d.d)
      and extract(isodow from d.d)::int = any (
            coalesce((rh_jornada_de(p.id)).dias_semana, array[1,2,3,4,5]))
  ),
  marcado as (
    select g.id, g.nome, g.cargo, g.d,
           case
             when fe.data is not null and coalesce(fe.abona, true) then 'feriado'
             when pt.id is not null then 'ponte'
             when fr.id is not null then 'ferias'
             when fl.id is not null then 'ferias_avulsa'
             when g.aviso_previo_modo = 'ultima_semana'
                  and coalesce(g.aviso_previo_fim, g.data_demissao) is not null
                  and g.d between coalesce(g.aviso_previo_fim, g.data_demissao) - 6
                              and coalesce(g.aviso_previo_fim, g.data_demissao) then 'aviso'
             when ju.id is not null then ju.tipo
           end as tipo,
           case
             when fe.data is not null and coalesce(fe.abona, true) then coalesce(fe.nome, 'Feriado')
             when pt.id is not null then pt.nome
             when fr.id is not null then 'Férias' || case when fr.status = 'programada' then ' (programada)' else '' end
             when fl.id is not null then coalesce(nullif(btrim(fl.motivo), ''), 'Folga')
             when g.aviso_previo_modo = 'ultima_semana'
                  and coalesce(g.aviso_previo_fim, g.data_demissao) is not null
                  and g.d between coalesce(g.aviso_previo_fim, g.data_demissao) - 6
                              and coalesce(g.aviso_previo_fim, g.data_demissao) then 'Aviso prévio'
             when ju.id is not null then coalesce(nullif(btrim(ju.descricao), ''), ju.tipo)
           end as rotulo,
           -- Justificativa com período (declaração das 13h às 14h) é ausência
           -- PARCIAL: o dia continua tendo carga, só menor.
           (ju.id is not null and ju.ausencia_ini is not null and ju.ausencia_fim is not null) as parcial
      from grade g
      left join rh_feriado fe
        on fe.org_id = p_org and fe.data = g.d
      left join lateral (
        select pp.id, pp.nome from rh_ferias_ponte pp
         where pp.org_id = p_org and g.d between pp.inicio and pp.fim
           and not exists (select 1 from rh_ferias_ponte_excecao e
                           where e.ponte_id = pp.id and e.colaborador_id = g.id)
         limit 1) pt on true
      left join lateral (
        select f.id, f.status from rh_ferias f
         where f.colaborador_id = g.id and f.status <> 'cancelada'
           and g.d between f.inicio and f.fim
         limit 1) fr on true
      left join lateral (
        select l.id, l.motivo from rh_ferias_lancamento l
         where l.colaborador_id = g.id and g.d between l.inicio and l.fim
         limit 1) fl on true
      left join lateral (
        select j.id, j.tipo, j.descricao, j.ausencia_ini, j.ausencia_fim
          from rh_justificativa j
         where j.colaborador_id = g.id and g.d between j.data_ini and j.data_fim
           and j.status in ('aprovado', 'abonado', 'falta')
           -- Correção de marcação não é ausência: 'esqueci' nunca entra, e
           -- 'outro' só entra quando declara o período em que ficou fora.
           and (j.tipo in ('atestado', 'medico', 'falta')
                or (j.tipo = 'outro' and j.ausencia_ini is not null))
         order by j.created_at desc limit 1) ju on true
  )
  select m.id, m.nome, m.cargo, m.d, m.tipo, m.rotulo, coalesce(m.parcial, false)
    from marcado m
   where m.tipo is not null
   order by m.nome, m.d;
end $$;
revoke execute on function rh_ausencias(uuid, date, date) from public, anon;
grant  execute on function rh_ausencias(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
