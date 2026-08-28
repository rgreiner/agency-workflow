-- 267_margem_fase_cliente.sql
-- FASE DO CLIENTE na margem (regra de negócio do Rafael, 28/08): "nos primeiros
-- 3 meses do cliente entregamos mais do que é contratado; muito trabalho até
-- entrar nos trilhos". Sem essa distinção a tela mistura duas coisas opostas:
-- investimento de implantação e cliente maduro que não se paga.
--
-- Medido em prod, o que a distinção separa:
--   · IMDM     — 1ª tarefa 29/06/2026, margem −11%  → implantação (2 meses)
--   · Opera    — 1ª tarefa 26/01/2026, 74h e ZERO receita registrada → maduro
--   · Di Napoli— 1ª tarefa 23/01/2026, margem −183% → maduro
--
-- `desde` = a mais antiga entre a primeira tarefa e o primeiro recebimento do
-- cliente. NÃO usar workspaces.created_at: os cadastros nasceram todos em
-- junho/2026, quando o Flow foi implantado — daria "todo cliente é novo".
-- Idempotente.

drop function if exists fin_margem_cliente(uuid, date, date);

create function fin_margem_cliente(p_org uuid, p_ini date, p_fim date)
returns table (
  workspace_id uuid, cliente text, agencia boolean,
  receita numeric, imposto numeric,
  horas numeric, custo_horas numeric, custo_direto numeric,
  margem numeric, margem_pct numeric,
  desde date, meses_casa int
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
  final as (
    select j.ws,
           coalesce(w.name, j.nome) as cliente,
           sum(j.receita) as receita, sum(j.saida) as saida,
           sum(j.horas) as horas, sum(j.custo_h) as custo_h
      from juntos j
      left join workspaces w on w.id = j.ws
     group by 1, 2
  ),
  -- Início do relacionamento: a mais antiga entre a 1ª tarefa e o 1º
  -- recebimento (o cadastro não serve — todos nasceram na virada do Flow).
  inicio as (
    select f.ws,
           least(
             (select min(a.created_at)::date from activities a
                join campaigns c on c.id = a.campaign_id
               where c.workspace_id = f.ws),
             (select min(l.data_liquidacao) from lancamentos l
               where l.workspace_id = f.ws and l.tipo = 'entrada' and l.situacao = 'recebido')
           ) as desde
      from final f where f.ws is not null
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
              then round((f.receita - (f.receita * v_imp / 100) - f.custo_h - f.saida) / f.receita * 100, 1) end,
         i.desde,
         -- Meses de casa NO FIM do período analisado (não "hoje"): olhar um
         -- trimestre antigo tem que dizer a idade que o cliente tinha lá.
         case when i.desde is not null
              then greatest(0, (extract(year from age(p_fim, i.desde)) * 12
                              + extract(month from age(p_fim, i.desde)))::int) end
    from final f
    left join inicio i on i.ws = f.ws
    cross join (select name from organizations where id = p_org) o
   where f.receita <> 0 or f.custo_h <> 0 or f.saida <> 0
   order by f.receita desc, f.custo_h desc;
end $$;
revoke execute on function fin_margem_cliente(uuid, date, date) from public, anon;
grant  execute on function fin_margem_cliente(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
