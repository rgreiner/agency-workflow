-- 151_rh_colaborador_self.sql
-- O "bater ponto" é de TODO membro (não só can_rh). Pra o colaborador achar a própria
-- ficha (id + vínculo) e bater ponto, precisa ler A PRÓPRIA linha de rh_colaborador.
-- Policy de auto-leitura (só a própria linha; gestão continua sob rh_can). Idempotente.

drop policy if exists rh_colaborador_self_read on rh_colaborador;
create policy rh_colaborador_self_read on rh_colaborador
  for select using (membro_user_id = auth.uid());

notify pgrst, 'reload schema';
