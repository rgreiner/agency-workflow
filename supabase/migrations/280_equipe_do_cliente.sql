-- 280_equipe_do_cliente.sql
-- Equipe do cliente (Rafael, 03/09/2026): quem atende cada cliente — ex.: Luka
-- (IMDM, GO ON, Di Napoli), Luiza (Comil, KSBIG, One a One), Lucas (É o Amor,
-- Mel do Malte, Evolua, Opera). Ao abrir uma tarefa do cliente, "Responsáveis" já
-- vem com a equipe e a pessoa ajusta antes de criar. A regra do responsável
-- EXPLÍCITO (mig. 253) continua: muda só o ponto de partida.
--
-- Lista curta (1–3 pessoas) → uuid[] no próprio workspace, lido pela RLS que já
-- existe. Escrita só pela RPC do cadastro (mesma permissão dos outros campos:
-- manager+ / can_finance / can_vendas), e a RPC só aplica a chave quando ela vem
-- no payload — o form de criação de cliente não manda. Só membro ATIVO da org
-- entra no array; quem for arquivado depois sai da SUGESTÃO no app (membrosAtivos),
-- sem precisar sair do array.
-- Idempotente. Mesma assinatura da RPC (PostgREST: 1 assinatura por função).

alter table workspaces
  add column if not exists equipe uuid[] not null default '{}';

create index if not exists workspaces_equipe_gin on workspaces using gin (equipe);

create or replace function public.update_workspace_cadastro(p_user_id uuid, p_workspace_id uuid, p_data jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspaces w join organization_members om on om.org_id = w.org_id
    where w.id = p_workspace_id and om.user_id = p_user_id
      and (om.role in ('owner','admin','manager') or om.can_finance or om.can_vendas)
  ) then raise exception 'Acesso negado'; end if;

  update workspaces set
    name               = coalesce(nullif(p_data->>'name',''), name),
    description        = nullif(p_data->>'description',''),
    color              = coalesce(nullif(p_data->>'color',''), color),
    legal_name         = nullif(p_data->>'legal_name',''),
    trade_name         = nullif(p_data->>'trade_name',''),
    tax_id             = nullif(p_data->>'tax_id',''),
    state_registration = nullif(p_data->>'state_registration',''),
    city_registration  = nullif(p_data->>'city_registration',''),
    finance_email      = nullif(p_data->>'finance_email',''),
    phone              = nullif(p_data->>'phone',''),
    contact_name       = nullif(p_data->>'contact_name',''),
    address_zip        = nullif(p_data->>'address_zip',''),
    address_street     = nullif(p_data->>'address_street',''),
    address_number     = nullif(p_data->>'address_number',''),
    address_complement = nullif(p_data->>'address_complement',''),
    address_district   = nullif(p_data->>'address_district',''),
    address_city       = nullif(p_data->>'address_city',''),
    address_state      = nullif(p_data->>'address_state',''),
    payment_terms      = nullif(p_data->>'payment_terms',''),
    atividade          = nullif(p_data->>'atividade',''),
    -- cobranca_auto agora pela RPC (só aplica se veio no payload)
    cobranca_auto      = case when p_data ? 'cobranca_auto' then (p_data->>'cobranca_auto')::boolean else cobranca_auto end,
    enderecos          = coalesce(p_data->'enderecos', enderecos),
    telefones          = coalesce(p_data->'telefones', telefones),
    emails             = coalesce(p_data->'emails', emails),
    contas_bancarias   = coalesce(p_data->'contas_bancarias', contas_bancarias),
    -- equipe do cliente (mig. 280): só aplica se veio no payload; só membro ativo da org entra
    equipe             = case when p_data ? 'equipe' then coalesce((
                           select array_agg(distinct om.user_id)
                             from jsonb_array_elements_text(p_data->'equipe') x
                             join organization_members om
                               on om.user_id = x::uuid and om.org_id = workspaces.org_id and om.arquivado = false
                         ), '{}'::uuid[]) else equipe end,
    updated_at         = now()
  where id = p_workspace_id;
end; $$;

notify pgrst, 'reload schema';
