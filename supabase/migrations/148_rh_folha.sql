-- 148_rh_folha.sql
-- RH Fase 2: folha de pagamento por competência. Uma linha por trabalhador/mês.
-- A importação casa por CPF com rh_colaborador e, opcionalmente, CRIA quem falta
-- (a folha bootstrapa a ficha). Idempotente; reimportar a mesma competência substitui.

create table if not exists rh_folha (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid references rh_colaborador(id) on delete set null,
  competencia    date not null,               -- 1º dia do mês
  matricula      text,
  nome           text,
  cpf            text,
  cargo          text,
  categoria      text,                          -- 101 empregado | 722 sócio (pró-labore)
  salario_base   numeric,
  vencimentos    numeric,
  descontos      numeric,
  inss           numeric,
  irrf           numeric,
  fgts           numeric,
  vale_refeicao  numeric,
  faltas         numeric,
  liquido        numeric,
  detalhe        jsonb,                         -- linhas de evento cruas (auditoria)
  created_by     uuid,
  created_at     timestamptz not null default now()
);
-- Chave natural: uma linha por CPF por competência na org (reimport substitui).
create unique index if not exists rh_folha_uk on rh_folha (org_id, competencia, cpf);
create index if not exists rh_folha_colab_idx on rh_folha (colaborador_id);

alter table rh_folha enable row level security;
drop policy if exists rh_folha_all on rh_folha;
create policy rh_folha_all on rh_folha for all using (rh_can(org_id)) with check (rh_can(org_id));

-- Deriva o vínculo a partir da categoria da folha.
create or replace function rh_vinculo_da_categoria(p_cat text)
returns text language sql immutable as $$
  select case when p_cat ilike '%722%' or p_cat ilike '%individual%' then 'pj' else 'clt' end;
$$;

-- ── Importa uma competência: casa por CPF, cria quem falta (se p_auto_criar), upserta ──
create or replace function rh_importar_folha(p_org_id uuid, p_competencia date, p_linhas jsonb, p_auto_criar boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  l jsonb; v_cpf text; v_colab uuid; v_criados int := 0; v_casados int := 0; v_linhas int := 0;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_competencia is null then raise exception 'Competência obrigatória'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_cpf := regexp_replace(coalesce(l->>'cpf',''), '[^0-9]', '', 'g');  -- só dígitos p/ casar
    v_colab := null;

    if v_cpf <> '' then
      select id into v_colab from rh_colaborador
        where org_id = p_org_id and regexp_replace(coalesce(cpf,''),'[^0-9]','','g') = v_cpf
        limit 1;
      if v_colab is not null then v_casados := v_casados + 1; end if;
    end if;

    -- Cria a ficha se não existe (a folha bootstrapa o cadastro).
    if v_colab is null and p_auto_criar and coalesce(nullif(l->>'nome',''),'') <> '' then
      insert into rh_colaborador (org_id, nome, cpf, cargo, tipo_vinculo, data_admissao, salario_atual, status, created_by)
      values (p_org_id, l->>'nome', nullif(l->>'cpf',''), nullif(l->>'cargo',''),
        rh_vinculo_da_categoria(l->>'categoria'), nullif(l->>'data_admissao','')::date,
        nullif(l->>'salario_base','')::numeric, 'ativo', auth.uid())
      returning id into v_colab;
      v_criados := v_criados + 1;
    end if;

    insert into rh_folha (org_id, colaborador_id, competencia, matricula, nome, cpf, cargo, categoria,
      salario_base, vencimentos, descontos, inss, irrf, fgts, vale_refeicao, faltas, liquido, detalhe, created_by)
    values (p_org_id, v_colab, p_competencia, nullif(l->>'matricula',''), nullif(l->>'nome',''),
      nullif(l->>'cpf',''), nullif(l->>'cargo',''), nullif(l->>'categoria',''),
      nullif(l->>'salario_base','')::numeric, nullif(l->>'vencimentos','')::numeric,
      nullif(l->>'descontos','')::numeric, nullif(l->>'inss','')::numeric, nullif(l->>'irrf','')::numeric,
      nullif(l->>'fgts','')::numeric, nullif(l->>'vale_refeicao','')::numeric, nullif(l->>'faltas','')::numeric,
      nullif(l->>'liquido','')::numeric, l->'detalhe', auth.uid())
    on conflict (org_id, competencia, cpf) do update set
      colaborador_id = excluded.colaborador_id, matricula = excluded.matricula, nome = excluded.nome,
      cargo = excluded.cargo, categoria = excluded.categoria, salario_base = excluded.salario_base,
      vencimentos = excluded.vencimentos, descontos = excluded.descontos, inss = excluded.inss,
      irrf = excluded.irrf, fgts = excluded.fgts, vale_refeicao = excluded.vale_refeicao,
      faltas = excluded.faltas, liquido = excluded.liquido, detalhe = excluded.detalhe;
    v_linhas := v_linhas + 1;

    -- Mantém o salário atual da ficha em dia com a folha.
    if v_colab is not null and nullif(l->>'salario_base','') is not null then
      update rh_colaborador set salario_atual = (l->>'salario_base')::numeric, updated_at = now()
        where id = v_colab and salario_atual is distinct from (l->>'salario_base')::numeric;
    end if;
  end loop;

  return jsonb_build_object('linhas', v_linhas, 'criados', v_criados, 'casados', v_casados);
end; $$;

revoke execute on function rh_importar_folha(uuid,date,jsonb,boolean) from public;
grant execute on function rh_importar_folha(uuid,date,jsonb,boolean) to authenticated;

notify pgrst, 'reload schema';
