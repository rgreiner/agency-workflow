-- 169_ordenacao_alfabetica.sql
-- Ordenar A–Z de verdade nas colunas de nome.
--
-- Sintoma: "É O Amor" aparecia DEPOIS de "Times Digitais" na lista de clientes.
-- Causa: o Postgres roda em imagem Alpine (musl libc). No musl as locales não são
-- implementadas de fato — `en_US.utf8` se comporta como C, ou seja, `order by name`
-- é ordem de BYTES: "É" (0xC3 0x89) cai depois de qualquer letra ASCII.
--
-- Correção na raiz: dar às colunas de nome a collation ICU `pt-BR-x-icu` (a imagem
-- traz 871 collations ICU). Assim TODO `order by name` que já existe no app passa a
-- ordenar certo, sem depender de cada query lembrar de pedir. É determinística —
-- igualdade e índices únicos continuam se comportando igual.
--
-- Não cobre ordenação feita em JS sobre dados já carregados: lá vale o helper
-- `porNome` (lib/utils), que usa localeCompare pt-BR.

do $$
declare
  v_alvo constant text[][] := array[
    ['workspaces','name'],          -- clientes
    ['campaigns','name'],           -- campanhas
    ['profiles','full_name'],       -- pessoas
    ['rh_colaborador','nome'],
    ['fornecedores','name'],
    ['veiculos','name'],
    ['org_positions','name'],
    ['organizations','name'],
    ['portal_users','nome'],
    ['documents','title'],
    ['activities','title'],
    ['visual_boards','title']
  ];
  v_tab text; v_col text; i int;
begin
  for i in 1 .. array_length(v_alvo, 1) loop
    v_tab := v_alvo[i][1]; v_col := v_alvo[i][2];
    -- Idempotente: só mexe se a coluna ainda não estiver na collation certa.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_tab and column_name = v_col
        and coalesce(collation_name, '') <> 'pt-BR-x-icu'
    ) then
      execute format('alter table public.%I alter column %I type text collate "pt-BR-x-icu"', v_tab, v_col);
      raise notice 'collation aplicada: %.%', v_tab, v_col;
    end if;
  end loop;
end $$;

-- `contas_financeiras.nome` tem a view `contas_saldo` em cima, e o Postgres recusa
-- alterar coluna usada por view — recria a view do jeito que ela está hoje
-- (pg_get_viewdef, não reescrita à mão).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contas_financeiras' and column_name = 'nome'
      and coalesce(collation_name, '') <> 'pt-BR-x-icu'
  ) then
    drop view if exists contas_saldo;
    alter table public.contas_financeiras alter column nome type text collate "pt-BR-x-icu";

    create view contas_saldo as
    SELECT id, org_id, nome, tipo, cor, ativo, ordem, saldo_inicial, saldo_banco, saldo_banco_data,
      round(saldo_inicial + COALESCE(( SELECT sum(e.valor) AS sum
             FROM extrato_importado e
            WHERE e.org_id = c.org_id AND e.conta = c.nome AND (e.situacao = ANY (ARRAY['Conciliado'::text, 'Quitado'::text, 'Transferido'::text]))), 0::numeric)
        + COALESCE(( SELECT sum(
                  CASE WHEN l.tipo = 'saida'::text THEN - COALESCE(l.valor_realizado, l.valor)
                       ELSE COALESCE(l.valor_realizado, l.valor) END) AS sum
             FROM lancamentos l
            WHERE l.org_id = c.org_id AND l.conta_id = c.id AND (l.situacao = ANY (ARRAY['pago'::text, 'recebido'::text]))
              AND (l.origem_ref IS NULL OR NOT (EXISTS ( SELECT 1
                     FROM extrato_importado e
                    WHERE e.org_id = l.org_id AND e.import_ref = l.origem_ref
                      AND (e.situacao = ANY (ARRAY['Conciliado'::text, 'Quitado'::text, 'Transferido'::text])))))), 0::numeric), 2) AS saldo_atual,
      favorita
     FROM contas_financeiras c;

    grant select on contas_saldo to anon, authenticated;
    raise notice 'collation aplicada: contas_financeiras.nome (view contas_saldo recriada)';
  end if;
end $$;

notify pgrst, 'reload schema';
