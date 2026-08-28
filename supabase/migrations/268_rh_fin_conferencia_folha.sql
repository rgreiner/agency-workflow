-- 268_rh_fin_conferencia_folha.sql
-- DP × FINANCEIRO CONVERSANDO (pedido do Rafael, 28/08): hoje são dois mundos.
-- Medido em prod: ZERO lançamentos com origem no RH (`origem_tipo='folha'`) —
-- a previsão de folha do fluxo é digitada à mão, e ninguém avisa o caixa
-- quando alguém sai. No dia em que Sthefany e Heloísa saem, a Heloísa tem
-- **R$ 10.343,40** de remuneração prevista até fev/2027 (6 × 1.723,90); a
-- Sthefany já havia sido tratada. O erro é do processo, não de quem digita.
--
-- Decisão do Rafael: o Flow CONFERE e AVISA; ele decide o que apagar. Nada de
-- gerar ou cancelar lançamento sozinho — o fluxo manual continua sendo dele.
--
-- Duas leituras, nenhuma escrita:
--   1. rh_fin_conferencia_folha — mês a mês, previsto no financeiro × time
--      real do RH, por pessoa.
--   2. rh_lanc_futuros_pessoa — o que está previsto para UMA pessoa daqui
--      para frente (alimenta o aviso na ficha ao desligar).
--
-- Três decisões que a primeira versão desta migration errou, corrigidas depois
-- de ver o resultado real:
--   · O lançamento traz o LÍQUIDO e a ficha o BRUTO — comparar os dois marcava
--     o time inteiro como "divergente". Agora só acusa diferença acima de 40%,
--     que é reajuste ou valor errado, não desconto de folha.
--   · Nome que não casa com NINGUÉM do RH é fornecedor coletivo (Caju, CIEE),
--     não sobra de gente: sai como 'fora_do_time', informativo.
--   · Grafia diferente escondia gente: "Isadora Vieira Amorim" (financeiro) vs
--     "AMORIN" (ficha) aparecia como uma sobra e uma falta ao mesmo tempo.
--     pg_trgm casa por similaridade e devolve 'nome_divergente' — o erro de
--     cadastro vira achado em vez de ruído.
-- Idempotente.

create extension if not exists pg_trgm;

create or replace function rh_fin_conferencia_folha(p_org uuid, p_meses int default 6)
returns table (
  mes date, colaborador_id uuid, nome text, nome_financeiro text,
  previsto numeric, esperado numeric, situacao text,
  data_admissao date, data_demissao date, lancamentos int
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  -- Cruza salário individual com o fluxo: exige os dois crachás.
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not fin_can(p_org) then
    raise exception 'Esta conferência mostra o fluxo previsto — precisa de acesso ao Financeiro' using errcode = '42501';
  end if;
  if coalesce(p_meses, 6) not between 1 and 24 then raise exception 'Informe de 1 a 24 meses'; end if;

  return query
  with meses as (
    select generate_series(
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date) + make_interval(months => p_meses - 1))::date,
      interval '1 month')::date as m
  ),
  cats as (
    -- Só remuneração recorrente por pessoa. Guias e benefícios coletivos
    -- (FGTS, DARF, VR, 13º, rescisão) não são por pessoa.
    select f->>'nome' as categoria
      from org_settings s,
           jsonb_array_elements(coalesce(s.finance_categorias, '[]'::jsonb)) mm,
           jsonb_array_elements(coalesce(mm->'filhos', '[]'::jsonb)) f
     where s.org_id = p_org and mm->>'nome' = 'Pessoas'
       and f->>'nome' in ('Remuneração Funcionários', 'Remuneração de Autônomos', 'Remuneração de Estagiários')
  ),
  pessoas as (
    select c.id, c.nome, c.salario_atual, c.data_admissao, c.data_demissao,
           fin_chave_nome(c.nome) as chave
      from rh_colaborador c
     where c.org_id = p_org and not c.arquivado
  ),
  prev_bruto as (
    select date_trunc('month', l.vencimento)::date as m,
           fin_chave_nome(coalesce(l.contato_nome, '')) as chave,
           min(btrim(l.contato_nome)) as nome_fin,
           sum(coalesce(l.valor_realizado, l.valor)) as valor,
           count(*)::int as n
      from lancamentos l
     where l.org_id = p_org and l.tipo = 'saida'
       and l.situacao = 'em_aberto'
       and l.categoria in (select categoria from cats)
       and l.vencimento >= date_trunc('month', current_date)::date
       and l.vencimento <  (date_trunc('month', current_date) + make_interval(months => p_meses))::date
       and nullif(btrim(coalesce(l.contato_nome, '')), '') is not null
     group by 1, 2
  ),
  -- Resolve o lançamento para uma pessoa do RH: grafia exata primeiro,
  -- depois aproximada (pg_trgm) — 0,80 casa "amorim"/"amorin" e não junta
  -- nomes de pessoas diferentes.
  prev as (
    select pb.*, pm.id as colab_id, pm.chave as colab_chave,
           (pm.id is not null and pm.chave is distinct from pb.chave) as grafia_difere
      from prev_bruto pb
      left join lateral (
        select p.id, p.chave from pessoas p
         where p.chave = pb.chave or similarity(p.chave, pb.chave) >= 0.80
         order by (p.chave = pb.chave) desc, similarity(p.chave, pb.chave) desc
         limit 1
      ) pm on true
  ),
  esperado_grade as (
    select mm.m, p.id, p.nome, p.data_admissao, p.data_demissao,
           case when coalesce(p.salario_atual, 0) > 0
                     -- Tem vínculo em ALGUM dia do mês? Então há pagamento.
                     and (p.data_admissao is null or p.data_admissao <= (mm.m + interval '1 month - 1 day')::date)
                     and (p.data_demissao is null or p.data_demissao >= mm.m)
                then p.salario_atual else 0 end as esperado
      from meses mm cross join pessoas p
  ),
  juntos as (
    select coalesce(e.m, pr.m) as m,
           coalesce(e.id, pr.colab_id) as id,
           coalesce(e.nome, pr.nome_fin) as nome,
           pr.nome_fin,
           e.data_admissao, e.data_demissao,
           coalesce(pr.valor, 0) as previsto,
           coalesce(e.esperado, 0) as esperado,
           coalesce(pr.n, 0) as n,
           coalesce(pr.grafia_difere, false) as grafia_difere,
           (pr.chave is not null and pr.colab_id is null) as fora_do_time
      from esperado_grade e
      full join prev pr on pr.colab_id = e.id and pr.m = e.m
  )
  select j.m, j.id, j.nome, j.nome_fin,
         round(j.previsto, 2), round(j.esperado, 2),
         case
           when j.fora_do_time then 'fora_do_time'
           when j.previsto > 0 and j.esperado = 0 then 'sobra'
           when j.previsto = 0 and j.esperado > 0 then 'falta'
           when j.grafia_difere then 'nome_divergente'
           -- Lançamento é líquido, ficha é bruto: só acusa diferença grande.
           when j.esperado > 0 and abs(j.previsto - j.esperado) > j.esperado * 0.4 then 'divergente'
           else 'ok'
         end,
         j.data_admissao, j.data_demissao, j.n
    from juntos j
   where j.previsto > 0 or j.esperado > 0
   order by j.m, j.nome;
end $$;
revoke execute on function rh_fin_conferencia_folha(uuid, int) from public, anon;
grant  execute on function rh_fin_conferencia_folha(uuid, int) to authenticated;

-- ── O que está previsto para UMA pessoa daqui para frente ───────────────────
-- Alimenta o aviso da ficha no desligamento. Aqui entram TODAS as categorias
-- da macro Pessoas com o nome dela: sai da casa e o VR dela também para.
create or replace function rh_lanc_futuros_pessoa(p_colaborador uuid)
returns table (
  id uuid, vencimento date, valor numeric, categoria text, descricao text, situacao text
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid; v_chave text;
begin
  select c.org_id, fin_chave_nome(c.nome) into v_org, v_chave
    from rh_colaborador c where c.id = p_colaborador;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_can(v_org) and fin_can(v_org)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  return query
  select l.id, l.vencimento, coalesce(l.valor_realizado, l.valor), l.categoria,
         coalesce(l.descricao, ''), l.situacao
    from lancamentos l
   where l.org_id = v_org and l.tipo = 'saida' and l.situacao = 'em_aberto'
     and l.vencimento > current_date
     -- Mesma régua de nome da conferência: grafia diferente não pode esconder
     -- o lançamento justo na hora de encerrar a pessoa.
     and (fin_chave_nome(coalesce(l.contato_nome, '')) = v_chave
          or similarity(fin_chave_nome(coalesce(l.contato_nome, '')), v_chave) >= 0.80)
   order by l.vencimento;
end $$;
revoke execute on function rh_lanc_futuros_pessoa(uuid) from public, anon;
grant  execute on function rh_lanc_futuros_pessoa(uuid) to authenticated;

notify pgrst, 'reload schema';
