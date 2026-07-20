for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

-- O Fee 65 do Times Digitais existe duas vezes: nativo do Flow (origem_tipo
-- 'producao', "Fee conteudo") e vindo do import da Conta Azul. Decisão do Rafael:
-- fica o NATIVO — Lançamentos é o livro-caixa oficial. Antes de apagar, os anexos
-- (NF 2162 + boleto) precisam migrar pra parcela nativa, senão os documentos vão junto.

-- 1) Anexos: Conta Azul (28/07) -> nativo (28/07). Merge, e não replace, pra não
--    perder anexo que já estivesse na parcela nativa.
update lancamentos nat set
  anexos = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
              from jsonb_array_elements(coalesce(nat.anexos,'[]'::jsonb)
                                        || coalesce(ca.anexos,'[]'::jsonb)) x),
  updated_at = now()
from lancamentos ca
where nat.origem_tipo = 'producao' and nat.contato_nome = 'Times Digitais'
  and nat.vencimento = date '2026-07-28'
  and ca.origem_tipo = 'conta_azul' and ca.contato_nome = 'Times Digitais'
  and ca.vencimento = date '2026-07-28';

\echo '-- anexos na parcela nativa de julho (esperado 2) --'
select vencimento, jsonb_array_length(coalesce(anexos,'[]'::jsonb)) as anexos
from lancamentos where origem_tipo='producao' and contato_nome='Times Digitais'
  and vencimento = date '2026-07-28';

-- 2) Some com as linhas do extrato correspondentes, senão elas ressurgem como
--    "Conta Azul" assim que o lançamento que as escondia deixar de existir.
update extrato_importado e set situacao = 'Perdido/Desconsiderado'
where exists (
  select 1 from lancamentos l
  where l.origem_tipo = 'conta_azul' and l.contato_nome = 'Times Digitais'
    and l.origem_ref = e.import_ref
);

-- 3) Agora sim, apaga os 12 duplicados do Conta Azul.
delete from lancamentos
where origem_tipo = 'conta_azul' and contato_nome = 'Times Digitais';

\echo ''
\echo '-- CONFERENCIA: deve sobrar so o nativo, 12 parcelas --'
select origem_tipo, count(*), round(sum(valor),2) as total
from lancamentos where contato_nome = 'Times Digitais' group by 1;

\echo '-- pares duplicados restantes na base inteira (esperado 0) --'
select count(*) as pares
from lancamentos a join lancamentos b
  on b.org_id=a.org_id and b.contato_nome=a.contato_nome and b.vencimento=a.vencimento
 and b.valor=a.valor and b.id>a.id and coalesce(b.origem_tipo,'')<>coalesce(a.origem_tipo,'');

commit;
SQL
  fi
done
