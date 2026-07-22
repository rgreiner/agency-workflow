-- 142_veiculo_inventario.sql
-- Inventário de pontos do veículo (ex.: Rede Outdoor): o catálogo do fornecedor
-- importado do PDF (formato logycware) + KML do MyMaps. Quando a MX escolhe um
-- ponto pelo CÓDIGO, o form puxa endereço, coordenadas, foto e tipo daqui.
--
-- Genérico por veículo e por FORMATO (formato_origem = qual parser gerou), pra
-- outros fornecedores entrarem depois sem mudar o schema. Idempotente.

create table if not exists veiculo_inventario (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references organizations(id) on delete cascade,
  veiculo_id     uuid not null references veiculos(id) on delete cascade,
  codigo         text not null,               -- 0050A, 9018A, PLBRA(01)…
  tipo_midia     text,                        -- Outdoor | Empena | Front-Light | Top Sight | LED…
  cidade         text,
  bairro         text,
  logradouro     text,
  numero         text,
  referencia     text,
  endereco_full  text,                        -- a linha crua do fornecedor (sempre)
  lat            double precision,
  lng            double precision,
  foto_url       text,
  face           text,                        -- A | B | (01) — sentido/face do ponto
  maps_url       text,
  formato_origem text,                        -- parser usado (ex.: 'logycware')
  raw            jsonb not null default '{}'::jsonb,  -- payload bruto p/ depurar/reparsear
  ativo          boolean not null default true,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (veiculo_id, codigo)
);

create index if not exists idx_veiculo_inventario_org on veiculo_inventario(org_id);
create index if not exists idx_veiculo_inventario_veiculo on veiculo_inventario(veiculo_id);

alter table veiculo_inventario enable row level security;

drop policy if exists "Org members read inventario" on veiculo_inventario;
create policy "Org members read inventario" on veiculo_inventario
  for select using (is_org_member(org_id));

drop policy if exists "Manager+ manage inventario" on veiculo_inventario;
create policy "Manager+ manage inventario" on veiculo_inventario
  for all using (org_member_role(org_id) in ('owner','admin','manager'));

drop trigger if exists set_veiculo_inventario_updated_at on veiculo_inventario;
create trigger set_veiculo_inventario_updated_at before update on veiculo_inventario
  for each row execute function set_updated_at();

-- ── Upsert em lote (a tela de import chama com os pontos já parseados) ──
-- A foto sobe ANTES (client → WebP → bucket) e chega como foto_url no ponto.
-- Upsert por (veículo, código): re-importar ATUALIZA, não duplica. Campo ausente
-- no payload não apaga o que já existe (coalesce), então re-import parcial é seguro.
create or replace function upsert_inventario_pontos(
  p_user_id uuid, p_org_id uuid, p_veiculo_id uuid, p_formato text, p_pontos jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p jsonb; v_n int := 0;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  if not exists (select 1 from veiculos where id = p_veiculo_id and org_id = p_org_id) then
    raise exception 'Veículo não encontrado nesta organização';
  end if;

  for v_p in select * from jsonb_array_elements(coalesce(p_pontos, '[]'::jsonb))
  loop
    if nullif(v_p->>'codigo','') is null then continue; end if;
    insert into veiculo_inventario (
      org_id, veiculo_id, codigo, tipo_midia, cidade, bairro, logradouro, numero,
      referencia, endereco_full, lat, lng, foto_url, face, maps_url, formato_origem, raw, created_by
    ) values (
      p_org_id, p_veiculo_id, v_p->>'codigo', nullif(v_p->>'tipo_midia',''),
      nullif(v_p->>'cidade',''), nullif(v_p->>'bairro',''), nullif(v_p->>'logradouro',''),
      nullif(v_p->>'numero',''), nullif(v_p->>'referencia',''), nullif(v_p->>'endereco_full',''),
      nullif(v_p->>'lat','')::double precision, nullif(v_p->>'lng','')::double precision,
      nullif(v_p->>'foto_url',''), nullif(v_p->>'face',''), nullif(v_p->>'maps_url',''),
      p_formato, coalesce(v_p->'raw','{}'::jsonb), p_user_id
    )
    on conflict (veiculo_id, codigo) do update set
      tipo_midia     = coalesce(excluded.tipo_midia, veiculo_inventario.tipo_midia),
      cidade         = coalesce(excluded.cidade, veiculo_inventario.cidade),
      bairro         = coalesce(excluded.bairro, veiculo_inventario.bairro),
      logradouro     = coalesce(excluded.logradouro, veiculo_inventario.logradouro),
      numero         = coalesce(excluded.numero, veiculo_inventario.numero),
      referencia     = coalesce(excluded.referencia, veiculo_inventario.referencia),
      endereco_full  = coalesce(excluded.endereco_full, veiculo_inventario.endereco_full),
      lat            = coalesce(excluded.lat, veiculo_inventario.lat),
      lng            = coalesce(excluded.lng, veiculo_inventario.lng),
      foto_url       = coalesce(excluded.foto_url, veiculo_inventario.foto_url),
      face           = coalesce(excluded.face, veiculo_inventario.face),
      maps_url       = coalesce(excluded.maps_url, veiculo_inventario.maps_url),
      formato_origem = coalesce(excluded.formato_origem, veiculo_inventario.formato_origem),
      raw            = excluded.raw,
      ativo          = true,
      updated_at     = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'processados', v_n);
end; $$;

grant execute on function upsert_inventario_pontos(uuid,uuid,uuid,text,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
