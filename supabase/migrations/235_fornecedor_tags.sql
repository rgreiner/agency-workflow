-- 235_fornecedor_tags.sql
-- Fornecedor tem UM tipo, e isso não descreve quem faz várias coisas: a gráfica que
-- também faz brinde e comunicação visual entra como "Gráfica" e some das outras duas
-- buscas. São 394 cadastros (178 deles sem tipo nenhum) — achar pelo que a empresa
-- FAZ virou o problema real da tela.
--
-- `tags` é lista livre de propósito: o vocabulário da casa aparece sozinho (a tela
-- sugere as tags já usadas na org), sem obrigar cadastro prévio de categoria. `tipo`
-- continua como está — é a categoria principal, e os 216 preenchidos seguem valendo.
--
-- Idempotente.

alter table fornecedores add column if not exists tags text[] not null default '{}';

-- Busca por tag no banco (`tags && array['brindes']`) quando a lista crescer demais
-- pro filtro em memória que a tela faz hoje.
create index if not exists idx_fornecedores_tags on fornecedores using gin (tags);

comment on column fornecedores.tags is
  'Serviços/especialidades do fornecedor, lista livre. Complementa `tipo` (categoria principal) para quem faz mais de uma coisa.';

-- Normaliza a lista que vem da tela: tira espaço das pontas, descarta vazio e
-- preserva a ordem em que a pessoa digitou (dedupe é feito na tela).
create or replace function fin_tags_do_jsonb(p jsonb)
returns text[] language sql immutable as $$
  select coalesce(
    (select array_agg(btrim(t) order by ord)
       from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) with ordinality as x(t, ord)
      where btrim(t) <> ''),
    '{}')
$$;

-- Assinaturas idênticas; só passam a gravar as tags.
create or replace function create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into fornecedores (org_id, name, tipo, tax_id, notes, enderecos, telefones, emails, contas_bancarias, tags, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'tipo',''), nullif(p_data->>'tax_id',''), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb),
    fin_tags_do_jsonb(p_data->'tags'), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id
    where f.id=p_fornecedor_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set
    name=coalesce(nullif(p_data->>'name',''),name), tipo=nullif(p_data->>'tipo',''), tax_id=nullif(p_data->>'tax_id',''), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    -- Só mexe nas tags se vieram no payload: chamada antiga (sem a chave) não apaga.
    tags = case when p_data ? 'tags' then fin_tags_do_jsonb(p_data->'tags') else tags end,
    updated_at=now()
  where id=p_fornecedor_id;
end; $$;

notify pgrst, 'reload schema';
