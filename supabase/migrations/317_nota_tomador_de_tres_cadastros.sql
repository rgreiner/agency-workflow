-- ── NFS-e: o tomador não é só cliente ───────────────────────────────────────
--
-- 01/10/2026. A emissão nasceu assumindo que quem recebe a nota é um CLIENTE.
-- É metade do negócio: a comissão da agência é cobrada de quem paga a comissão.
--
--   · Fee / Job        → a NF vai para o CLIENTE;
--   · comissão de mídia→ a NF vai para o VEÍCULO;
--   · comissão de prod.→ a NF vai para o FORNECEDOR.
--
-- Medido nos lançamentos a receber: Rede Outdoor (16), Vision Outdoor (8),
-- Lasfer (8), JB Creative (4), FineArt (3)… nenhum deles é cliente, e todos
-- recebem nota da agência. Era por isso que a NF 2204 da USETECH — um
-- FORNECEDOR — existia fora do Flow.
--
-- `tomador_tipo` guarda de qual cadastro veio quem recebeu a nota. Sem isso,
-- "para quem emitimos?" só se responde por nome, e nome não é chave.

alter table nota_fiscal
  add column if not exists tomador_tipo text
    check (tomador_tipo is null or tomador_tipo in ('cliente', 'fornecedor', 'veiculo'));

comment on column nota_fiscal.tomador_tipo is
  'Cadastro de origem do tomador: cliente (workspaces), fornecedor ou veiculo. lancamentos.workspace_id só é preenchido no caso cliente.';

-- A única nota emitida até aqui foi para um cliente (FC Cascavel).
update nota_fiscal set tomador_tipo = 'cliente' where tomador_tipo is null;

notify pgrst, 'reload schema';
