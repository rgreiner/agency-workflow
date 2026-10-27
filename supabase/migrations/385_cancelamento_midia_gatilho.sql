-- 385 — Cancelar MX já faturada/lançada avisa a Flávia, por qualquer caminho.
--
-- Regra do Rafael (27/10/2026): "se já tiver um faturamento, cobrança ou lançamento
-- faturado associado precisa avisar a Flávia do financeiro"; o aviso vai só para
-- veículos e fornecedores (a ordem de cancelar já vem do cliente).
--
-- A situação muda por mais de um caminho (seletor da lista = set_midia_situacao,
-- salvar do form = update_midia), então a regra mora num GATILHO:
--  · MX vira 'cancelado' vindo de faturar/faturado, ou com lançamento → registra
--    em documento_cancelamentos (a Flávia lê e avisa o veículo);
--  · lançamento sem movimento sai (sem estornar: a MX fica Cancelada);
--  · lançamento JÁ movimentado (recebido, baixa parcial, conciliado, NFS-e emitida)
--    FICA, e o registro sai marcado `lancamentos_mantidos` — dinheiro que entrou ou
--    nota emitida é decisão do Rafael, não do gatilho.

alter table public.documento_cancelamentos
  add column if not exists lancamentos_mantidos boolean not null default false,
  add column if not exists motivo_mantidos text,
  add column if not exists situacao_anterior text;

-- O que impede apagar um lançamento: as travas da exclusão + NFS-e emitida para ele.
create or replace function public._lancamento_bloqueio_cancelamento(p_id uuid)
returns text
language sql stable set search_path to 'public' as $$
  select coalesce(
    _lancamento_bloqueio_exclusao(p_id),
    (select 'NFS-e de comissão emitida para este lançamento.' from nota_fiscal n
      where n.lancamento_id = p_id and coalesce(n.status, '') not in ('cancelada', 'rejeitada', 'erro') limit 1)
  );
$$;
revoke execute on function public._lancamento_bloqueio_cancelamento(uuid) from public, anon, authenticated;

-- Núcleo (mesma assinatura da 384): agora nunca recusa — registra sempre e só apaga
-- o que pode ser apagado. Sem lançamento (MX só na fila do Faturamento), o registro
-- vai para o veículo da MX.
create or replace function public._doc_cancelar_lancamentos(p_origem_tipo text, p_origem_id uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_bloq text; v_n int := 0; v_org uuid; v_doc text; v_titulo text; v_cliente text;
        v_veic uuid; v_veic_nome text; v_sit text; v_tem int;
begin
  if p_origem_tipo = 'midia' then
    select m.org_id, nullif(btrim(coalesce(m.serie, 'MX') || ' ' || coalesce(m.numero::text, '')), ''), m.titulo, w.name,
           m.veiculo_id, ve.name, m.situacao
      into v_org, v_doc, v_titulo, v_cliente, v_veic, v_veic_nome, v_sit
      from midias m left join workspaces w on w.id = m.workspace_id left join veiculos ve on ve.id = m.veiculo_id
     where m.id = p_origem_id;
  else
    select p.org_id, nullif(btrim(coalesce(p.serie, 'PP') || ' ' || coalesce(p.numero::text, '')), ''), p.titulo, w.name, p.situacao
      into v_org, v_doc, v_titulo, v_cliente, v_sit
      from producao p left join workspaces w on w.id = p.workspace_id where p.id = p_origem_id;
  end if;
  if v_org is null then raise exception 'Documento não encontrado'; end if;

  select count(*) into v_tem from lancamentos l
   where l.org_id = v_org and l.origem_tipo = p_origem_tipo and l.origem_id = p_origem_id;

  select string_agg(distinct b, ' ') into v_bloq from (
    select _lancamento_bloqueio_cancelamento(l.id) b from lancamentos l
     where l.org_id = v_org and l.origem_tipo = p_origem_tipo and l.origem_id = p_origem_id
  ) t where b is not null;

  if v_tem > 0 then
    insert into documento_cancelamentos
      (org_id, origem_tipo, origem_id, documento, titulo, cliente, contato_tipo, contato_id, contato_nome, valor, lancamentos,
       cancelado_por, lancamentos_mantidos, motivo_mantidos, situacao_anterior)
    select v_org, p_origem_tipo, p_origem_id, v_doc, v_titulo, v_cliente,
           l.contato_tipo, l.contato_id, max(l.contato_nome), sum(l.valor),
           jsonb_agg(jsonb_build_object('id', l.id, 'descricao', l.descricao, 'valor', l.valor, 'vencimento', l.vencimento,
                                        'competencia', l.competencia, 'origem_parte', l.origem_parte, 'tipo', l.tipo,
                                        'situacao', l.situacao) order by l.vencimento),
           p_user, v_bloq is not null, v_bloq, v_sit
      from lancamentos l
     where l.org_id = v_org and l.origem_tipo = p_origem_tipo and l.origem_id = p_origem_id
     group by l.contato_tipo, l.contato_id
    on conflict do nothing;
  elsif v_veic is not null then
    insert into documento_cancelamentos
      (org_id, origem_tipo, origem_id, documento, titulo, cliente, contato_tipo, contato_id, contato_nome, cancelado_por, situacao_anterior)
    values (v_org, p_origem_tipo, p_origem_id, v_doc, v_titulo, v_cliente, 'veiculo', v_veic, v_veic_nome, p_user, v_sit)
    on conflict do nothing;
  end if;

  if v_bloq is null and v_tem > 0 then
    delete from lancamentos
     where org_id = v_org and origem_tipo = p_origem_tipo and origem_id = p_origem_id;
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('ok', true, 'documento', v_doc, 'removidos', v_n, 'mantidos', v_bloq is not null, 'motivo', v_bloq);
end $$;
revoke execute on function public._doc_cancelar_lancamentos(text, uuid, uuid) from public, anon, authenticated;

-- ── Gatilho: qualquer caminho que leve a MX a Cancelado ───────────────────────
create or replace function public.trg_midia_cancelada()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.situacao = 'cancelado' and old.situacao is distinct from 'cancelado'
     and (old.situacao in ('faturar', 'faturado')
          or exists (select 1 from lancamentos l where l.origem_tipo = 'midia' and l.origem_id = new.id)) then
    perform _doc_cancelar_lancamentos('midia', new.id, auth.uid());
    -- O núcleo lê a MX já Cancelada (gatilho AFTER): a situação de antes vem do OLD.
    update documento_cancelamentos set situacao_anterior = old.situacao
     where origem_tipo = 'midia' and origem_id = new.id and situacao_anterior = 'cancelado';
  end if;
  return new;
end $$;
revoke execute on function public.trg_midia_cancelada() from public, anon, authenticated;

drop trigger if exists trg_midia_cancelada on public.midias;
create trigger trg_midia_cancelada after update of situacao on public.midias
  for each row execute function public.trg_midia_cancelada();

-- A 384 fazia o trabalho aqui; agora é do gatilho (não registra duas vezes).
create or replace function public.cancelar_documento_midia(p_user_id uuid, p_midia_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias m join organization_members om on om.org_id = m.org_id
     where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = 'cancelado', updated_at = now() where id = p_midia_id;
  return jsonb_build_object('ok', true);
end $$;

-- ── O que o cancelamento vai fazer (para a tela confirmar antes) ──────────────
create or replace function public.impacto_cancelar_midia(p_user_id uuid, p_midia_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid; v_sit text; v_n int; v_valor numeric; v_mov int; v_veic text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select m.org_id, m.situacao, ve.name into v_org, v_sit, v_veic
    from midias m left join veiculos ve on ve.id = m.veiculo_id where m.id = p_midia_id;
  if v_org is null or not exists (
    select 1 from organization_members om where om.org_id = v_org and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  select count(*), coalesce(sum(valor), 0), count(*) filter (where _lancamento_bloqueio_cancelamento(id) is not null)
    into v_n, v_valor, v_mov
    from lancamentos where origem_tipo = 'midia' and origem_id = p_midia_id;
  return jsonb_build_object(
    'faturada', v_sit in ('faturar', 'faturado'), 'lancamentos', v_n, 'valor', round(v_valor, 2),
    'movimentados', v_mov, 'veiculo', v_veic,
    'avisa_financeiro', v_sit in ('faturar', 'faturado') or v_n > 0);
end $$;
revoke execute on function public.impacto_cancelar_midia(uuid, uuid) from public, anon;
grant execute on function public.impacto_cancelar_midia(uuid, uuid) to authenticated;

-- ── Flávia: a lista passa a dizer quando o lançamento ficou (decisão do Rafael) ─
create or replace function public.fin_cancelamentos_avisar(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.contato, t.documento), '[]'::jsonb) into v from (
    select c.id, c.origem_tipo, c.documento, c.titulo, c.cliente, c.contato_tipo, c.contato_id,
           coalesce(f.name, ve.name, c.contato_nome) as contato,
           k->>'nome' as contato_nome, k->>'email' as email, k->>'telefone' as telefone,
           c.valor::float8 as valor, c.lancamentos, c.cancelado_em,
           c.lancamentos_mantidos, c.motivo_mantidos, c.situacao_anterior,
           c.aviso_email_em is not null as email_feito, c.aviso_whats_em is not null as whats_feito
      from documento_cancelamentos c
      left join fornecedores f on c.contato_tipo = 'fornecedor' and f.id = c.contato_id
      left join veiculos ve    on c.contato_tipo = 'veiculo'    and ve.id = c.contato_id
      cross join lateral (select _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as k) kk
     where c.org_id = p_org and not c.aviso_dispensado
       and c.contato_tipo in ('veiculo', 'fornecedor')
       and ((c.aviso_email_em is null and k->>'email' is not null)
         or (c.aviso_whats_em is null and k->>'telefone' is not null))
  ) t;
  return v;
end $$;

notify pgrst, 'reload schema';
