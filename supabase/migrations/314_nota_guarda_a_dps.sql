-- ── A DPS enviada fica guardada junto da nota ───────────────────────────────
--
-- 01/10/2026. Para a conferência da primeira emissão real não basta ver o que a
-- Receita registrou: é preciso ver lado a lado o que o Flow PEDIU e o que ela
-- devolveu. Divergência entre os dois é bug do gerador; divergência entre o
-- cadastro e o pedido é erro de configuração. São defeitos diferentes, e sem a
-- DPS guardada os dois parecem o mesmo.
--
-- Guardada como veio: XML assinado, gzip, base64.
alter table nota_fiscal add column if not exists dps_gz_b64 text;

comment on column nota_fiscal.dps_gz_b64 is
  'DPS assinada que o Flow enviou (gzip+base64). Serve à conferência campo a campo contra o XML autorizado.';

notify pgrst, 'reload schema';
