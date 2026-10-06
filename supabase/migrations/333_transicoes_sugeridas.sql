-- O fluxo de status medido, para a tela sugerir o destino certo.
--
-- O "Avançar" do StatusChanger usava o PRÓXIMO DA ORDEM do cadastro. A ordem de
-- `org_status` é de exibição, não de fluxo — medido em 06/10/2026 sobre 3.980
-- transições de 377 tarefas, ela acerta o destino mais comum em 7 dos 21
-- status. Em briefing sugeria "pendente do cliente" (o real é redação), em
-- design sugeria "edição" (o real é validação de criação), em mídia sugeria
-- "social" (o real é concluído). Dois terços dos casos empurravam a pessoa para
-- a etapa errada com um clique só.
--
-- O fluxo real existe e é nítido: briefing→redação 58%, redação→design 81%,
-- design→validação 60%, validação→revisão 54%, revisão→atendimento 74%. E a
-- VOLTA é parte dele, não exceção: de validação de criação, 29% voltam para
-- design; de revisão interna, 20% voltam. Por isso a função devolve os destinos
-- ordenados por frequência, e quem chama decide quantos mostrar.
--
-- Janela móvel de 90 dias: se o processo da casa mudar, a sugestão acompanha
-- sem ninguém reconfigurar nada. Abaixo de MIN_AMOSTRA transições num status a
-- função devolve nada — com 3 amostras, "o mais comum" é só a última vez que
-- alguém mexeu, e sugerir isso com ar de regra é pior que não sugerir.

create or replace function activity_transicoes_sugeridas(p_org uuid)
returns table(de text, para text, vezes bigint, pct numeric, pos int)
language sql stable security definer set search_path = public as $$
  with permitido as (
    select is_org_member(p_org) as ok
  ),
  bruto as (
    select h.from_status, h.to_status, count(*)::bigint as n
      from activity_history h
      join activities a on a.id = h.activity_id
      -- A tarefa não guarda org: chega nela por campanha → cliente.
      join campaigns ca on ca.id = a.campaign_id
      join workspaces w on w.id = ca.workspace_id
     where w.org_id = p_org
       and h.from_status is not null
       and h.to_status is not null
       and h.from_status <> h.to_status
       and h.changed_at >= now() - interval '90 days'
     group by 1, 2
  ),
  total as (
    select from_status, sum(n) as total from bruto group by 1
  )
  select b.from_status, b.to_status, b.n,
         round(100.0 * b.n / t.total, 0) as pct,
         row_number() over (partition by b.from_status order by b.n desc, b.to_status)::int as pos
    from bruto b
    join total t on t.from_status = b.from_status
   cross join permitido p
   where p.ok
     -- Evidência mínima por status de origem. 12 é o piso onde o 1º lugar
     -- deixa de empatar com o acaso nas etapas de baixo volume da casa.
     and t.total >= 12
   order by t.total desc, b.n desc;
$$;

-- DEFAULT PRIVILEGES deste banco dá EXECUTE a anon/authenticated em toda função
-- nova; revogar de PUBLIC não toca nesses dois. A função é SECURITY DEFINER e
-- confere is_org_member no corpo, mas anon não tem por que alcançá-la.
revoke execute on function activity_transicoes_sugeridas(uuid) from public, anon;
grant execute on function activity_transicoes_sugeridas(uuid) to authenticated;

notify pgrst, 'reload schema';
