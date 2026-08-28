-- 266_fin_margem_cliente.sql
-- MARGEM REALIZADA POR CLIENTE (pedido do Rafael, 28/08): "já operei a 35%,
-- hoje estamos no vermelho nesse quesito" — a tela que transforma essa
-- sensação em número por cliente.
--
-- A conta, por cliente e no período (regime de CAIXA, o padrão da casa):
--   receita        = entradas recebidas (data_liquidacao no período)
--   − imposto      = receita × alíquota efetiva (a MESMA do preço da hora)
--   − custo_horas  = horas medidas em tarefas do cliente × custo/hora cheio
--                    (já embute estrutura e provisão de lucro rateadas — mig. 257)
--   − custo_direto = saídas pagas vinculadas ao cliente (produção, mídia)
--   = margem       → margem_pct sobre a receita, para comparar com a alvo
--
-- Vínculo receita↔cliente: `workspace_id` quando existe e, quando não,
-- `fin_resolve_workspace` (alias + nome canônico da 189) sobre o centro de
-- custo e depois o contato — é a régua que a cobrança já usa. Nada de casar
-- nome na mão: réguas duplicadas foram a origem das divergências das 259/260.
--
-- Idempotente.

-- ── Alíquota efetiva: manual (config) ou DAS ÷ recebido em 12m (caixa) ──────
-- Extraída de horas_preco_venda para existir UMA definição — a tela de margem
-- e o preço da hora TÊM que usar o mesmo número.
create or replace function fin_imposto_efetivo_pct(p_org uuid)
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare v_manual numeric; v_das numeric; v_receb numeric; v_auto numeric;
begin
  select custo_imposto_pct into v_manual from org_settings where org_id = p_org;
  if v_manual is not null then return v_manual; end if;

  select coalesce(sum(coalesce(valor_realizado, valor)), 0) into v_das
    from lancamentos
   where org_id = p_org and tipo = 'saida' and situacao = 'pago'
     and categoria ilike '%simples%'
     and data_liquidacao > current_date - interval '12 months';
  select coalesce(sum(coalesce(valor_realizado, valor)), 0) into v_receb
    from lancamentos
   where org_id = p_org and tipo = 'entrada' and situacao = 'recebido'
     and data_liquidacao > current_date - interval '12 months';

  v_auto := case when v_receb > 0 then round(v_das / v_receb * 100, 2) end;
  return coalesce(v_auto, 12.5);
end $$;
revoke execute on function fin_imposto_efetivo_pct(uuid) from public, anon;
grant  execute on function fin_imposto_efetivo_pct(uuid) to authenticated;

-- ── A margem, por cliente ───────────────────────────────────────────────────
create or replace function fin_margem_cliente(p_org uuid, p_ini date, p_fim date)
returns table (
  workspace_id uuid, cliente text, agencia boolean,
  receita numeric, imposto numeric,
  horas numeric, custo_horas numeric, custo_direto numeric,
  margem numeric, margem_pct numeric
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_imp numeric;
begin
  -- Expõe receita E custo de horas: precisa dos dois crachás.
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not horas_can(p_org) then
    raise exception 'Esta leitura cruza custo de horas — precisa de acesso a Horas' using errcode = '42501';
  end if;
  if p_fim < p_ini then raise exception 'Período inválido'; end if;

  v_imp := fin_imposto_efetivo_pct(p_org);

  return query
  with excluidas as (
    -- Categorias que NÃO podem entrar como custo direto do cliente porque já
    -- estão contadas em outro lugar: Administrativo/Financeiro compõem o
    -- overhead do custo/hora (170), Pessoas é a camada direta da folha, e
    -- Impostos entram como % sobre a receita, aqui em cima. Sobra o que é
    -- custo de cliente de verdade (Produção, mídia).
    select f->>'nome' as categoria
      from org_settings s,
           jsonb_array_elements(coalesce(s.finance_categorias, '[]'::jsonb)) m,
           jsonb_array_elements(coalesce(m->'filhos', '[]'::jsonb)) f
     where s.org_id = p_org
       and m->>'nome' in ('Administrativo', 'Financeiro', 'Pessoas', 'Impostos e Taxas')
  ),
  lanc as (
    -- Um passo só para receita e custo direto: o vínculo com o cliente é o
    -- mesmo dos dois lados.
    select coalesce(
             l.workspace_id,
             fin_resolve_workspace(p_org, l.origem_tipo, l.origem_id, l.centro_custo),
             fin_resolve_workspace(p_org, l.origem_tipo, l.origem_id, l.contato_nome)
           ) as ws,
           coalesce(nullif(btrim(l.centro_custo), ''), nullif(btrim(l.contato_nome), ''), '(sem cliente)') as nome_bruto,
           l.tipo, coalesce(l.valor_realizado, l.valor) as valor
      from lancamentos l
     where l.org_id = p_org
       and l.data_liquidacao between p_ini and p_fim
       -- Transferência entre contas é dinheiro mudando de bolso: mesma
       -- expressão da view fin_movimentos (232), não é receita nem despesa.
       and l.transferencia_id is null
       and lower(coalesce(l.categoria, '')) not like 'transfer%'
       and ((l.tipo = 'entrada' and l.situacao = 'recebido')
         or (l.tipo = 'saida'   and l.situacao = 'pago'
             and l.categoria not in (select categoria from excluidas)))
  ),
  fin as (
    select ws,
           -- Sem workspace, agrupa pelo nome canônico da fonte (mig. 250).
           case when ws is null then fin_chave_nome(nome_bruto) end as chave,
           min(nome_bruto) as nome,
           sum(valor) filter (where tipo = 'entrada') as receita,
           sum(valor) filter (where tipo = 'saida')   as saida
      from lanc
     group by 1, 2
  ),
  hrs as (
    -- Horas do cliente no período, ao custo cheio (estrutura + provisão já
    -- rateadas). Vem de horas_por_atividade: a régua de horas mora lá.
    select h.workspace_id as ws,
           round(sum(h.minutos) / 60.0, 1) as horas,
           round(sum(coalesce(h.custo, 0)), 2) as custo
      from horas_por_atividade(p_org, p_ini, p_fim) h
     where h.workspace_id is not null
     group by 1
  ),
  juntos as (
    select coalesce(f.ws, hr.ws) as ws,
           coalesce(f.nome, w2.name, '(sem cliente)') as nome,
           coalesce(f.receita, 0) as receita,
           coalesce(f.saida, 0) as saida,
           coalesce(hr.horas, 0) as horas,
           coalesce(hr.custo, 0) as custo_h
      from fin f
      full join hrs hr on hr.ws = f.ws and f.ws is not null
      left join workspaces w2 on w2.id = coalesce(f.ws, hr.ws)
  ),
  -- Cliente pode ter vindo em duas linhas (uma com ws, outra pelo nome):
  -- fecha por workspace quando existe, senão pelo nome canônico.
  final as (
    select j.ws,
           coalesce(w.name, j.nome) as cliente,
           sum(j.receita) as receita, sum(j.saida) as saida,
           sum(j.horas) as horas, sum(j.custo_h) as custo_h
      from juntos j
      left join workspaces w on w.id = j.ws
     group by 1, 2
  )
  select f.ws,
         f.cliente,
         -- A própria agência não é cliente: receita/custo dela é da casa.
         coalesce(f.ws = (select w.id from workspaces w
                           where w.org_id = p_org and fin_chave_nome(w.name) = fin_chave_nome(o.name) limit 1), false)
           or fin_chave_nome(f.cliente) = fin_chave_nome(o.name) as agencia,
         round(f.receita, 2),
         round(f.receita * v_imp / 100, 2) as imposto,
         round(f.horas, 1),
         round(f.custo_h, 2),
         round(f.saida, 2),
         round(f.receita - (f.receita * v_imp / 100) - f.custo_h - f.saida, 2) as margem,
         case when f.receita > 0
              then round((f.receita - (f.receita * v_imp / 100) - f.custo_h - f.saida) / f.receita * 100, 1) end
    from final f
    cross join (select name from organizations where id = p_org) o
   where f.receita <> 0 or f.custo_h <> 0 or f.saida <> 0
   order by f.receita desc, f.custo_h desc;
end $$;
revoke execute on function fin_margem_cliente(uuid, date, date) from public, anon;
grant  execute on function fin_margem_cliente(uuid, date, date) to authenticated;

-- horas_preco_venda passa a usar o helper — uma régua só para o imposto.
create or replace function horas_preco_venda(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_custo_medio numeric; v_horas numeric; v_imposto numeric; v_imposto_auto numeric;
  v_das numeric; v_recebido numeric; v_margem numeric; v_manual numeric;
  v_over record; v_comp date; v_pool_pessoas numeric;
begin
  if not horas_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select max(competencia) into v_comp from rh_folha where org_id = p_org;

  select sum(c.custo_hora * c.horas_base) filter (where not c.overhead),
         sum(c.horas_base) filter (where not c.overhead),
         coalesce(sum(c.custo_mes) filter (where c.overhead), 0)
    into v_custo_medio, v_horas, v_pool_pessoas
  from horas_custo_camadas(p_org) c where c.custo_hora is not null or c.overhead;
  if coalesce(v_horas, 0) > 0 then v_custo_medio := round(v_custo_medio / v_horas, 2); end if;

  select custo_imposto_pct, custo_margem_alvo_pct into v_manual, v_margem
  from org_settings where org_id = p_org;
  v_margem := coalesce(v_margem, 20);

  select coalesce(sum(coalesce(valor_realizado, valor)), 0) into v_das
  from lancamentos
  where org_id = p_org and tipo = 'saida' and situacao = 'pago'
    and categoria ilike '%simples%'
    and data_liquidacao > current_date - interval '12 months';
  select coalesce(sum(coalesce(valor_realizado, valor)), 0) into v_recebido
  from lancamentos
  where org_id = p_org and tipo = 'entrada' and situacao = 'recebido'
    and data_liquidacao > current_date - interval '12 months';
  v_imposto_auto := case when v_recebido > 0 then round(v_das / v_recebido * 100, 2) end;
  -- Mesma régua da margem por cliente (mig. 266).
  v_imposto := fin_imposto_efetivo_pct(p_org);

  select * into v_over from horas_overhead_mes(p_org);

  return jsonb_build_object(
    'comp', v_comp,
    'custo_hora_medio', v_custo_medio,
    'horas_uteis_mes', round(coalesce(v_horas, 0), 0),
    'overhead_estrutura_mes', v_over.estrutura_mes,
    'provisao_lucro_mes', v_over.provisao_lucro,
    'overhead_pessoas_mes', round(v_pool_pessoas, 2),
    'imposto_pct', v_imposto,
    'imposto_auto_pct', v_imposto_auto,
    'imposto_manual', v_manual is not null,
    'das_12m', round(v_das, 2),
    'recebido_12m', round(v_recebido, 2),
    'margem_pct', v_margem,
    'preco_hora', case when v_custo_medio is not null and (1 - v_imposto/100 - v_margem/100) > 0
                       then round(v_custo_medio / (1 - v_imposto/100 - v_margem/100), 2) end
  );
end $$;
revoke execute on function horas_preco_venda(uuid) from public, anon;
grant  execute on function horas_preco_venda(uuid) to authenticated;

notify pgrst, 'reload schema';
