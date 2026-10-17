-- Fim da importação do extrato da Conta Azul (decisão do Rafael, 17/10/2026).
--
-- O Flow lê o banco pelo OFX de cada conta; a Conta Azul não é mais usada. A tela
-- financeiro/importar e as 4 ações saíram do código. As RPCs saem junto: RPC sem
-- tela é superfície de ataque sem dono — e uma delas, clear_extrato, APAGAVA todo
-- o histórico importado, que é a fonte do saldo das contas até 16/07/2026
-- (contas_saldo/fin_movimentos leem extrato_importado), e seguia chamável por
-- qualquer pessoa do financeiro.
--
-- O histórico (extrato_importado) FICA: saldo e fluxo dependem dele. Só não entra
-- mais nada novo.

drop function if exists clear_extrato(uuid, uuid);
drop function if exists import_extrato(uuid, uuid, jsonb);
drop function if exists seed_finance_from_extrato_table(uuid, uuid);
drop function if exists promover_extrato_previstos(uuid, uuid);

notify pgrst, 'reload schema';
