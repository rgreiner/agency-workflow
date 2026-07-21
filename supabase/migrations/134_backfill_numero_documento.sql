-- 134_backfill_numero_documento.sql
-- Preenchimento único: número do documento a partir do nome do arquivo, nos
-- anexos que já existiam antes da tela ganhar o campo (commit b4a8125).
--
-- A tabela `mapa` abaixo foi GERADA pela função `numeroDoNome`
-- (src/lib/documento-fiscal.ts) rodando sobre os nomes reais do banco — a regra
-- vive só no TypeScript, aqui está apenas o resultado dela. Foi feito assim de
-- propósito: reescrever a regex em SQL criaria duas verdades que divergem com o
-- tempo (foi o que quase aconteceu com parseMoney/_br_num na migration 132).
--
-- Só preenche onde `numero` está vazio — reaplicar não sobrescreve nada, e
-- número corrigido à mão sobrevive.
-- NÃO mexe em `emitente`: não dá pra deduzir do nome do arquivo com segurança
-- (o nome traz o contato, não quem emitiu).
--
-- Ensaiado em produção com begin/rollback: 29 lançamentos, 63 de 101 anexos com
-- número ao final, total de anexos inalterado (101).
-- Idempotente.


with mapa(nome, numero) as (values
  ('4091.pdf', '4091'),
  ('Kyoto - Boleto 1991.pdf', '1991'),
  ('Di Napoli - boleto 2158.pdf', '2158'),
  ('NF 593.pdf', '593'),
  ('E o Amor - NF 2149.pdf', '2149'),
  ('recibo_de_honorarios_contabeis_0000017668.pdf', '0000017668'),
  ('Opera - NF 2148.pdf', '2148'),
  ('Positiva - boleto 2163.pdf', '2163'),
  ('Di Napoli - NF 2158.pdf', '2158'),
  ('2842.pdf', '2842'),
  ('Iatzar - boleto 2159.pdf', '2159'),
  ('NF 26-1 - BOLETO.PDF', '26'),
  ('NF 591.pdf', '591'),
  ('Rede (fronteira) - NF 2156.pdf', '2156'),
  ('boleto_VENCE 15-07 (NF 1361).pdf', '1361'),
  ('FC - NF 2150.pdf', '2150'),
  ('KSBIG - NF 2146.pdf', '2146'),
  ('boleto-06-2026-00079351-parana-energia__rafael-diego-greiner.pdf', '06'),
  ('FC - boleto 2150.pdf', '2150'),
  ('Comil - Boleto 2147.pdf', '2147'),
  ('IMDM - NF 2151.pdf', '2151'),
  ('NF 331 - Pedido N 677.pdf', '331'),
  ('recibo_de_honorarios_contabeis_0000017883.pdf', '0000017883'),
  ('Tuicial - boleto 2160.pdf', '2160'),
  ('4093.pdf', '4093'),
  ('Iatzar - NF 2159.pdf', '2159'),
  ('E O Amor - NF 2157.pdf', '2157'),
  ('NF 592.pdf', '592'),
  ('boleto-06-2026-00079350-parana-energia__rafael-diego-greiner.pdf', '06'),
  ('MSG - boleto 2152.pdf', '2152'),
  ('Times Digitais - NF 2162.pdf', '2162'),
  ('Grafica Merito - NF 2135.pdf', '2135'),
  ('Rede (fronteira) - boleto 2156.pdf', '2156'),
  ('Times Digitais - boleto 2162.pdf', '2162'),
  ('4092.pdf', '4092'),
  ('Vision - NF 2155.pdf', '2155'),
  ('Positiva - NF 2163.pdf', '2163'),
  ('Kyoto - NF 1991.pdf', '1991'),
  ('Comil - NF 2147.pdf', '2147'),
  ('KSBIG - boleto 2146.pdf', '2146'),
  ('MSG - NF 2152.pdf', '2152'),
  ('100177.PDF', '100177'),
  ('ADI - NF 2154.pdf', '2154'),
  ('Grafica Merito - boleto 2135.pdf', '2135'),
  ('ADI - boleto 2154.pdf', '2154'),
  ('Vision - Boleto 2155.pdf', '2155'),
  ('NF 29.pdf', '29'),
  ('3564.pdf', '3564'),
  ('IMDM - boleto 2151.pdf', '2151'),
  ('E o Amor - boleto 2149.pdf', '2149'),
  ('E O Amor  - boleto 2157.pdf', '2157'),
  ('Tuicial - NF 2160.pdf', '2160'),
  ('Opera - boleto 2148.pdf', '2148'),
  ('NF 26.pdf', '26')
)
update lancamentos l
   set anexos = (
         select jsonb_agg(
                  case when coalesce(e.a->>'numero','') <> '' then e.a
                       when m.numero is null then e.a
                       else e.a || jsonb_build_object('numero', m.numero) end
                  order by e.ord)
           from jsonb_array_elements(l.anexos) with ordinality e(a, ord)
           left join mapa m on m.nome = e.a->>'nome'
       ),
       updated_at = now()
 where jsonb_array_length(coalesce(l.anexos,'[]'::jsonb)) > 0
   and exists (
     select 1 from jsonb_array_elements(l.anexos) a
      join mapa m2 on m2.nome = a->>'nome'
     where coalesce(a->>'numero','') = '');

notify pgrst, 'reload schema';
