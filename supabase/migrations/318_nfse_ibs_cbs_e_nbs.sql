-- ── NFS-e: campos da Reforma (IBS/CBS e NBS) ────────────────────────────────
--
-- 01/10/2026. Descoberto sondando a produção restrita — nada disto está em
-- documentação utilizável, e cada linha abaixo é a resposta de um erro:
--
--   E0854  "Somente é permitido declarar informações de IBS/CBS a partir da
--           versão 1.01 da DPS."     → a DPS do Flow declara 1.00.
--   E0322  "É obrigatório informar na DPS um item da NBS se for declarada
--           qualquer informação de IBS/CBS."
--   E0901  "Código indicador da operação inexistente."  → cIndOp é código de
--           tabela, 6 dígitos; valor inventado é recusado.
--
-- ⚠️ As alíquotas de teste de 2026 (0,9% CBS / 0,1% IBS) **não são enviadas por
-- nós**. Não existe campo de alíquota no que o emitente manda: o grupo carrega a
-- CLASSIFICAÇÃO da operação (CST + cClassTrib) e quem calcula é a Receita. Por
-- isso aqui não há coluna de percentual — teria de ser preenchida com um número
-- que o sistema ignora, e campo que mente é pior que campo que falta.
--
-- Nasce DESLIGADO. Os três códigos são decisão da contabilidade, como o
-- percentual do Simples: classificação errada em nota oficial só se conserta
-- cancelando.

alter table org_nfse_config
  -- Nomenclatura Brasileira de Serviços: 9 dígitos. Aceito pela Receita já na
  -- versão 1.00 da DPS, e obrigatório quando houver IBS/CBS.
  add column if not exists cod_nbs            text,
  -- Chave-geral. Com ela desligada a DPS segue saindo na versão 1.00, exatamente
  -- como a nota que já funciona hoje.
  add column if not exists ibs_cbs_ativo      boolean not null default false,
  -- Códigos de tabela da Reforma. Tamanhos conferidos no XSD v1.01.
  add column if not exists ibs_cbs_cind_op    text,  -- cIndOp,     6 dígitos
  add column if not exists ibs_cbs_cst        text,  -- CST,        3 dígitos
  add column if not exists ibs_cbs_classtrib  text;  -- cClassTrib, 6 dígitos

comment on column org_nfse_config.cod_nbs is
  'Código NBS (9 dígitos) do serviço. Em 2026 é o campo da Reforma que o optante do Simples informa.';
comment on column org_nfse_config.ibs_cbs_ativo is
  'Liga o grupo IBSCBS na DPS e sobe a versão para 1.01. Exige NBS e os três códigos preenchidos.';

notify pgrst, 'reload schema';
