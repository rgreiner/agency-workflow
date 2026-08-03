-- 200_rh_documento_envio.sql
-- Auditoria 02/08, RH: "Holerite e documentos nunca chegam à própria pessoa".
-- A RLS de `rh_documento` é só do RH; o colaborador não vê o próprio holerite.
--
-- Decisão do Rafael (03/08): "criamos um mecanismo para a pessoa cadastrar seu
-- e-mail pessoal, por segurança não podemos remover o acesso nem mudar a senha
-- desse — aí ela recebe através desse e-mail".
--
-- É a MESMA razão do OTP da assinatura: o corporativo está sob controle do
-- admin, que reseta senha e administra a caixa. O canal só é da pessoa se o
-- empregador não alcança. Por isso o envio exige e-mail pessoal VERIFICADO — não
-- basta estar digitado na ficha.
--
-- ⚠️ Medido em 03/08: 0 de 12 pessoas com e-mail pessoal cadastrado. Ou seja,
-- hoje este caminho não entrega nada — e a assinatura do espelho está parada
-- pelo mesmo motivo, já que o OTP vai para lá. Cadastrar é o primeiro dominó.
--
-- Idempotente.

create table if not exists rh_documento_envio (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  documento_id   uuid references rh_documento(id) on delete set null,
  colaborador_id uuid references rh_colaborador(id) on delete set null,
  destino        text not null,
  tipo           text,
  nome           text,
  enviado_em     timestamptz not null default now(),
  enviado_por    uuid,
  erro           text
);
create index if not exists rh_documento_envio_doc_idx on rh_documento_envio (documento_id);
alter table rh_documento_envio enable row level security;
drop policy if exists rh_documento_envio_rh on rh_documento_envio;
create policy rh_documento_envio_rh on rh_documento_envio for select using (rh_can(org_id));

-- Dados para o envio: o RH não lê o e-mail pessoal por SELECT direto na tela
-- (é dado pessoal fora do escopo do trabalho), então vem por aqui, junto do que
-- o servidor precisa para montar o anexo.
create or replace function rh_documento_para_envio(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d rh_documento; c rh_colaborador;
begin
  select * into d from rh_documento where id = p_id;
  if d.id is null then raise exception 'Documento não encontrado'; end if;
  if not rh_can(d.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into c from rh_colaborador where id = d.colaborador_id;
  if c.id is null then raise exception 'Documento sem pessoa vinculada'; end if;

  return jsonb_build_object(
    'documento_id', d.id, 'org_id', d.org_id, 'colaborador_id', c.id,
    'tipo', d.tipo, 'nome', d.nome, 'chave', d.chave, 'competencia', d.competencia,
    'pessoa', c.nome,
    'email_pessoal', c.email_pessoal,
    -- Sem verificação não sai: e-mail digitado por outra pessoa na ficha não é
    -- canal da pessoa, é canal de quem digitou.
    'verificado', c.email_pessoal_verificado_em is not null
  );
end $$;

create or replace function rh_registrar_envio_documento(
  p_documento_id uuid, p_destino text, p_erro text default null
) returns void language plpgsql security definer set search_path to 'public' as $$
declare d rh_documento;
begin
  select * into d from rh_documento where id = p_documento_id;
  if d.id is null then raise exception 'Documento não encontrado'; end if;
  if not rh_can(d.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into rh_documento_envio (org_id, documento_id, colaborador_id, destino, tipo, nome, enviado_por, erro)
  values (d.org_id, d.id, d.colaborador_id, p_destino, d.tipo, d.nome, auth.uid(), nullif(btrim(coalesce(p_erro,'')), ''));
end $$;

-- Quantas vezes cada documento já foi enviado (a tela mostra "enviado em …").
create or replace function rh_envios_do_colaborador(p_colaborador_id uuid)
returns table(documento_id uuid, enviado_em timestamptz, destino text, erro text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null or not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  select distinct on (e.documento_id) e.documento_id, e.enviado_em, e.destino, e.erro
    from rh_documento_envio e
   where e.colaborador_id = p_colaborador_id
   order by e.documento_id, e.enviado_em desc;
end $$;

revoke execute on function rh_documento_para_envio(uuid)               from public, anon;
revoke execute on function rh_registrar_envio_documento(uuid, text, text) from public, anon;
revoke execute on function rh_envios_do_colaborador(uuid)              from public, anon;
grant  execute on function rh_documento_para_envio(uuid)               to authenticated;
grant  execute on function rh_registrar_envio_documento(uuid, text, text) to authenticated;
grant  execute on function rh_envios_do_colaborador(uuid)              to authenticated;

notify pgrst, 'reload schema';
