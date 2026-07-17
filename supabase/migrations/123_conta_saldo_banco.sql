-- 123_conta_saldo_banco.sql
-- Saldo real do banco vindo do extrato OFX (LEDGERBAL). Guardado à parte do saldo_inicial
-- (que é saldo de ABERTURA e alimenta a matemática do fluxo de caixa) — este é o saldo
-- do banco NA DATA do extrato, a "verdade" contra a qual a conciliação tem que bater.
-- Idempotente.

alter table contas_financeiras add column if not exists saldo_banco      numeric(14,2);
alter table contas_financeiras add column if not exists saldo_banco_data date;

notify pgrst, 'reload schema';
