-- ── NFS-e: a emissão que não sabe se deu certo ──────────────────────────────
--
-- 01/10/2026. A produção do Sistema Nacional está lenta e instável (medido:
-- `GET /dps/{id}` devolveu 503 em produção enquanto `GET /nfse/{chave}`
-- respondia 200 no mesmo segundo). Isso expõe dois defeitos do caminho atual:
--
-- 1. **Número queimado.** O número da DPS era consumido ANTES de chamar a
--    Receita. Timeout ou 503 e o número ia embora, abrindo buraco na sequência
--    fiscal — justamente o que a migration 313 dizia para evitar.
-- 2. **Confirmação perdida.** Se a Receita autorizasse e a resposta se perdesse
--    no caminho, a nota existiria lá e não aqui. Na tentativa seguinte o Flow
--    emitiria OUTRA, em duplicidade — e duplicidade só se desfaz cancelando.
--
-- A correção para os dois é a mesma: a nota nasce `pendente`, com o número já
-- reservado e o id da DPS gravado, ANTES do envio. Falhando, ela fica pendente
-- e a próxima tentativa pergunta à Receita o que aconteceu com aquela DPS
-- (`GET /sefinnacional/dps/{id}`): virou nota, adota; não virou, reenvia com o
-- MESMO número. Nunca abre buraco e nunca duplica.

alter table nota_fiscal
  add column if not exists id_dps text;

comment on column nota_fiscal.id_dps is
  'Id da DPS enviada. É por ele que se pergunta à Receita o destino de um envio que não respondeu.';

-- A chave só existe depois de autorizada.
alter table nota_fiscal alter column chave drop not null;

alter table nota_fiscal drop constraint if exists nota_fiscal_status_check;
alter table nota_fiscal add constraint nota_fiscal_status_check
  check (status in ('pendente', 'autorizada', 'cancelada'));

-- Uma pendente por lançamento: é ela que guarda o número reservado. Sem isto,
-- duas tentativas simultâneas reservariam dois números para a mesma cobrança.
create unique index if not exists idx_nota_fiscal_pendente_por_lanc
  on nota_fiscal (lancamento_id) where status = 'pendente';

notify pgrst, 'reload schema';
