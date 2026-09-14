-- ── Chat: a janela da conversa é das ÚLTIMAS mensagens, não das primeiras ────
--
-- get_chat_conversation nasceu (mig. 058) com `order by created_at asc limit 300`.
-- ASC + LIMIT devolve as 300 mensagens MAIS ANTIGAS: passado o teto, a conversa
-- congela no começo e TODA mensagem nova fica invisível. Ela é gravada — o envio
-- funciona, o badge de não-lida sobe —, mas nunca volta na leitura; na tela, o
-- balão otimista some no polling de 4s e parece que "não enviou".
--
-- 14/09/2026: Isadora × Danielle bateram 323 mensagens (o único par acima de 300
-- na base) e as 23 últimas sumiram da janela. Elas estão no banco e voltam a
-- aparecer assim que esta função for trocada — nada se perdeu.
--
-- A correção pega as 300 mais RECENTES (desc no subselect) e devolve em ordem
-- cronológica, que é o que a tela espera. Assinatura idêntica: CREATE OR REPLACE
-- sem DROP preserva os grants (PostgREST é estrito com overload — 1 assinatura).
-- O guard `p_user_id = auth.uid()` (mig. 143) continua onde estava.

create or replace function get_chat_conversation(p_user_id uuid, p_other_id uuid, p_org_id uuid)
 returns setof chat_messages language sql security definer set search_path = public as $$
  select * from (
    select * from chat_messages
     where p_user_id = auth.uid() and org_id = p_org_id
       and ((sender_id = p_user_id and recipient_id = p_other_id)
         or (sender_id = p_other_id and recipient_id = p_user_id))
     order by created_at desc
     limit 300
  ) ultimas
  order by created_at asc;
$$;

-- O índice do par já existe (idx_chat_pair, mig. 057) mas com created_at ASC —
-- serve para os dois sentidos da varredura, então não há índice novo a criar.

notify pgrst, 'reload schema';
