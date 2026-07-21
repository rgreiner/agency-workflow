-- 136_serie_simplificada.sql
-- Mídia Simplificada vira categoria própria, com a série que ela sempre teve.
--
-- O histórico importado do Siga não deixa dúvida sobre o que é cada série:
--   MS 830 | Facebook  | ... Meta Ads | Junho     → Google/Meta = Simplificada
--   MS 823 | Google    | ... Google Ads | Maio
--   MD 146 | CGN       | portal CGN               → portais = Digital
--   MD 141 | CGN       | SF Empreendimentos
-- São 59 documentos MS e 14 MD no histórico.
--
-- Mas `serie_de_midia` mapeava `digital → MS` (com MD só se viesse série
-- explícita no formulário). Ou seja: uma mídia de PORTAL criada sem escolher a
-- série queimava número da sequência de Google/Meta. Numeração é sequencial e
-- continua a do Siga — número queimado por engano não volta.
--
-- Decisão do Rafael (21/07/2026): Simplificada é categoria própria (tipo
-- 'simplificada' → MS) e Digital passa a ser só portais (→ MD, sem escolher).
--
-- Sem risco de dado: nenhuma mídia com tipo 'digital' foi criada até aqui
-- (a única existente é 'externa'/MX), então nada precisa ser renumerado.
-- Idempotente.

create or replace function serie_de_midia(p_tipo text, p_serie text default null)
returns text language sql immutable as $$
  select case
    when p_tipo = 'externa'          then 'MX'
    when p_tipo = 'eletronica'       then 'ME'
    when p_tipo like 'impressa%'     then 'MI'
    when p_tipo = 'simplificada'     then 'MS'   -- Google, Meta, carro de som
    when p_tipo = 'digital'          then 'MD'   -- CGN e demais portais
    else nullif(p_serie,'')  -- 'outros'/sem tipo: só se vier série explícita
  end;
$$;

grant execute on function serie_de_midia(text, text) to anon, authenticated;

-- A série MS já existe em doc_series (próximo 831) porque veio do Siga; MD idem
-- (próximo 147). Nada a criar — só o mapeamento estava trocado.

notify pgrst, 'reload schema';
