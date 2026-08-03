-- 197_folha_chave_pessoa.sql
-- Auditoria 02/08, RH: "Folha sem CPF duplica linhas no reimport".
--
-- A chave é `rh_folha_uk (org_id, competencia, cpf)` e índice único NÃO enxerga
-- NULL: duas linhas com cpf nulo nunca colidem, então o `on conflict` do
-- `rh_importar_folha` não dispara e a mesma pessoa entra de novo a cada
-- importação — inflando bruto, FGTS e, por tabela, o custo/hora do mês.
--
-- Decisão do Rafael (03/08): "vamos forçar ser obrigatório o campo no cadastro,
-- e se não achar, perguntar qual pessoa o registro é referente". Então duas
-- coisas separadas:
--   1. a chave passa a ter fallback pelo NOME normalizado, para o reimport
--      dedupar mesmo sem CPF — é o conserto do bug;
--   2. linha que não casa com ninguém para de virar ficha nova em silêncio e
--      volta como PENDENTE para a tela perguntar.
--
-- Medido antes: 12/12 fichas com CPF e 9/9 linhas da folha 07/2026 com CPF — o
-- conserto é preventivo, nada a corrigir no passado.
--
-- Idempotente.

-- ── Chave de pessoa com fallback ────────────────────────────────────────────
-- Só dígitos do CPF quando houver; senão o nome sem acento, minúsculo e sem
-- espaço duplicado. Coluna gerada para o índice único poder usá-la (expressão
-- com unaccent não é imutável e não indexa).
alter table rh_folha add column if not exists chave_pessoa text;

create or replace function rh_folha_chave(p_cpf text, p_nome text)
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), ''),
    'nome:' || nullif(regexp_replace(btrim(lower(unaccent(coalesce(p_nome, '')))), '\s+', ' ', 'g'), ''),
    'linha-sem-identificacao'
  )
$$;

create or replace function _rh_folha_chave_tg() returns trigger
language plpgsql set search_path = public as $$
begin
  new.chave_pessoa := rh_folha_chave(new.cpf, new.nome);
  return new;
end $$;
drop trigger if exists trg_rh_folha_chave on rh_folha;
create trigger trg_rh_folha_chave before insert or update of cpf, nome on rh_folha
  for each row execute function _rh_folha_chave_tg();

update rh_folha set chave_pessoa = rh_folha_chave(cpf, nome) where chave_pessoa is null;

-- A antiga fica de pé: continua sendo verdade que não pode haver dois CPFs
-- iguais na mesma competência. A nova é a que fecha o buraco do nulo.
create unique index if not exists rh_folha_uk_pessoa on rh_folha (org_id, competencia, chave_pessoa);

-- ── Import: não inventa ficha, pergunta ─────────────────────────────────────
create or replace function rh_importar_folha(
  p_org_id uuid, p_competencia date, p_linhas jsonb, p_auto_criar boolean default true
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  l jsonb; v_cpf text; v_nome text; v_colab uuid; v_id uuid;
  v_criados int := 0; v_casados int := 0; v_linhas int := 0; v_pend jsonb := '[]'::jsonb;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_competencia is null then raise exception 'Competência obrigatória'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_cpf := regexp_replace(coalesce(l->>'cpf',''), '[^0-9]', '', 'g');
    v_nome := nullif(btrim(coalesce(l->>'nome','')), '');
    v_colab := null;

    if v_cpf <> '' then
      select id into v_colab from rh_colaborador
        where org_id = p_org_id and regexp_replace(coalesce(cpf,''),'[^0-9]','','g') = v_cpf
        limit 1;
    end if;

    -- Sem CPF, tenta o nome antes de desistir: é o caso que antes virava ficha
    -- duplicada a cada importação.
    if v_colab is null and v_nome is not null then
      select id into v_colab from rh_colaborador
        where org_id = p_org_id
          and btrim(lower(unaccent(nome))) = btrim(lower(unaccent(v_nome)))
        limit 1;
    end if;

    if v_colab is not null then v_casados := v_casados + 1; end if;

    -- Auto-criar só com CPF. Sem CPF não dá para afirmar que é gente nova — e
    -- errar aqui cria uma segunda ficha da mesma pessoa, que depois contamina
    -- folha, ponto e custo/hora.
    if v_colab is null and p_auto_criar and v_nome is not null and v_cpf <> '' then
      insert into rh_colaborador (org_id, nome, cpf, cargo, tipo_vinculo, data_admissao, salario_atual, status, created_by)
      values (p_org_id, v_nome, nullif(l->>'cpf',''), nullif(l->>'cargo',''),
        rh_vinculo_da_categoria(l->>'categoria'), nullif(l->>'data_admissao','')::date,
        nullif(l->>'salario_base','')::numeric, 'ativo', auth.uid())
      returning id into v_colab;
      v_criados := v_criados + 1;
    end if;

    insert into rh_folha (org_id, colaborador_id, competencia, matricula, nome, cpf, cargo, categoria,
      salario_base, vencimentos, descontos, inss, irrf, fgts, vale_refeicao, faltas, liquido, detalhe, tratamento, created_by)
    values (p_org_id, v_colab, p_competencia, nullif(l->>'matricula',''), v_nome,
      nullif(l->>'cpf',''), nullif(l->>'cargo',''), nullif(l->>'categoria',''),
      nullif(l->>'salario_base','')::numeric, nullif(l->>'vencimentos','')::numeric,
      nullif(l->>'descontos','')::numeric, nullif(l->>'inss','')::numeric, nullif(l->>'irrf','')::numeric,
      nullif(l->>'fgts','')::numeric, nullif(l->>'vale_refeicao','')::numeric, nullif(l->>'faltas','')::numeric,
      nullif(l->>'liquido','')::numeric, l->'detalhe',
      case when l->>'tratamento' in ('salario','socio') then l->>'tratamento' end, auth.uid())
    on conflict (org_id, competencia, chave_pessoa) do update set
      colaborador_id = coalesce(excluded.colaborador_id, rh_folha.colaborador_id),
      matricula = excluded.matricula, nome = excluded.nome, cpf = coalesce(excluded.cpf, rh_folha.cpf),
      cargo = excluded.cargo, categoria = excluded.categoria, salario_base = excluded.salario_base,
      vencimentos = excluded.vencimentos, descontos = excluded.descontos, inss = excluded.inss,
      irrf = excluded.irrf, fgts = excluded.fgts, vale_refeicao = excluded.vale_refeicao,
      faltas = excluded.faltas, liquido = excluded.liquido, detalhe = excluded.detalhe,
      -- Reimportar sem escolha explícita PRESERVA a escolha anterior.
      tratamento = coalesce(excluded.tratamento, rh_folha.tratamento)
    returning id into v_id;
    v_linhas := v_linhas + 1;

    -- Linha que alguém já vinculou à mão numa importação anterior não volta a
    -- perguntar: o vínculo sobrevive ao reimport (o `on conflict` faz coalesce),
    -- e perguntar de novo todo mês é o tipo de ruído que faz ignorar o aviso.
    if v_colab is null then
      select colaborador_id into v_colab from rh_folha where id = v_id;
    end if;

    if v_colab is null then
      v_pend := v_pend || jsonb_build_object(
        'folha_id', v_id, 'nome', v_nome, 'cpf', nullif(l->>'cpf',''),
        'cargo', nullif(l->>'cargo',''), 'liquido', nullif(l->>'liquido','')::numeric);
    end if;

    if v_colab is not null and nullif(l->>'salario_base','') is not null then
      update rh_colaborador set salario_atual = (l->>'salario_base')::numeric, updated_at = now()
        where id = v_colab and salario_atual is distinct from (l->>'salario_base')::numeric;
    end if;
  end loop;

  return jsonb_build_object('linhas', v_linhas, 'criados', v_criados, 'casados', v_casados,
                            'pendentes', v_pend);
end $$;

-- ── "A quem pertence este registro?" ────────────────────────────────────────
create or replace function rh_folha_vincular(p_folha_id uuid, p_colaborador_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare f rh_folha; c rh_colaborador;
begin
  select * into f from rh_folha where id = p_folha_id;
  if f.id is null then raise exception 'Linha da folha não encontrada'; end if;
  if not rh_can(f.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into c from rh_colaborador where id = p_colaborador_id and org_id = f.org_id;
  if c.id is null then raise exception 'Pessoa não encontrada nesta organização'; end if;

  update rh_folha set colaborador_id = c.id where id = p_folha_id;

  -- Aproveita para completar o cadastro: a linha da folha costuma ter o CPF que
  -- falta na ficha, e é ele que faz o próximo import casar sozinho.
  if coalesce(btrim(c.cpf), '') = '' and coalesce(btrim(f.cpf), '') <> '' then
    update rh_colaborador set cpf = f.cpf, updated_at = now() where id = c.id;
  end if;
  if coalesce(f.salario_base, 0) > 0 then
    update rh_colaborador set salario_atual = f.salario_base, updated_at = now()
      where id = c.id and salario_atual is distinct from f.salario_base;
  end if;

  return jsonb_build_object('ok', true, 'colaborador', c.nome,
                            'cpf_preenchido', coalesce(btrim(c.cpf),'') = '' and coalesce(btrim(f.cpf),'') <> '');
end $$;

-- ── CPF obrigatório na ficha ────────────────────────────────────────────────
-- Sem constraint na tabela de propósito: o bootstrap pela folha e as fichas
-- antigas não podem quebrar. A exigência mora onde a pessoa digita.
create or replace function rh_cpf_valido(p_cpf text) returns boolean
language sql immutable as $$
  select length(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g')) = 11
$$;

revoke execute on function rh_importar_folha(uuid, date, jsonb, boolean) from public, anon;
revoke execute on function rh_folha_vincular(uuid, uuid)                  from public, anon;
revoke execute on function rh_folha_chave(text, text)                     from public, anon;
grant  execute on function rh_importar_folha(uuid, date, jsonb, boolean)  to authenticated;
grant  execute on function rh_folha_vincular(uuid, uuid)                  to authenticated;
grant  execute on function rh_folha_chave(text, text)                     to authenticated;
grant  execute on function rh_cpf_valido(text)                            to authenticated;

notify pgrst, 'reload schema';
