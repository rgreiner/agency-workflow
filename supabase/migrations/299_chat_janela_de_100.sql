-- ── Chat: a janela cai de 300 para 100 mensagens ────────────────────────────
--
-- A 298 consertou o lado errado da janela (asc + limit devolvia as mais antigas).
-- Agora o tamanho: o polling rebaixa a conversa INTEIRA a cada 4s, por janela
-- aberta — 300 linhas nesse ritmo é peso sem uso, ninguém rola tanto pra trás
-- no meio do expediente. 100 cobre o dia de quem mais conversa aqui.
--
-- Não há perda: as mensagens continuam todas no banco, é só o tamanho da leitura.
-- Mesma assinatura (CREATE OR REPLACE sem DROP preserva os grants).

create or replace function get_chat_conversation(p_user_id uuid, p_other_id uuid, p_org_id uuid)
 returns setof chat_messages language sql security definer set search_path = public as $$
  select * from (
    select * from chat_messages
     where p_user_id = auth.uid() and org_id = p_org_id
       and ((sender_id = p_user_id and recipient_id = p_other_id)
         or (sender_id = p_other_id and recipient_id = p_user_id))
     order by created_at desc
     limit 100
  ) ultimas
  order by created_at asc;
$$;

notify pgrst, 'reload schema';
