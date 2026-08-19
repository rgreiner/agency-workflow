-- 248_fin_cubo.sql
-- O cubo da tela de Análise: UMA agregação que a tela pivota inteira no cliente.
--
-- Medido em produção antes de escolher o grão: no grão mais fino que a tela
-- oferece — mês de caixa × mês de competência × tipo × situação × categoria ×
-- centro de custo × contato × conta — o histórico INTEIRO (2023→2032, previsto
-- recorrente incluso) cabe em 4.446 linhas, contra 6.831 movimentos. Por isso a
-- tela não pede query nova a cada cruzamento: troca de período, de dimensão e
-- de filtro acontecem em memória.
--
-- Duas datas de propósito:
--  * `mes`      = mês de CAIXA — `data_mov` no realizado, `data_prevista` no
--                 previsto (a empresa opera em regime de caixa; é o padrão).
--  * `mes_comp` = mês de competência, para o toggle. Carregar as duas custa 412
--                 linhas a mais — mais barato que uma segunda RPC.
--
-- `qtd` não é enfeite: separa "categoria cara" de "categoria com muito
-- lançamento", e é o que sustenta o alerta de duplicidade.
--
-- SECURITY DEFINER passando por cima de `fin_movimentos`: a view é
-- security_invoker, mas dentro de uma função definer o "invoker" é o dono, então
-- a RLS das tabelas de baixo NÃO é avaliada — o guard aqui é a única barreira, e
-- ele LEVANTA em vez de devolver vazio (gráfico em branco num painel financeiro
-- lê-se como "não teve custo", que é uma decisão errada).
-- Idempotente.

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
    select date_trunc('month', coalesce(m.data_mov, m.data_prevista))::date,
           date_trunc('month', m.competencia)::date,
           m.tipo, m.situacao,
           coalesce(nullif(btrim(m.categoria),    ''), '(sem categoria)'),
           coalesce(nullif(btrim(m.centro_custo), ''), '(sem centro de custo)'),
           coalesce(nullif(btrim(m.contato),      ''), '(não informado)'),
           coalesce(nullif(btrim(m.conta),        ''), '(sem conta)'),
           round(sum(abs(coalesce(m.valor, 0))), 2),
           count(*)::int
      from fin_movimentos m
     where m.org_id = p_org
       -- Transferência entre contas é dinheiro mudando de bolso: não é receita
       -- nem despesa, e entrar aqui inflaria os dois lados com o mesmo valor.
       and coalesce(m.transferencia, false) = false
       and coalesce(m.data_mov, m.data_prevista) is not null
     group by 1, 2, 3, 4, 5, 6, 7, 8;
end $$;

revoke execute on function fin_cubo(uuid) from public, anon;
grant  execute on function fin_cubo(uuid) to authenticated;

notify pgrst, 'reload schema';
