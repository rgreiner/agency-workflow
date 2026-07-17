-- 116_renumera_docs_pre_serie.sql
-- Renumera os documentos criados no Flow ANTES da migration 115 (que tinham número
-- baixo, recomeçado do zero) pra continuarem a sequência da série do Siga.
--
-- Regra de seleção (idempotente e à prova de colisão): um documento precisa renumerar
-- só se seu número é <= o MAIOR número histórico daquela série (doc_historico). Todo
-- número legítimo da série é > seed = (histórico + 1), então nunca é <= histórico —
-- logo re-rodar não mexe em nada já corrigido, e docs novos criados no meio não são
-- tocados. next_doc_numero() lê o contador vivo, então não colide com o que já existe.
-- Ordena por created_at pra manter a ordem de criação. Idempotente.

do $$
declare r record; v_num integer;
begin
  -- Produção (PP / FEE / PR). Orçamento (serie null) mantém numeração interna.
  for r in
    select p.id, p.serie, p.org_id
    from producao p
    where p.serie in ('PP','FEE','PR')
      and p.numero is not null
      and p.numero <= coalesce((select max(dh.numero) from doc_historico dh
                                where dh.org_id = p.org_id and dh.serie = p.serie), 0)
    order by p.serie, p.created_at, p.numero
  loop
    v_num := next_doc_numero(r.org_id, r.serie);
    update producao set numero = v_num, updated_at = now() where id = r.id;
  end loop;

  -- Mídia (MX/ME/MI/MS/MD). Preparado e idempotente mesmo se hoje não houver registro.
  for r in
    select m.id, m.serie, m.org_id
    from midias m
    where m.serie is not null
      and m.numero is not null
      and m.numero <= coalesce((select max(dh.numero) from doc_historico dh
                                where dh.org_id = m.org_id and dh.serie = m.serie), 0)
    order by m.serie, m.created_at, m.numero
  loop
    v_num := next_doc_numero(r.org_id, r.serie);
    update midias set numero = v_num, updated_at = now() where id = r.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
