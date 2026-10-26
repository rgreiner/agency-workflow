-- 372_cotacao_lembrete_diario.sql
-- Lembrete diário da cotação (26/10/2026): até o prazo, todo dia útil às 9h, quem
-- foi convidado e ainda não respondeu nem recusou recebe o link de novo por e-mail.
-- Pedido do Rafael: "o sistema é novo, a adesão ainda é baixa" — medido: 5 respostas
-- em 40 convites.
--
-- Regras (na função, não no job, para o painel e o cron contarem igual):
--   • só cotação de origem 'link', não encerrada;
--   • prazo: até o dia do prazo (inclusive); sem prazo, até 7 dias depois do envio;
--   • nunca no dia em que o convite saiu, e no máximo 1 por dia;
--   • precisa de e-mail (o do convite ou, se ele foi cadastrado depois, o do cadastro);
--   • o job manda UM lembrete por e-mail e cotação: medido no 1º dia, 4 cadastros de
--     fornecedor diferentes tinham o mesmo e-mail e receberiam 4 iguais.
-- Só o cron executa (is_cron(), mig. 183). Idempotente.

alter table cotacao_convites add column if not exists lembretes int not null default 0;
alter table cotacao_convites add column if not exists lembrete_em timestamptz;

create or replace function cotacao_lembretes_pendentes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cv.id, 'cotacao_id', cv.cotacao_id, 'token', cv.token, 'email', em.email,
      'fornecedor', f.name, 'agencia', o.name, 'titulo', p.titulo,
      'cliente', coalesce(nullif(w.legal_name, ''), w.name), 'comissao', p.bv_pct,
      'prazo', to_char(c.prazo_resposta, 'YYYY-MM-DD'), 'itens', c.itens,
      'ultimo_dia', c.prazo_resposta = v_hoje, 'lembretes', cv.lembretes))
      from cotacao_convites cv
      join cotacoes c on c.id = cv.cotacao_id
      join producao p on p.id = c.producao_id
      join organizations o on o.id = cv.org_id
      join fornecedores f on f.id = cv.fornecedor_id
      left join workspaces w on w.id = p.workspace_id
      cross join lateral (
        select coalesce(nullif(cv.email_para, ''), (
          select e->>'email' from jsonb_array_elements(coalesce(f.emails, '[]'::jsonb)) e
           where (e->>'email') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' limit 1)) as email
      ) em
     where c.origem = 'link' and not c.encerrada and not p.archived
       and cv.respondido_em is null and cv.recusado_em is null
       and em.email is not null
       and (cv.created_at at time zone 'America/Sao_Paulo')::date < v_hoje
       and (cv.lembrete_em is null or (cv.lembrete_em at time zone 'America/Sao_Paulo')::date < v_hoje)
       and case when c.prazo_resposta is not null then c.prazo_resposta >= v_hoje
                else (c.created_at at time zone 'America/Sao_Paulo')::date + 7 >= v_hoje end
  ), '[]'::jsonb);
end $$;

create or replace function cotacao_lembretes_marcar(p_ids uuid[], p_emails text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update cotacao_convites cv
     set lembretes = cv.lembretes + 1, lembrete_em = now(),
         email_para = coalesce(nullif(cv.email_para, ''), x.email)
    from unnest(p_ids, p_emails) as x(id, email)
   where cv.id = x.id;
end $$;

revoke execute on function cotacao_lembretes_pendentes() from public, anon, portal;
grant  execute on function cotacao_lembretes_pendentes() to authenticated;  -- cron vai como authenticated + claim flow_cron
revoke execute on function cotacao_lembretes_marcar(uuid[], text[]) from public, anon, portal;
grant  execute on function cotacao_lembretes_marcar(uuid[], text[]) to authenticated;

notify pgrst, 'reload schema';
