-- 250_fin_cubo_nome_canonico.sql
-- O mesmo fornecedor aparecia em DUAS linhas da Análise por causa da grafia:
-- "É o Amor" e "É O Amor", "KSBIG HORTIFRUTIGRANJEIROS LTDA" e "Ksbig
-- Hortifrutigranjeiros Ltda", "Erika Salateski Simão" e "Simao". Doze pares no
-- contato e um no centro de custo — R$ 245 mil do maior cliente lidos como dois
-- clientes diferentes.
--
-- A origem é legítima: caixa alta vem do arquivo da Conta Azul, Title Case vem do
-- cadastro do Flow, acento se perde no meio. Por isso a correção é de LEITURA e
-- não de dado: o lançamento continua guardando o que a fonte escreveu (é o que
-- confere com o extrato), e o cubo agrupa por um nome normalizado, exibindo uma
-- grafia canônica.
--
-- Escolha da grafia vencedora, nesta ordem:
--   1. fora de CAIXA ALTA  — "Ksbig Hortifrutigranjeiros Ltda" e não o gritado;
--   2. com acento          — "Simão" e não "Simao";
--   3. a mais usada;
--   4. alfabética (desempate estável — o resultado não pode variar entre cargas).
--
-- Idempotente.

create or replace function fin_sem_acento(t text)
returns text language sql immutable strict as $$
  select translate(t,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC');
$$;

/* Chave de agrupamento de nome. Espelhada em `chaveNome` (src/lib/fin-cubo.ts):
   o drilldown filtra em JS e as duas réguas TÊM que casar, senão clicar na célula
   traria só metade dos lançamentos. */
create or replace function fin_chave_nome(t text)
returns text language sql immutable strict as $$
  select lower(btrim(fin_sem_acento(t)));
$$;

create or replace function fin_cubo(p_org uuid)
returns table (
  mes date, mes_comp date, tipo text, situacao text,
  categoria text, centro_custo text, contato text, conta text,
  valor numeric, qtd integer
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (fin_can(p_org) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query
  with mov as (
    select date_trunc('month', coalesce(m.data_mov, m.data_prevista))::date as mes,
           date_trunc('month', m.competencia)::date                         as mes_comp,
           m.tipo, m.situacao,
           coalesce(nullif(btrim(m.categoria),    ''), '(sem categoria)')       as categoria,
           coalesce(nullif(btrim(m.centro_custo), ''), '(sem centro de custo)') as centro_custo,
           coalesce(nullif(btrim(m.contato),      ''), '(não informado)')       as contato,
           coalesce(nullif(btrim(m.conta),        ''), '(sem conta)')           as conta,
           abs(coalesce(m.valor, 0))                                            as valor
      from fin_movimentos m
     where m.org_id = p_org
       -- Transferência entre contas é dinheiro mudando de bolso: não é receita
       -- nem despesa, e entrar aqui inflaria os dois lados com o mesmo valor.
       and coalesce(m.transferencia, false) = false
       and coalesce(m.data_mov, m.data_prevista) is not null
  ),
  -- `mov.` obrigatório: `categoria`, `contato`, `conta` e `centro_custo` também
  -- são os nomes das colunas de SAÍDA da função, e sem qualificar o PL/pgSQL não
  -- sabe se a referência é a variável ou a coluna ("column reference is ambiguous").
  nomes as (
    select 'categoria' as dim, mov.categoria    as nome, count(*) as n from mov group by 1, 2
    union all select 'centro',  mov.centro_custo, count(*) from mov group by 1, 2
    union all select 'contato', mov.contato,      count(*) from mov group by 1, 2
    union all select 'conta',   mov.conta,        count(*) from mov group by 1, 2
  ),
  canon as (
    select dim, nome,
           first_value(nome) over (
             partition by dim, fin_chave_nome(nome)
             order by (nome = upper(nome))::int,          -- 1. fora de CAIXA ALTA
                      (nome = fin_sem_acento(nome))::int, -- 2. com acento
                      n desc,                             -- 3. a mais usada
                      nome                                -- 4. desempate estável
           ) as canonico
      from nomes
  )
  select mov.mes, mov.mes_comp, mov.tipo, mov.situacao,
         cat.canonico, cen.canonico, con.canonico, cta.canonico,
         round(sum(mov.valor), 2), count(*)::int
    from mov
    join canon cat on cat.dim = 'categoria' and cat.nome = mov.categoria
    join canon cen on cen.dim = 'centro'    and cen.nome = mov.centro_custo
    join canon con on con.dim = 'contato'   and con.nome = mov.contato
    join canon cta on cta.dim = 'conta'     and cta.nome = mov.conta
   group by 1, 2, 3, 4, 5, 6, 7, 8;
end $$;

revoke execute on function fin_cubo(uuid) from public, anon;
grant  execute on function fin_cubo(uuid) to authenticated;

notify pgrst, 'reload schema';
