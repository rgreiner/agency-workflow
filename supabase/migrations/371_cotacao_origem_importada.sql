-- 371_cotacao_origem_importada.sql
-- Proposta que chega POR FORA (PDF por e-mail/WhatsApp) e é lida pela IA entra como
-- resposta de cotação, para cair no mesmo comparativo de quem respondeu pelo link.
-- Ela mora numa cotação de origem 'importada': nenhum e-mail sai, nenhum fornecedor
-- recebe o link, e por isso os itens dela podem crescer à vontade (numa cotação
-- 'link', item novo apareceria na página de quem já foi convidado).
-- Idempotente.

alter table cotacoes add column if not exists origem text not null default 'link';
do $$ begin
  alter table cotacoes add constraint cotacoes_origem_chk check (origem in ('link', 'importada'));
exception when duplicate_object then null; end $$;

comment on column cotacoes.origem is 'link = pedido enviado aos fornecedores; importada = propostas recebidas por fora e lidas de PDF.';

notify pgrst, 'reload schema';
