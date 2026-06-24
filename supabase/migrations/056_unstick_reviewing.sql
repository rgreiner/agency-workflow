-- Destrava revisões presas em "reviewing" — gates que não finalizaram (erro na
-- chamada de IA/Drive ou restart do processo no meio do after()). Marca como
-- 'failed' p/ sair do "revisando…" e avisar. A correção no app evita reincidir.

update activities set review_status = 'failed' where review_status = 'reviewing';
