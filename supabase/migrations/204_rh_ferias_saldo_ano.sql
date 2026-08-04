-- 204_rh_ferias_saldo_ano.sql
-- A régua REAL da One a One, que até agora vivia na "Planilha de Férias AAAA"
-- do Drive. Ela não é a régua da CLT — é a política da casa, e as duas convivem:
--
--   · saldo do ANO CIVIL: 2,5 dias por mês trabalhado (30/ano), contado do 1º de
--     janeiro e não do aniversário de admissão. Mês de admissão só conta se
--     tiver 15+ dias de vínculo (mesma regra dos avos do 13º, já usada na 201).
--   · EMENDA de feriado (a ponte): a pessoa fica fora os dias todos, mas o saldo
--     é debitado em 1 dia só — a casa banca o resto. A adesão é opcional, então
--     o que se grava é quem FICOU DE FORA (exceção), não quem aderiu: assim uma
--     ponte nova já nasce valendo para todo o time, que é o caso comum.
--   · dias avulsos / férias tiradas no ano: debitam 1:1.
--   · o que sobrar é gozado no RECESSO entre Natal e Ano Novo, quando a agência
--     fecha. A volta é individual: início do recesso + saldo, em dias corridos.
--     Quem tem menos saldo volta antes (decisão do Rafael, 04/08) — não existe
--     piso nem saldo negativo, e por isso em janeiro a tabela zera para todos.
--
-- Modelagem na mesma linha da 201: o que é consequência aritmética (dias
-- adquiridos, saldo, data de volta) é CALCULADO; só decisão humana é gravada
-- (a ponte, quem ficou de fora dela, o dia avulso, o início do recesso e o
-- eventual ajuste de volta na mão).
--
-- Deliberadamente FORA: abonar no PONTO o dia de quem emendou. O calendário
-- (rh_feriado, mig. 162) abona para a org inteira, e numa ponte parte do time
-- trabalha — abonar todo mundo daria hora extra a quem estava no escritório. O
-- caminho certo é o ajuste 'abonado' por pessoa (mig. 163/193); fica para
-- quando o Rafael pedir.
--
-- Idempotente.

-- ── Emenda de feriado (ponte) ───────────────────────────────────────────────
create table if not exists rh_ferias_ponte (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  nome        text not null,                       -- "Carnaval", "Tiradentes"…
  inicio      date not null,
  fim         date not null,
  -- Quanto custa do saldo. 1 dia é a política atual, mas fica por ponte: uma
  -- ponte maior pode custar 2 sem virar exceção escondida no código.
  custo_dias  numeric(4,1) not null default 1,
  observacao  text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint rh_ferias_ponte_datas_ck check (fim >= inicio),
  constraint rh_ferias_ponte_custo_ck check (custo_dias >= 0 and custo_dias <= 30)
);
create index if not exists rh_ferias_ponte_org_idx on rh_ferias_ponte (org_id, inicio);

-- Quem NÃO emendou. Ausência de linha = emendou (o padrão da casa).
create table if not exists rh_ferias_ponte_excecao (
  ponte_id       uuid not null references rh_ferias_ponte(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id)  on delete cascade,
  motivo         text,
  created_at     timestamptz not null default now(),
  primary key (ponte_id, colaborador_id)
);

-- ── Dias tirados no ano fora do recesso ─────────────────────────────────────
-- O "Dias compensados" e o "Férias no ano" da planilha. Debitam 1:1.
create table if not exists rh_ferias_lancamento (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  inicio         date not null,
  fim            date not null,
  dias           numeric(4,1) not null,
  tipo           text not null default 'avulso',   -- avulso | ferias
  motivo         text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint rh_fl_datas_ck check (fim >= inicio),
  constraint rh_fl_dias_ck  check (dias > 0 and dias <= 60),
  constraint rh_fl_tipo_ck  check (tipo in ('avulso','ferias'))
);
create index if not exists rh_fl_colab_idx on rh_ferias_lancamento (colaborador_id, inicio);

-- ── Recesso de fim de ano ───────────────────────────────────────────────────
create table if not exists rh_recesso (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  ano        int  not null,
  inicio     date not null,
  observacao text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists rh_recesso_uk on rh_recesso (org_id, ano);

-- Volta na mão, quando o calculado não serve ("e aí vai se ajustando").
create table if not exists rh_recesso_ajuste (
  recesso_id     uuid not null references rh_recesso(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  retorno        date not null,
  motivo         text,
  primary key (recesso_id, colaborador_id)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table rh_ferias_ponte        enable row level security;
alter table rh_ferias_ponte_excecao enable row level security;
alter table rh_ferias_lancamento   enable row level security;
alter table rh_recesso             enable row level security;
alter table rh_recesso_ajuste      enable row level security;

drop policy if exists rh_ferias_ponte_ler on rh_ferias_ponte;
drop policy if exists rh_ferias_ponte_rh  on rh_ferias_ponte;
-- Ponte e recesso são coletivos: qualquer membro da org enxerga (é a agenda de
-- quem está fora). Mexer é do RH.
create policy rh_ferias_ponte_ler on rh_ferias_ponte for select using (is_org_member(org_id));
create policy rh_ferias_ponte_rh  on rh_ferias_ponte for all
  using (rh_can(org_id)) with check (rh_can(org_id));

drop policy if exists rh_ponte_exc_ler on rh_ferias_ponte_excecao;
drop policy if exists rh_ponte_exc_rh  on rh_ferias_ponte_excecao;
create policy rh_ponte_exc_ler on rh_ferias_ponte_excecao for select
  using (exists (select 1 from rh_ferias_ponte p where p.id = ponte_id and is_org_member(p.org_id)));
create policy rh_ponte_exc_rh on rh_ferias_ponte_excecao for all
  using      (exists (select 1 from rh_ferias_ponte p where p.id = ponte_id and rh_can(p.org_id)))
  with check (exists (select 1 from rh_ferias_ponte p where p.id = ponte_id and rh_can(p.org_id)));

drop policy if exists rh_fl_ler on rh_ferias_lancamento;
drop policy if exists rh_fl_rh  on rh_ferias_lancamento;
-- Dia avulso é individual: mesma régua do ponto e das férias (201).
create policy rh_fl_ler on rh_ferias_lancamento for select
  using (rh_can(org_id) or rh_is_self(colaborador_id));
create policy rh_fl_rh on rh_ferias_lancamento for all
  using (rh_can(org_id)) with check (rh_can(org_id));

drop policy if exists rh_recesso_ler on rh_recesso;
drop policy if exists rh_recesso_rh  on rh_recesso;
create policy rh_recesso_ler on rh_recesso for select using (is_org_member(org_id));
create policy rh_recesso_rh  on rh_recesso for all
  using (rh_can(org_id)) with check (rh_can(org_id));

drop policy if exists rh_recesso_aj_ler on rh_recesso_ajuste;
drop policy if exists rh_recesso_aj_rh  on rh_recesso_ajuste;
create policy rh_recesso_aj_ler on rh_recesso_ajuste for select
  using (exists (select 1 from rh_recesso r where r.id = recesso_id and is_org_member(r.org_id)));
create policy rh_recesso_aj_rh on rh_recesso_ajuste for all
  using      (exists (select 1 from rh_recesso r where r.id = recesso_id and rh_can(r.org_id)))
  with check (exists (select 1 from rh_recesso r where r.id = recesso_id and rh_can(r.org_id)));

-- ── Meses do ano que geram direito ──────────────────────────────────────────
-- Conta os meses do ano p_ano, da admissão até p_ate, contando o mês da
-- admissão só se ele tiver 15+ dias de vínculo. Mesma régua dos avos do 13º.
create or replace function rh_ferias_meses_ano(p_admissao date, p_ano int, p_ate date)
returns int language sql immutable set search_path to 'public' as $$
  select coalesce(count(*), 0)::int
    from generate_series(
      greatest(date_trunc('month', p_admissao)::date, make_date(p_ano, 1, 1)),
      least(make_date(p_ano, 12, 1), date_trunc('month', p_ate)::date),
      interval '1 month') m
   where case
     when date_trunc('month', p_admissao)::date = m::date
       then ((m + interval '1 month' - interval '1 day')::date - p_admissao + 1) >= 15
     else true
   end;
$$;

-- ── Saldo do ano, por pessoa ────────────────────────────────────────────────
-- Uma linha por CLT ativo. Devolve o acumulado ATÉ HOJE e a PROJEÇÃO até
-- dezembro — a projeção é o que define a volta do recesso, o acumulado é o que
-- a pessoa realmente já tem hoje.
create or replace function rh_ferias_saldo_ano(p_org uuid, p_ano int default null)
returns table (
  colaborador_id uuid, pessoa text, data_admissao date,
  meses_ate_hoje int,  dias_ate_hoje numeric,
  meses_ano int,       dias_ano numeric,
  dias_pontes numeric, dias_lancamentos numeric,
  saldo_atual numeric, saldo_projetado numeric,
  recesso_inicio date, recesso_retorno date, retorno_ajustado boolean
) language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ano int;
  v_ate date;
  v_rec rh_recesso%rowtype;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_ano := coalesce(p_ano, extract(year from current_date)::int);
  -- Ano passado já fechou; ano futuro conta cheio; ano corrente para no mês de hoje.
  v_ate := case
             when v_ano <  extract(year from current_date)::int then make_date(v_ano, 12, 31)
             when v_ano >  extract(year from current_date)::int then make_date(v_ano, 12, 31)
             else current_date
           end;
  select * into v_rec from rh_recesso r where r.org_id = p_org and r.ano = v_ano;

  return query
  with pessoas as (
    select c.id, c.nome, c.data_admissao
      from rh_colaborador c
     where c.org_id = p_org and c.tipo_vinculo = 'clt'
       and c.status = 'ativo' and coalesce(c.arquivado, false) = false
       and c.data_admissao is not null
       and c.data_admissao <= make_date(v_ano, 12, 31)
  ),
  base as (
    select p.id, p.nome, p.data_admissao,
           rh_ferias_meses_ano(p.data_admissao, v_ano, v_ate)                as m_hoje,
           rh_ferias_meses_ano(p.data_admissao, v_ano, make_date(v_ano,12,31)) as m_ano,
           -- Ponte só conta para quem já estava na casa quando ela aconteceu.
           coalesce((select sum(pt.custo_dias) from rh_ferias_ponte pt
                      where pt.org_id = p_org
                        and extract(year from pt.inicio)::int = v_ano
                        and pt.inicio >= p.data_admissao
                        and not exists (select 1 from rh_ferias_ponte_excecao e
                                         where e.ponte_id = pt.id and e.colaborador_id = p.id)
                    ), 0) as d_pontes,
           coalesce((select sum(l.dias) from rh_ferias_lancamento l
                      where l.colaborador_id = p.id
                        and extract(year from l.inicio)::int = v_ano), 0) as d_lanc
      from pessoas p
  )
  select b.id, b.nome, b.data_admissao,
         b.m_hoje, round(b.m_hoje * 2.5, 1),
         b.m_ano,  round(b.m_ano  * 2.5, 1),
         b.d_pontes, b.d_lanc,
         round(b.m_hoje * 2.5 - b.d_pontes - b.d_lanc, 1),
         round(b.m_ano  * 2.5 - b.d_pontes - b.d_lanc, 1),
         v_rec.inicio,
         case
           when v_rec.id is null then null::date
           else coalesce(
             (select a.retorno from rh_recesso_ajuste a
               where a.recesso_id = v_rec.id and a.colaborador_id = b.id),
             -- Volta = 1º dia do recesso + saldo, em dias corridos. A fração
             -- de meio dia não vira meio dia de folga: arredonda para baixo.
             v_rec.inicio + greatest(0, floor(b.m_ano * 2.5 - b.d_pontes - b.d_lanc))::int)
         end,
         exists (select 1 from rh_recesso_ajuste a
                  where a.recesso_id = v_rec.id and a.colaborador_id = b.id)
    from base b
   order by b.nome collate "pt-BR-x-icu";
end $$;

-- ── Quem emendou cada ponte ─────────────────────────────────────────────────
-- Uma linha por (ponte × pessoa elegível), já com o aderiu resolvido — a tela
-- só liga/desliga o toggle.
create or replace function rh_ferias_pontes(p_org uuid, p_ano int default null)
returns table (
  ponte_id uuid, nome text, inicio date, fim date, custo_dias numeric,
  observacao text, colaborador_id uuid, pessoa text, aderiu boolean
) language plpgsql stable security definer set search_path to 'public' as $$
declare v_ano int;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_ano := coalesce(p_ano, extract(year from current_date)::int);

  return query
  select pt.id, pt.nome, pt.inicio, pt.fim, pt.custo_dias, pt.observacao,
         c.id, c.nome,
         not exists (select 1 from rh_ferias_ponte_excecao e
                      where e.ponte_id = pt.id and e.colaborador_id = c.id)
    from rh_ferias_ponte pt
    join rh_colaborador c
      on c.org_id = pt.org_id and c.tipo_vinculo = 'clt'
     and c.status = 'ativo' and coalesce(c.arquivado, false) = false
     and c.data_admissao is not null and c.data_admissao <= pt.inicio
   where pt.org_id = p_org and extract(year from pt.inicio)::int = v_ano
   order by pt.inicio, c.nome collate "pt-BR-x-icu";
end $$;

-- ── Escrita ─────────────────────────────────────────────────────────────────
create or replace function rh_ponte_salvar(p_dados jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_org uuid; v_ini date; v_fim date;
begin
  v_org := nullif(p_dados->>'org_id','')::uuid;
  v_id  := nullif(p_dados->>'id','')::uuid;
  v_ini := nullif(p_dados->>'inicio','')::date;
  v_fim := coalesce(nullif(p_dados->>'fim','')::date, v_ini);
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_ini is null then raise exception 'Informe a data da emenda'; end if;
  if v_fim < v_ini then raise exception 'O fim não pode ser antes do início'; end if;
  if btrim(coalesce(p_dados->>'nome','')) = '' then raise exception 'Informe o nome do feriado'; end if;

  if v_id is null then
    insert into rh_ferias_ponte (org_id, nome, inicio, fim, custo_dias, observacao, created_by)
    values (v_org, btrim(p_dados->>'nome'), v_ini, v_fim,
            coalesce(nullif(p_dados->>'custo_dias','')::numeric, 1),
            nullif(btrim(coalesce(p_dados->>'observacao','')), ''), auth.uid())
    returning id into v_id;
  else
    update rh_ferias_ponte
       set nome = btrim(p_dados->>'nome'), inicio = v_ini, fim = v_fim,
           custo_dias = coalesce(nullif(p_dados->>'custo_dias','')::numeric, 1),
           observacao = nullif(btrim(coalesce(p_dados->>'observacao','')), '')
     where id = v_id and org_id = v_org;
  end if;
  return v_id;
end $$;

create or replace function rh_ponte_excluir(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_ferias_ponte where id = p_id;
  if v_org is null then raise exception 'Emenda não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from rh_ferias_ponte where id = p_id;
end $$;

-- Liga/desliga a adesão de uma pessoa. Aderir = apagar a exceção.
create or replace function rh_ponte_adesao(p_ponte uuid, p_colaborador uuid, p_aderiu boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_ferias_ponte where id = p_ponte;
  if v_org is null then raise exception 'Emenda não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_aderiu then
    delete from rh_ferias_ponte_excecao where ponte_id = p_ponte and colaborador_id = p_colaborador;
  else
    insert into rh_ferias_ponte_excecao (ponte_id, colaborador_id)
    values (p_ponte, p_colaborador) on conflict do nothing;
  end if;
end $$;

create or replace function rh_ferias_lancar(p_dados jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_org uuid; v_colab uuid; v_ini date; v_fim date; v_dias numeric;
begin
  v_colab := nullif(p_dados->>'colaborador_id','')::uuid;
  v_id    := nullif(p_dados->>'id','')::uuid;
  v_ini   := nullif(p_dados->>'inicio','')::date;
  v_fim   := coalesce(nullif(p_dados->>'fim','')::date, v_ini);
  select org_id into v_org from rh_colaborador where id = v_colab;
  if v_org is null then raise exception 'Pessoa não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_ini is null then raise exception 'Informe a data'; end if;
  if v_fim < v_ini then raise exception 'O fim não pode ser antes do início'; end if;
  -- Dias podem divergir do intervalo: meio dia, ou uma ausência que pula o fim
  -- de semana. Quem manda é o número informado; o intervalo é só o default.
  v_dias := coalesce(nullif(p_dados->>'dias','')::numeric, (v_fim - v_ini) + 1);
  if v_dias <= 0 then raise exception 'Informe quantos dias descontar'; end if;

  if v_id is null then
    insert into rh_ferias_lancamento (org_id, colaborador_id, inicio, fim, dias, tipo, motivo, created_by)
    values (v_org, v_colab, v_ini, v_fim, v_dias,
            coalesce(nullif(p_dados->>'tipo',''), 'avulso'),
            nullif(btrim(coalesce(p_dados->>'motivo','')), ''), auth.uid())
    returning id into v_id;
  else
    update rh_ferias_lancamento
       set inicio = v_ini, fim = v_fim, dias = v_dias,
           tipo   = coalesce(nullif(p_dados->>'tipo',''), 'avulso'),
           motivo = nullif(btrim(coalesce(p_dados->>'motivo','')), '')
     where id = v_id and colaborador_id = v_colab;
  end if;
  return v_id;
end $$;

create or replace function rh_ferias_lancamento_excluir(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_ferias_lancamento where id = p_id;
  if v_org is null then raise exception 'Lançamento não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from rh_ferias_lancamento where id = p_id;
end $$;

create or replace function rh_recesso_salvar(p_org uuid, p_ano int, p_inicio date, p_observacao text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_inicio is null then raise exception 'Informe o primeiro dia do recesso'; end if;
  insert into rh_recesso (org_id, ano, inicio, observacao, created_by)
  values (p_org, p_ano, p_inicio, nullif(btrim(coalesce(p_observacao,'')), ''), auth.uid())
  on conflict (org_id, ano) do update
    set inicio = excluded.inicio, observacao = excluded.observacao
  returning id into v_id;
  return v_id;
end $$;

-- Volta na mão. p_retorno nulo devolve o cálculo automático.
create or replace function rh_recesso_ajustar(p_org uuid, p_ano int, p_colaborador uuid, p_retorno date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_rec uuid;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select id into v_rec from rh_recesso where org_id = p_org and ano = p_ano;
  if v_rec is null then raise exception 'Cadastre o recesso de % antes', p_ano; end if;
  if p_retorno is null then
    delete from rh_recesso_ajuste where recesso_id = v_rec and colaborador_id = p_colaborador;
  else
    insert into rh_recesso_ajuste (recesso_id, colaborador_id, retorno)
    values (v_rec, p_colaborador, p_retorno)
    on conflict (recesso_id, colaborador_id) do update set retorno = excluded.retorno;
  end if;
end $$;

revoke execute on function rh_ferias_meses_ano(date, int, date)          from public, anon;
revoke execute on function rh_ferias_saldo_ano(uuid, int)                from public, anon;
revoke execute on function rh_ferias_pontes(uuid, int)                   from public, anon;
revoke execute on function rh_ponte_salvar(jsonb)                        from public, anon;
revoke execute on function rh_ponte_excluir(uuid)                        from public, anon;
revoke execute on function rh_ponte_adesao(uuid, uuid, boolean)          from public, anon;
revoke execute on function rh_ferias_lancar(jsonb)                       from public, anon;
revoke execute on function rh_ferias_lancamento_excluir(uuid)            from public, anon;
revoke execute on function rh_recesso_salvar(uuid, int, date, text)      from public, anon;
revoke execute on function rh_recesso_ajustar(uuid, int, uuid, date)     from public, anon;
grant  execute on function rh_ferias_meses_ano(date, int, date)          to authenticated;
grant  execute on function rh_ferias_saldo_ano(uuid, int)                to authenticated;
grant  execute on function rh_ferias_pontes(uuid, int)                   to authenticated;
grant  execute on function rh_ponte_salvar(jsonb)                        to authenticated;
grant  execute on function rh_ponte_excluir(uuid)                        to authenticated;
grant  execute on function rh_ponte_adesao(uuid, uuid, boolean)          to authenticated;
grant  execute on function rh_ferias_lancar(jsonb)                       to authenticated;
grant  execute on function rh_ferias_lancamento_excluir(uuid)            to authenticated;
grant  execute on function rh_recesso_salvar(uuid, int, date, text)      to authenticated;
grant  execute on function rh_recesso_ajustar(uuid, int, uuid, date)     to authenticated;
grant  select on rh_ferias_ponte, rh_ferias_ponte_excecao, rh_ferias_lancamento,
                 rh_recesso, rh_recesso_ajuste                           to authenticated;

notify pgrst, 'reload schema';
