-- 233_login_attempts_bloqueado.sql
-- Diagnóstico do "a senha parou de funcionar" (11/08/2026): a tentativa BARRADA pelo
-- limite não deixava rastro nenhum. `limiteEstourado` responde antes de
-- `registrarTentativa`, então quem levava o bloqueio sumia do log — e o histórico
-- mostrava um silêncio de 15 minutos que se lê como "parou de tentar", quando na
-- verdade era "o sistema recusou sem contar".
--
-- Passa a registrar, numa coluna própria. Ela NÃO pode contar pro limite: se
-- contasse, cada nova tentativa barrada empurraria a janela pra frente e o bloqueio
-- nunca terminaria — quem estivesse trancado ficaria trancado para sempre.
-- Idempotente.

alter table auth.login_attempts add column if not exists bloqueado boolean not null default false;

-- A contagem do limite lê só linha não-bloqueada; este índice serve exatamente ela.
create index if not exists login_attempts_janela_idx
  on auth.login_attempts (kind, created_at desc)
  where bloqueado = false;

comment on column auth.login_attempts.bloqueado is
  'true = pedido recusado pelo limite, antes de conferir a senha. Fica FORA da contagem do limite (senão o bloqueio se auto-renova); existe para o histórico mostrar o que aconteceu.';
