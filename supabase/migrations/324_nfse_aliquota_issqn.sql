-- ── Alíquota do ISSQN na DPS ────────────────────────────────────────────────
--
-- 01/10/2026, levantado pelo financeiro: a NF 2210, emitida pelo sistema da
-- prefeitura, mostra ISSQN apurado de R$ 41,48 (base 962,50 × 4,31%). As duas
-- que o Flow emitiu hoje mostram base 0, alíquota 0 e ISSQN 0.
--
-- A causa, isolada comparando os XMLs: o bloco de regime é IDÊNTICO nos dois
-- (opSimpNac 3, regApTribSN 1, regEspTrib 0). A única diferença no bloco
-- municipal é `pAliq`, que a prefeitura informa (4.31) e o Flow não informava.
--
-- O que a norma diz desse campo (XSD tiposComplexos v1.01):
--   "Se o município de incidência pertence ao Sistema Nacional NFS-e a alíquota
--    estará parametrizada e será fornecida pelo sistema. Se não pertence,
--    deverá ser fornecida pelo emitente."
--
-- Cascavel manteve emissor próprio, e o Sistema Nacional devolveu zero — o que
-- indica que ela não está parametrizada lá. Daí o campo ser nosso.
--
-- ⚠️ Nasce VAZIO, e vazio mantém exatamente o comportamento de hoje. Preencher
-- muda o que é declarado ao fisco municipal: é decisão da contabilidade, não do
-- código. Para optante do Simples o ISS é recolhido no DAS — informar a alíquota
-- aqui é declaração, não guia de pagamento.

alter table org_nfse_config
  add column if not exists aliq_issqn numeric(5,2);

comment on column org_nfse_config.aliq_issqn is
  'pAliq: alíquota do ISSQN (%) do município de incidência. Vazio = não informar, que é o padrão. Só preencher com orientação da contabilidade.';

notify pgrst, 'reload schema';
