-- 182_acesso_arquivado_e_financeiro.sql
-- Auditoria 02/08 — "Segurança e acesso", achados 1 e 2.
--
-- 1) org_member_role NÃO filtrava `arquivado`. A migration 178 fechou o acesso
--    nos 3 helpers de LEITURA (is_org_member/rh_can/horas_can) e prometeu que
--    "o corte mora nos helpers que todo o resto usa" — mas esqueceu este, que é
--    a base de 14 policies de ESCRITA (lançamentos, mídias, fornecedores, séries
--    de documento, inventário, workspaces, campanhas…). Quem foi arquivado
--    perdia a leitura e mantinha a escrita enquanto o JWT durasse (7 dias, sem
--    revogação). Uma linha fecha as 14 de uma vez.
--
-- 2) O Financeiro só era permissionado na APLICAÇÃO (lib/auth/access.ts). No
--    banco, `lancamentos` e `contas_financeiras` liberavam SELECT pra qualquer
--    membro — e como o browser fala direto com o PostgREST com o próprio JWT,
--    bastava `supabase.from('lancamentos').select('*')` no console pra ler o
--    livro-caixa inteiro. Medido: membro sem can_finance enxergava os 661
--    lançamentos. As demais tabelas de dinheiro (btg_movements, extrato_*,
--    fechamento_contabil, ofx_arquivos, btg_conciliacao_itens) já estavam
--    gateadas; faltavam exatamente estas duas — e com elas as views
--    contas_saldo/lancamentos_doc, que herdam por security_invoker (181).
--
-- Idempotente.

-- ── 1) Arquivado não escreve ────────────────────────────────────────────────
create or replace function org_member_role(org uuid)
returns member_role language sql stable security definer set search_path to 'public' as $$
  select role from organization_members
  where org_id = org and user_id = auth.uid() and arquivado = false
  limit 1;
$$;

-- ── 2) Portão do Financeiro, espelhando rh_can ──────────────────────────────
-- Inclui op_ver_tudo do cargo porque é assim que a aplicação computa o acesso
-- (computeAccess: financeiro = verTudo || can_finance). Se o banco fosse mais
-- estrito que a tela, a Diretoria veria o menu e receberia tabela vazia.
create or replace function fin_can(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from organization_members om
    left join org_positions pos on pos.id = om.position_id
    where om.org_id = p_org and om.user_id = auth.uid() and om.arquivado = false
      and (om.role in ('owner','admin') or om.can_finance or coalesce(pos.op_ver_tudo, false))
  );
$$;
grant execute on function fin_can(uuid) to anon, authenticated;

-- lancamentos ────────────────────────────────────────────────────────────────
-- Toda escrita da aplicação passa por RPC security definer (create_lancamento,
-- update_lancamento, liquidar_lancamento, gerar_lancamento_midia…), então tirar
-- a policy de manager não fecha nenhum caminho de tela.
drop policy if exists "Org members read lancamentos" on lancamentos;
drop policy if exists "Manager+ manage lancamentos"  on lancamentos;
drop policy if exists "Finance read lancamentos"     on lancamentos;
drop policy if exists "Finance write lancamentos"    on lancamentos;
create policy "Finance read lancamentos" on lancamentos
  for select using (fin_can(org_id));
create policy "Finance write lancamentos" on lancamentos
  for all using (fin_can(org_id)) with check (fin_can(org_id));

-- contas_financeiras ─────────────────────────────────────────────────────────
drop policy if exists "Org members read contas_fin" on contas_financeiras;
drop policy if exists "Manager+ manage contas_fin"  on contas_financeiras;
drop policy if exists "Finance read contas_fin"     on contas_financeiras;
drop policy if exists "Finance write contas_fin"    on contas_financeiras;
create policy "Finance read contas_fin" on contas_financeiras
  for select using (fin_can(org_id));
create policy "Finance write contas_fin" on contas_financeiras
  for all using (fin_can(org_id)) with check (fin_can(org_id));

notify pgrst, 'reload schema';
