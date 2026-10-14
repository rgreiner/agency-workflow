-- Cobrança diária do Financeiro (dias úteis, 10h): o que deixa o saldo envelhecer.
--
-- Três avisos na caixa de entrada de quem cuida do financeiro (can_finance,
-- owner, admin), por conta com OFX:
--   • ofx      — o OFX não foi importado hoje (dia útil);
--   • saldo    — o saldo do Flow não bate com o banco, fora a fila (mig. 348),
--                com o dia em que a diferença começou;
--   • fila     — movimento esperando conciliação há mais de 3 dias.
-- Repete TODO dia útil até resolver: cada rodada apaga o aviso anterior da mesma
-- chave (conta + motivo) e cria o de hoje, para a caixa mostrar só o estado atual
-- em vez de uma pilha de avisos velhos. Resolvido, o aviso some no dia seguinte.

create or replace function cron_financeiro_alertas()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ult_import date; v_real numeric; v_desde date; v_fila int; v_fila_antigo date;
  v_chave text; v_texto text; v_href text; n int := 0; k int;
begin
  if not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  for c in
    select f.id, f.org_id, f.nome, f.saldo_banco, f.saldo_banco_data, o.slug
      from contas_financeiras f join organizations o on o.id = f.org_id
     where coalesce(f.ativo, true)
       and exists (select 1 from ofx_arquivos a where a.conta_id = f.id)
  loop
    -- OFX de hoje
    select max((a.created_at at time zone 'America/Sao_Paulo')::date) into v_ult_import
      from ofx_arquivos a where a.conta_id = c.id;
    v_chave := c.id || ':ofx';
    if v_ult_import < v_hoje then
      v_texto := format('OFX da %s não foi importado hoje (último: %s)', c.nome, to_char(v_ult_import, 'DD/MM'));
      v_href := format('/%s/financeiro/contas/%s', c.slug, c.id);
    else v_texto := null; end if;
    perform _fin_alerta(c.org_id, v_chave, v_texto, v_href); if v_texto is not null then n := n + 1; end if;

    -- Saldo × banco (fora a fila)
    v_texto := null;
    if c.saldo_banco is not null and c.saldo_banco_data is not null then
      select round(fin_saldo_em(c.id, c.saldo_banco_data) - c.saldo_banco
                   + coalesce(sum(case when b.tipo = 'debit' then -abs(b.valor) else abs(b.valor) end), 0), 2)
        into v_real
        from btg_movements b where b.conta_id = c.id and b.status = 'pendente' and b.data_mov <= c.saldo_banco_data;
      if abs(v_real) >= 0.01 then
        v_desde := _fin_desde_divergencia(c.id);
        v_texto := format('Saldo da %s não bate com o banco: R$ %s %s no Flow%s',
          c.nome, to_char(abs(v_real), 'FM999G999G990D00'), case when v_real > 0 then 'a mais' else 'a menos' end,
          case when v_desde is not null then ' desde ' || to_char(v_desde, 'DD/MM') else '' end);
        v_href := format('/%s/financeiro/contas/%s%s', c.slug, c.id, case when v_desde is not null then '#dia-' || v_desde else '' end);
      end if;
    end if;
    perform _fin_alerta(c.org_id, c.id || ':saldo', v_texto, v_href); if v_texto is not null then n := n + 1; end if;

    -- Fila de conciliação parada
    select count(*), min(data_mov) into v_fila, v_fila_antigo
      from btg_movements where conta_id = c.id and status = 'pendente' and data_mov < v_hoje - 3;
    v_texto := null;
    if v_fila > 0 then
      v_texto := format('%s movimento(s) da %s esperando conciliação há mais de 3 dias (o mais antigo de %s)',
        v_fila, c.nome, to_char(v_fila_antigo, 'DD/MM'));
      v_href := format('/%s/financeiro/contas/%s#conciliacao', c.slug, c.id);
    end if;
    perform _fin_alerta(c.org_id, c.id || ':fila', v_texto, v_href); if v_texto is not null then n := n + 1; end if;
  end loop;

  return jsonb_build_object('avisos', n);
end $$;

-- Troca o aviso de uma chave pelo de hoje (ou só apaga, se resolveu: texto null).
create or replace function _fin_alerta(p_org uuid, p_chave text, p_texto text, p_href text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications where org_id = p_org and type = 'financeiro_alerta' and data->>'chave' = p_chave;
  if p_texto is null then return; end if;
  insert into notifications (user_id, org_id, type, actor_id, data)
  select om.user_id, p_org, 'financeiro_alerta', null,
         jsonb_build_object('chave', p_chave, 'texto', p_texto, 'href', p_href)
    from organization_members om
   where om.org_id = p_org and om.arquivado = false
     and (om.can_finance or om.role in ('owner','admin'));
end $$;

revoke execute on function _fin_alerta(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function cron_financeiro_alertas() from public, anon;
grant execute on function cron_financeiro_alertas() to authenticated;

notify pgrst, 'reload schema';
