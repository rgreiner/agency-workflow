-- Pix copia-e-cola na régua de cobrança.
--
-- A régua manda "como pagar" em texto livre (org_settings.payment_info). Texto
-- obriga o cliente a digitar valor e chave à mão — é onde o pagamento trava e
-- onde nasce diferença de centavos. Com a chave cadastrada aqui, o Flow monta o
-- BR Code com o VALOR DO TÍTULO e o cliente só cola no app do banco.
--
-- Não é integração bancária: o BR Code estático é um payload do Banco Central
-- montado offline (lib/pix/brcode.ts). Não custa plano, não registra cobrança e
-- não avisa a baixa — a baixa continua vindo da conciliação do extrato.

alter table org_settings add column if not exists pix_chave  text;
alter table org_settings add column if not exists pix_nome   text;
alter table org_settings add column if not exists pix_cidade text;

comment on column org_settings.pix_chave  is 'Chave Pix do recebedor (CNPJ, e-mail, telefone ou aleatória). Vazio = régua manda só o payment_info em texto.';
comment on column org_settings.pix_nome   is 'Nome do recebedor no BR Code (até 25 caracteres, sem acento).';
comment on column org_settings.pix_cidade is 'Cidade do recebedor no BR Code (até 15 caracteres, sem acento).';

-- Grava pela mesma RPC do payment_info (a tela é a mesma, e org_settings só tem
-- policy de SELECT: update direto some em silêncio). DROP + CREATE porque o
-- PostgREST não aceita overload — 1 assinatura por RPC.
--
-- As guardas abaixo são as da função que já estava no ar e NÃO podem afrouxar:
-- o confronto com auth.uid() fecha o bypass por p_user_id (auditoria 22/07), e o
-- can_finance/owner/admin é o recorte de quem mexe em dado financeiro.
drop function if exists set_org_payment_info(uuid, uuid, text);

create or replace function set_org_payment_info(
  p_user_id uuid, p_org_id uuid, p_info text,
  p_pix_chave text default null, p_pix_nome text default null, p_pix_cidade text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))) then raise exception 'Acesso negado'; end if;

  update org_settings set
    payment_info = nullif(p_info, ''),
    pix_chave    = nullif(btrim(coalesce(p_pix_chave, '')), ''),
    pix_nome     = nullif(btrim(coalesce(p_pix_nome, '')), ''),
    pix_cidade   = nullif(btrim(coalesce(p_pix_cidade, '')), '')
  where org_id = p_org_id;

  if not found then
    insert into org_settings (org_id, payment_info, pix_chave, pix_nome, pix_cidade)
    values (p_org_id, nullif(p_info, ''),
            nullif(btrim(coalesce(p_pix_chave, '')), ''),
            nullif(btrim(coalesce(p_pix_nome, '')), ''),
            nullif(btrim(coalesce(p_pix_cidade, '')), ''));
  end if;
end $$;

-- Toda função nova nasce chamável por anon/authenticated por DEFAULT PRIVILEGES
-- neste banco; revogar de PUBLIC não toca nesses dois.
revoke execute on function set_org_payment_info(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function set_org_payment_info(uuid, uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
