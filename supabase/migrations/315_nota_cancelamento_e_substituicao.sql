-- ── NFS-e: cancelar e substituir ────────────────────────────────────────────
--
-- 01/10/2026. Nota emitida é ato público: o conserto não é editar, é CANCELAR
-- (evento e101101) ou SUBSTITUIR (nova DPS carregando o grupo `subst`, e a
-- Receita cancela a antiga sozinha, registrando o evento e105102).
--
-- Os dois caminhos existem porque respondem a perguntas diferentes:
--   · cancelar    — a nota não devia existir (erro na emissão, serviço não prestado);
--   · substituir  — a nota devia existir, com outro conteúdo (valor, tributação).
-- Substituir preserva o histórico: a chave velha aponta para a nova e vice-versa.
--
-- Não existe status 'substituida': para a Receita a nota substituída está
-- CANCELADA (por substituição). Guardar um terceiro estado seria inventar um
-- fato que o XML não registra — o que distingue os dois casos é `substituida_por`.

alter table nota_fiscal
  -- Código e texto do motivo, como foram enviados no evento (1/2/9 no cancelamento,
  -- 01..05/99 na substituição). Fica no banco porque a pergunta "por que esta nota
  -- foi cancelada?" chega meses depois, da contabilidade.
  add column if not exists cancel_cod       text,
  add column if not exists cancel_motivo    text,
  -- XML do pedido de evento, assinado e como foi enviado. Mesma razão da DPS
  -- (migration 314): sem ele, divergência de gerador e erro de operação parecem
  -- o mesmo defeito.
  add column if not exists evento_gz_b64    text,
  -- Elo entre as duas notas, nos dois sentidos.
  add column if not exists substitui_chave  text,
  add column if not exists substituida_por  text;

comment on column nota_fiscal.substitui_chave is 'Chave da NFS-e que ESTA nota substituiu (vai no grupo subst da DPS).';
comment on column nota_fiscal.substituida_por is 'Chave da NFS-e substituta — preenchido na nota antiga quando a nova é autorizada.';

notify pgrst, 'reload schema';
