-- ── Razão social no cadastro de fornecedor e veículo ────────────────────────
--
-- 01/10/2026. A NFS-e leva a RAZÃO SOCIAL do tomador, não o apelido. Cliente já
-- tinha `legal_name`; fornecedor e veículo só tinham `name`, que é como a casa
-- chama a empresa ("ADESIVOS VIP SIGNS & SILK"). A primeira nota para fornecedor
-- saiu com esse nome curto.
--
-- A razão social vem da consulta por CNPJ, que o Flow já faz para montar o
-- endereço fiscal. Guardar aqui faz o cadastro MELHORAR a cada emissão, em vez
-- de o dado existir só durante a chamada — e serve à cobrança automática, que
-- precisa do mesmo cadastro completo.

alter table fornecedores add column if not exists legal_name text;
alter table veiculos     add column if not exists legal_name text;

comment on column fornecedores.legal_name is 'Razão social, como na Receita. É ela que vai na NFS-e; `name` é o apelido da casa.';
comment on column veiculos.legal_name     is 'Razão social, como na Receita. É ela que vai na NFS-e; `name` é o apelido da casa.';

notify pgrst, 'reload schema';
