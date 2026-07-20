-- 128_btg_connection_conta.sql
-- A integração BTG era por organização e aparecia solta na listagem de contas, ao
-- lado das contas. Ela alimenta UMA conta específica, então passa a apontar pra ela
-- e o card vai morar dentro daquela conta. Idempotente.

alter table btg_connections
  add column if not exists conta_id uuid references contas_financeiras(id) on delete set null;

-- Backfill da conexão existente: casa com a conta bancária cujo nome cita BTG.
-- Se não achar, conta_id fica null e a UI mostra o card na listagem como
-- "não vinculada" — a integração nunca fica inalcançável.
update btg_connections c set conta_id = f.id
from contas_financeiras f
where f.org_id = c.org_id
  and c.conta_id is null
  and f.nome ~* 'btg';

notify pgrst, 'reload schema';
