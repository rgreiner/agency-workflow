-- 138_categorias_arvore.sql
-- Reagrupa as categorias financeiras planas em macro-grupos (árvore de 2 níveis).
--
-- REGRA DE OURO: isto NÃO recria categoria. O NOME é a chave em `lancamentos.categoria`
-- (há ~R$ 600 mil lançados) — recriar quebraria o vínculo. Aqui cada categoria vira
-- FILHA de um macro-grupo preservando nome e cor; o nome continua idêntico e selecionável.
--
-- Idempotente: só age em orgs cujas categorias ainda estão TODAS planas (nenhum grupo
-- com filhos). Rodar de novo não faz nada.
--
-- Trava de segurança: se QUALQUER categoria original sumiria da árvore nova
-- (ex.: um nome digitado errado no mapa abaixo), a migration ABORTA — nada é perdido.
--
-- Também cadastra 3 categorias hoje ÓRFÃS (usadas em lançamento, fora do cadastro):
-- Transferência de Entrada/Saída e Rendimentos.

do $$
declare
  v_org   uuid;
  v_cats  jsonb;   -- categorias planas atuais da org
  v_new   jsonb;   -- árvore nova
  v_macro jsonb;   -- macro-grupo corrente
  v_filhos jsonb;  -- filhos montados do macro corrente
  v_child text;    -- nome de filho corrente
  v_cor   text;    -- cor resolvida
  v_name  text;    -- nome original (na verificação)

  -- Mapa dos macro-grupos. Ordem = ordem de exibição. `filhos` são os NOMES EXATOS
  -- das categorias (acentos/espaços contam). A tela filtra por `tipo` na aba certa.
  v_macros jsonb := $json$[
    { "nome": "Receita Operacional", "tipo": "entrada", "cor": "#16a34a",
      "filhos": ["Fee","Job","Produção","Comissão","Receitas de Serviços","Receitas de Vendas"] },
    { "nome": "Receita Não Operacional", "tipo": "entrada", "cor": "#22c55e",
      "filhos": ["Rendimentos de Aplicações","Rendimentos","Venda de Imobilizado","Outras Receitas",
                 "Estorno","Devolução de Adiantamento","Empréstimos de Bancos","Perdas/Inadimplência"] },

    { "nome": "Pessoas", "tipo": "saida", "cor": "#ea580c",
      "filhos": ["Remuneração Funcionários","Remuneração de Autônomos","Remuneração de Estagiários",
                 "13º Salário - 1ª Parcela","13º Salário - 2ª Parcela","Férias","FGTS","Multa FGTS",
                 "Rescisões","Gratificações","Exames Demissionais e Admissionais","Vale Refeição",
                 "Vale-Transporte","Cursos e Treinamentos","Confraternizações"] },
    { "nome": "Impostos e Taxas", "tipo": "saida", "cor": "#dc2626",
      "filhos": ["Darf - INSS e IRRF","Simples Nacional - DAS","Imposto - IOF",
                 "Retenção - ISS Serviços Tomados","IPTU","Alvará de Funcionamento",
                 "Taxa de Lixo","Taxa de Desastres"] },
    { "nome": "Administrativo", "tipo": "saida", "cor": "#d97706",
      "filhos": ["Aluguel","Aluguel - Máquina Café","Condomínio","Energia Elétrica","Limpeza",
                 "Materiais de Limpeza e de Higiene","Material de Escritório","Materiais de Escritório",
                 "Manutenção Salas","Manutenção de Equipamentos","Telefonia Móvel","Telefonia e Internet",
                 "Software / Licença de Uso","Honorários Contábeis","Honorários Advocatícios",
                 "Assessorias e Associações","Supermercado","Motoboy","Combustíveis",
                 "Combustível e Translados","Transporte Urbano (táxi, Uber)","Imobilizado"] },
    { "nome": "Produção", "tipo": "saida", "cor": "#ca8a04",
      "filhos": ["Fornecedor","Free Lancer"] },
    { "nome": "Financeiro", "tipo": "saida", "cor": "#0891b2",
      "filhos": ["Tarifas Bancárias","Tarifas DOC / TED"] },
    { "nome": "Passivos", "tipo": "saida", "cor": "#b91c1c",
      "filhos": ["Quitação de Passivos","Distribuição de Lucros"] },
    { "nome": "Outros", "tipo": "saida", "cor": "#64748b",
      "filhos": ["Marketing e Publicidade","Brindes para Clientes","Despesas com Clientes",
                 "Compras Diretoria","Despesas Extras"] },

    { "nome": "Empréstimos e Numerários", "tipo": "ambos", "cor": "#0d9488",
      "filhos": ["Empréstimos","Empréstimos de Sócios","Numerários em Trânsito"] },
    { "nome": "Transferências", "tipo": "ambos", "cor": "#475569",
      "filhos": ["Transferência de Entrada","Transferência de Saída"] }
  ]$json$::jsonb;
begin
  for v_org, v_cats in
    select org_id, finance_categorias
    from org_settings
    where jsonb_typeof(finance_categorias) = 'array'
      and jsonb_array_length(finance_categorias) > 0
      -- só age se TODAS estiverem planas (nenhum grupo com filhos)
      and not exists (
        select 1 from jsonb_array_elements(finance_categorias) g
        where jsonb_array_length(coalesce(g->'filhos','[]'::jsonb)) > 0
      )
  loop
    v_new := '[]'::jsonb;

    -- monta cada macro-grupo, puxando a cor original de cada filho (fallback = cor do macro)
    for v_macro in select * from jsonb_array_elements(v_macros)
    loop
      v_filhos := '[]'::jsonb;
      for v_child in select jsonb_array_elements_text(v_macro->'filhos')
      loop
        v_cor := coalesce(
          (select g->>'cor' from jsonb_array_elements(v_cats) g
             where g->>'nome' = v_child limit 1),
          v_macro->>'cor');
        v_filhos := v_filhos || jsonb_build_array(jsonb_build_object('nome', v_child, 'cor', v_cor));
      end loop;
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'nome', v_macro->>'nome', 'tipo', v_macro->>'tipo',
        'cor',  v_macro->>'cor',  'filhos', v_filhos));
    end loop;

    -- SEGURANÇA: qualquer categoria original que não caiu em nenhum macro vira folha
    -- avulsa (preserva nome/tipo/cor). Assim um erro de digitação no mapa nunca perde dado.
    for v_name in select g->>'nome' from jsonb_array_elements(v_cats) g
    loop
      if not exists (
        select 1 from jsonb_array_elements(v_new) g,
                     jsonb_array_elements(coalesce(g->'filhos','[]'::jsonb)) f
        where f->>'nome' = v_name
      ) then
        raise warning '[138] Categoria "%" não estava no mapa — mantida como folha avulsa.', v_name;
        v_new := v_new || (
          select jsonb_build_array(jsonb_build_object(
            'nome', g->>'nome', 'tipo', g->>'tipo', 'cor', g->>'cor', 'filhos', '[]'::jsonb))
          from jsonb_array_elements(v_cats) g where g->>'nome' = v_name limit 1);
      end if;
    end loop;

    -- TRAVA DURA: toda categoria original TEM que reaparecer na árvore (como filho OU folha).
    for v_name in select g->>'nome' from jsonb_array_elements(v_cats) g
    loop
      if not exists (
        select 1 from jsonb_array_elements(v_new) g
        where g->>'nome' = v_name
           or exists (select 1 from jsonb_array_elements(coalesce(g->'filhos','[]'::jsonb)) f
                      where f->>'nome' = v_name)
      ) then
        raise exception '[138] ABORT: categoria "%" sumiria da árvore.', v_name;
      end if;
    end loop;

    update org_settings set finance_categorias = v_new where org_id = v_org;
    raise notice '[138] org %: % categorias planas -> % macro-grupos.',
      v_org, jsonb_array_length(v_cats), jsonb_array_length(v_new);
  end loop;
end $$;

notify pgrst, 'reload schema';
