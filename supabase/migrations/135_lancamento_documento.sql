-- 135: o lançamento passa a saber QUAL documento o originou (MX 1567, PP 1783, Fee 34).
--
-- O elo já existia no banco desde a 040 (origem_tipo + origem_id), mas parava no
-- servidor: nenhuma tela buscava producao.serie/numero nem midias.serie/numero, então
-- não dava pra renderizar o código. Como origem_id é uuid solto (sem FK), o PostgREST
-- não consegue embutir o relacionamento — daí uma view com os joins prontos.
--
-- Nada de novo é gravado: é leitura. A escrita continua indo na tabela lancamentos
-- pelas RPCs de sempre.
create or replace view lancamentos_doc with (security_invoker = true) as
select
  l.*,
  coalesce(p.serie, m.serie)   as doc_serie,
  coalesce(p.numero, m.numero) as doc_numero,
  -- 'producao' | 'midia' | null — define a rota do link no front.
  case when p.id is not null then 'producao'
       when m.id is not null then 'midia' end as doc_origem,
  -- fee | pedido | proposta | orcamento — vira o segmento /producao/{tipo}/{id}.
  p.tipo as doc_producao_tipo
from lancamentos l
left join producao p on l.origem_tipo = 'producao' and p.id = l.origem_id
left join midias   m on l.origem_tipo = 'midia'    and m.id = l.origem_id;

grant select on lancamentos_doc to anon, authenticated;

notify pgrst, 'reload schema';
