-- 387 — a Flávia acrescenta ao cadastro o e-mail novo de veículo/fornecedor (28/10/2026)
--
-- Decisão do Rafael (28/10): NF chegou de notafiscal@massafmcascavel.com.br, fora do
-- cadastro; ela reconheceu a Rádio Massa pelo CNPJ da nota. Esse endereço passa a
-- constar no cadastro. Só SOMA (nunca apaga nem troca), como o link de cotação faz.
-- Rótulo: "Financeiro" quando o cadastro ainda não tem e-mail financeiro (vira o
-- destino dos pedidos de NF/boleto e da cobrança de comissão); senão "Nota fiscal".

create or replace function public.fin_contato_adicionar_email(p_org uuid, p_tipo text, p_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_emails jsonb; v_email text := lower(btrim(coalesce(p_email, ''))); v_rotulo text;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  if p_tipo = 'veiculo' then
    select emails into v_emails from veiculos where id = p_id and org_id = p_org and not archived for update;
  elsif p_tipo = 'fornecedor' then
    select emails into v_emails from fornecedores where id = p_id and org_id = p_org and not archived for update;
  else
    raise exception 'Tipo inválido';
  end if;
  if not found then raise exception 'Contato não encontrado'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v_emails, '[]')) e where lower(btrim(e->>'email')) = v_email) then
    return jsonb_build_object('ok', true, 'ja_tinha', true);
  end if;
  v_rotulo := case when exists (select 1 from jsonb_array_elements(coalesce(v_emails, '[]')) e
                                 where coalesce(e->>'tipo', '') ilike '%financ%') then 'Nota fiscal' else 'Financeiro' end;
  v_emails := coalesce(v_emails, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('tipo', v_rotulo, 'email', v_email));
  if p_tipo = 'veiculo' then update veiculos set emails = v_emails where id = p_id;
  else update fornecedores set emails = v_emails where id = p_id; end if;
  return jsonb_build_object('ok', true, 'rotulo', v_rotulo);
end $$;
revoke execute on function public.fin_contato_adicionar_email(uuid, text, uuid, text) from public, anon;
grant execute on function public.fin_contato_adicionar_email(uuid, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
