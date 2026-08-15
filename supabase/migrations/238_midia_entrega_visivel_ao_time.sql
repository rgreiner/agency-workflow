-- 238_midia_entrega_visivel_ao_time.sql
-- Corrige o alcance da leitura das entregas.
--
-- A migration 236 deixou `midia_entrega` legível só por quem tem `midia_can` —
-- e com isso o aviso "a mídia espera esta peça até dia X", que eu coloquei na
-- página da TAREFA, ficava invisível justamente para quem faz a arte. O aviso
-- existe para o prazo do veículo chegar até a criação; barrá-lo ali esvazia a
-- feature (a view é security_invoker, então a policy de baixo é que manda).
--
-- Leitura passa a ser de qualquer membro da org: prazo de veículo é
-- compromisso, não dado sensível. A ESCRITA continua fechada — só as RPCs com
-- guard `midia_can` alteram entrega.
--
-- Idempotente.

drop policy if exists midia_entrega_read on midia_entrega;
create policy midia_entrega_read on midia_entrega
  for select using (is_org_member(org_id));

notify pgrst, 'reload schema';
