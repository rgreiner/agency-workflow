-- Desfaz a 329: custo de fornecedor NÃO é despesa da agência.
--
-- A 329 partiu de uma leitura errada minha. O pedido de produção é
-- `faturar = 'contra_cliente'` nos 30 casos existentes, e as parcelas dizem o
-- modelo com todas as letras: `cliente_paga_fornecedor` (o cliente paga o
-- fornecedor DIRETO), `receber_bv` (a agência recebe comissão do fornecedor) e
-- `receber_cliente` (honorários). O próprio formulário do pedido já avisava:
-- "No Financeiro entram só as comissões... O pagamento do cliente ao fornecedor
-- não é lançado."
--
-- Ou seja: não há custo de fornecedor a lançar, porque ele nunca passa pelo
-- caixa da agência. Uma tela convidando a lançá-lo criaria despesa que não
-- existe — inflando o custo e derrubando a margem de cada cliente.
--
-- O modo 'contra_agencia' existe no formulário e nele a agência pagaria o
-- fornecedor. Hoje tem ZERO pedidos. Se passar a ser usado, isto se reconstrói
-- com a régua certa (e só para esse modo), em vez de ficar aqui como máquina
-- parada esperando um caso que talvez não venha.

drop function if exists criar_despesa_de_pedido(uuid, uuid, uuid, jsonb);

notify pgrst, 'reload schema';
