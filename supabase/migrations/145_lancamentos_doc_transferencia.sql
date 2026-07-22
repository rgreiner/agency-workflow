-- 145_lancamentos_doc_transferencia.sql
-- A view lancamentos_doc (usada pela tela de Lançamentos) não expunha
-- transferencia_id, então o select da 144/UI quebrava a tela inteira.
-- Recria a view com a coluna (no FIM — create or replace view só permite ADD no fim).
-- Idempotente.

create or replace view lancamentos_doc as
 SELECT l.id,
    l.org_id,
    l.tipo,
    l.origem_tipo,
    l.origem_id,
    l.contato_tipo,
    l.contato_nome,
    l.descricao,
    l.valor,
    l.vencimento,
    l.situacao,
    l.conta_corrente_id,
    l.created_by,
    l.created_at,
    l.updated_at,
    l.competencia,
    l.nf_emitida,
    l.boleto_gerado,
    l.conta_id,
    l.categoria,
    l.centro_custo,
    l.data_liquidacao,
    l.valor_realizado,
    l.juros,
    l.multa,
    l.desconto,
    l.tarifa,
    l.forma_pagamento,
    l.observacao,
    l.recorrente,
    l.parcela_num,
    l.parcela_total,
    l.grupo_id,
    l.anexos,
    l.origem_ref,
    l.revisar,
    COALESCE(p.serie, m.serie) AS doc_serie,
    COALESCE(p.numero, m.numero) AS doc_numero,
        CASE
            WHEN p.id IS NOT NULL THEN 'producao'::text
            WHEN m.id IS NOT NULL THEN 'midia'::text
            ELSE NULL::text
        END AS doc_origem,
    p.tipo AS doc_producao_tipo,
    l.transferencia_id
   FROM lancamentos l
     LEFT JOIN producao p ON l.origem_tipo = 'producao'::text AND p.id = l.origem_id
     LEFT JOIN midias m ON l.origem_tipo = 'midia'::text AND m.id = l.origem_id;

notify pgrst, 'reload schema';
