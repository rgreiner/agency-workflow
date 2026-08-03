-- 194_rh_ponto_rls.sql
-- Auditoria 02/08, RH #1 (alta, verificado): "A pessoa pode editar o próprio
-- ponto e aprovar a si mesma pelo PostgREST".
--
-- As três tabelas do ponto têm UMA policy `for all` com
-- `rh_can(org_id) or rh_is_self(colaborador_id)` nos dois lados (using E with
-- check), e o papel `authenticated` tem grant `arwd`. Como o flow-api é público,
-- basta o token do próprio usuário para:
--   · inserir marcação falsa em rh_marcacao (durável — o recálculo lê de lá)
--   · trocar o status da própria justificativa para 'aprovado'
--   · aprovar a própria hora extra em rh_ponto.extra_status
-- Adulterar `minutos` direto é efêmero (o recálculo sobrescreve), mas os três
-- acima ficam. Num registro de ponto que virou oficial em 03/08, isso é problema
-- trabalhista, não só técnico.
--
-- Correção: a pessoa LÊ o próprio ponto e ABRE justificativa; escrever é do RH.
-- Nada disso alcança o app: bater ponto (`rh_bater_ponto`), editar
-- (`rh_editar_ponto`), decidir (`rh_decidir_justificativa`) e assinar são todas
-- SECURITY DEFINER, que roda como dono e não passa por RLS. A tela de gestão do
-- ponto já é gateada por `assertRhAccess`, então `decidirExtra` (update direto em
-- rh_ponto) segue funcionando para quem tem RH.
--
-- Idempotente.

-- ── rh_ponto ────────────────────────────────────────────────────────────────
drop policy if exists rh_ponto_rw     on rh_ponto;
drop policy if exists rh_ponto_ler    on rh_ponto;
drop policy if exists rh_ponto_rh     on rh_ponto;
create policy rh_ponto_ler on rh_ponto
  for select using (rh_can(org_id) or rh_is_self(colaborador_id));
create policy rh_ponto_rh on rh_ponto
  for all using (rh_can(org_id)) with check (rh_can(org_id));

-- ── rh_marcacao ─────────────────────────────────────────────────────────────
drop policy if exists rh_marcacao_rw  on rh_marcacao;
drop policy if exists rh_marcacao_ler on rh_marcacao;
drop policy if exists rh_marcacao_rh  on rh_marcacao;
create policy rh_marcacao_ler on rh_marcacao
  for select using (exists (
    select 1 from rh_ponto p
     where p.id = rh_marcacao.ponto_id and (rh_can(p.org_id) or rh_is_self(p.colaborador_id))));
create policy rh_marcacao_rh on rh_marcacao
  for all using (exists (
    select 1 from rh_ponto p where p.id = rh_marcacao.ponto_id and rh_can(p.org_id)))
  with check (exists (
    select 1 from rh_ponto p where p.id = rh_marcacao.ponto_id and rh_can(p.org_id)));

-- ── rh_justificativa ────────────────────────────────────────────────────────
-- Abrir justificativa é da pessoa (é o canal dela para falar com o RH), mas ela
-- nasce PENDENTE e sem decisão: sem isso dava para inserir uma já aprovada.
-- Alterar depois é só do RH — quem decide é quem tem RH, por RPC.
drop policy if exists rh_justificativa_rw    on rh_justificativa;
drop policy if exists rh_justificativa_ler   on rh_justificativa;
drop policy if exists rh_justificativa_abrir on rh_justificativa;
drop policy if exists rh_justificativa_rh    on rh_justificativa;
create policy rh_justificativa_ler on rh_justificativa
  for select using (rh_can(org_id) or rh_is_self(colaborador_id));
create policy rh_justificativa_abrir on rh_justificativa
  for insert with check (
    rh_is_self(colaborador_id)
    and status = 'pendente' and decidido_por is null and decidido_em is null);
create policy rh_justificativa_rh on rh_justificativa
  for all using (rh_can(org_id)) with check (rh_can(org_id));

notify pgrst, 'reload schema';
