-- 286_fecha_anon_sem_guarda.sql
-- Fecha para `anon` as funções SECURITY DEFINER que não têm guarda nenhuma.
--
-- De onde veio (auditoria de 13/09/2026, medida no banco e não contada no repo):
-- este cluster tem `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO
-- anon, authenticated`, então TODA função nova nasce chamável pelos dois papéis e
-- o `revoke ... from public` que a maioria das migrations escreve não tira nada.
-- Medido: das 352 funções SECURITY DEFINER do schema, 85 alcançavam `anon`; tirando
-- os 10 gatilhos (não chamáveis por RPC) sobraram 75, e 67 dessas guardam por
-- `auth.uid()` ou por um helper (rh_can, fin_can, is_org_member…). Restaram estas 8.
--
-- A pior era `gerar_lancamentos_producao`: SEM LOGIN dava para gerar lançamento no
-- livro-caixa. Mesma classe do P0 de 15/08, quando `anon` gravava na cadeia do ponto.
--
-- Nenhuma das 7 abaixo tem call site em TypeScript (conferido em `src`): quem as
-- chama são outras funções SECURITY DEFINER, que rodam como DONO e por isso não
-- dependem destes grants. Fechar não muda o comportamento do app.
--
-- Idempotente (revoke/grant são declarativos).

-- ── Helpers e efeitos internos: ninguém de fora chama ────────────────────────
revoke execute on function org_status_slug(uuid, text)              from public, anon, authenticated;
revoke execute on function seed_default_positions(uuid)             from public, anon, authenticated;
revoke execute on function _recompute_lanc_conciliacao(uuid)        from public, anon, authenticated;
revoke execute on function portal_notificar(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function rh_recalc_ponto(uuid)                    from public, anon, authenticated;

-- ── Dinheiro: geração de lançamento nunca pode ser alcançável de fora ────────
revoke execute on function gerar_lancamentos_pedido(uuid)           from public, anon, authenticated;
revoke execute on function gerar_lancamentos_producao(uuid, uuid, text, text, text) from public, anon, authenticated;

-- ── A exceção, agora EXPLÍCITA ──────────────────────────────────────────────
-- `get_invite_info` é chamada por /convite/[token] ANTES do login (src/app/convite/
-- [token]/page.tsx): quem abre o convite ainda não é membro. O segredo é o token.
-- O grant vinha por default privilege, ou seja, por acidente; fica registrado para
-- a próxima auditoria não fechar por engano e derrubar o convite.
grant execute on function get_invite_info(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
