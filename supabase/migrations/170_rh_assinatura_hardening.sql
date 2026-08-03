-- 170_rh_assinatura_hardening.sql
-- Endurece a coleta da assinatura, sem depender de terceiros.
--
-- FURO QUE ISTO FECHA: a assinatura provava só "quem sabe a senha". Como o admin
-- reseta a senha de qualquer membro (tela de Membros) E controla o e-mail
-- corporativo (Workspace), ele podia assinar no lugar da pessoa — e nada no
-- registro distinguia isso de uma assinatura legítima. Some-se a isso que
-- rh_assinatura aceitava UPDATE/DELETE: "não mudamos" era prática, não garantia.
--
--  1) OTP no E-MAIL PESSOAL (fora do domínio da empresa) = 2º fator real.
--  2) Cadeia de hash entre assinaturas: apagar/reordenar linha fica DETECTÁVEL.
--  3) Tabelas de prova viram append-only por TRIGGER (nem o app muda).
--  4) Reset de senha fica registrado e é exibido junto da assinatura.
--  6) Ciência por divergência: a pessoa dá ciência OU pede explicação, dia a dia.
-- Idempotente.

create extension if not exists pgcrypto;

-- ── 1) E-mail pessoal (2º fator precisa estar FORA do controle do empregador) ──
alter table rh_colaborador add column if not exists email_pessoal text;
alter table rh_colaborador add column if not exists email_pessoal_verificado_em timestamptz;

create table if not exists rh_otp (
  id             uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  finalidade     text not null,                  -- verificar_email | assinar_espelho | assinar_termo
  codigo_hash    text not null,                  -- sha256 do código (nunca o código puro)
  destino        text not null,                  -- e-mail para onde foi
  expira_em      timestamptz not null,
  tentativas     int not null default 0,
  usado_em       timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists rh_otp_colab_idx on rh_otp (colaborador_id, finalidade, expira_em desc);
alter table rh_otp enable row level security;
drop policy if exists rh_otp_rw on rh_otp;
create policy rh_otp_rw on rh_otp for all using (rh_is_self(colaborador_id)) with check (rh_is_self(colaborador_id));

-- Gera o OTP (o código puro só existe no processo que o envia).
create or replace function rh_otp_criar(p_colaborador_id uuid, p_finalidade text, p_codigo text, p_destino text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_is_self(p_colaborador_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Invalida os anteriores da mesma finalidade (só um código vivo por vez).
  update rh_otp set usado_em = now()
   where colaborador_id = p_colaborador_id and finalidade = p_finalidade and usado_em is null;
  insert into rh_otp (colaborador_id, finalidade, codigo_hash, destino, expira_em)
  values (p_colaborador_id, p_finalidade, encode(digest(p_codigo, 'sha256'), 'hex'), p_destino,
          now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function rh_otp_criar(uuid, text, text, text) from public;
grant execute on function rh_otp_criar(uuid, text, text, text) to authenticated;

-- Confere e QUEIMA o código (uso único). Máx. 5 tentativas.
create or replace function rh_otp_validar(p_colaborador_id uuid, p_finalidade text, p_codigo text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare o rh_otp;
begin
  if not rh_is_self(p_colaborador_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into o from rh_otp
   where colaborador_id = p_colaborador_id and finalidade = p_finalidade and usado_em is null
   order by created_at desc limit 1;
  if o.id is null then raise exception 'Nenhum código pendente. Peça um novo.'; end if;
  if o.expira_em < now() then raise exception 'Código expirado. Peça um novo.'; end if;
  if o.tentativas >= 5 then
    update rh_otp set usado_em = now() where id = o.id;
    raise exception 'Muitas tentativas. Peça um novo código.';
  end if;

  if o.codigo_hash <> encode(digest(p_codigo, 'sha256'), 'hex') then
    update rh_otp set tentativas = tentativas + 1 where id = o.id;
    return false;
  end if;
  update rh_otp set usado_em = now() where id = o.id;
  return true;
end; $$;
revoke execute on function rh_otp_validar(uuid, text, text) from public;
grant execute on function rh_otp_validar(uuid, text, text) to authenticated;

-- Confirma o e-mail pessoal (só o próprio, após validar o OTP na action).
create or replace function rh_confirmar_email_pessoal(p_colaborador_id uuid, p_email text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_is_self(p_colaborador_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_colaborador set email_pessoal = lower(btrim(p_email)),
         email_pessoal_verificado_em = now(), updated_at = now()
   where id = p_colaborador_id;
end; $$;
revoke execute on function rh_confirmar_email_pessoal(uuid, text) from public;
grant execute on function rh_confirmar_email_pessoal(uuid, text) to authenticated;

-- ── 2) Cadeia de hash: cada assinatura amarra na anterior da org ──
alter table rh_assinatura add column if not exists seq           bigint;
alter table rh_assinatura add column if not exists hash_anterior text;
alter table rh_assinatura add column if not exists hash_cadeia   text;
alter table rh_assinatura add column if not exists otp_id        uuid references rh_otp(id);

create or replace function rh_assinatura_encadear() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_ant rh_assinatura;
begin
  select * into v_ant from rh_assinatura where org_id = new.org_id order by seq desc nulls last limit 1;
  new.seq := coalesce(v_ant.seq, 0) + 1;
  new.hash_anterior := v_ant.hash_cadeia;   -- null só no primeiro elo
  new.hash_cadeia := encode(digest(
    coalesce(new.hash_anterior, '') || '|' || new.seq::text || '|' || new.hash || '|' ||
    new.colaborador_id::text || '|' || coalesce(new.competencia::text, '') || '|' ||
    new.papel || '|' || new.assinado_por::text || '|' || new.assinado_em::text, 'sha256'), 'hex');
  return new;
end; $$;
drop trigger if exists rh_assinatura_encadear_tg on rh_assinatura;
create trigger rh_assinatura_encadear_tg before insert on rh_assinatura
  for each row execute function rh_assinatura_encadear();

-- Confere a cadeia inteira: devolve os elos rompidos (vazio = íntegra).
create or replace function rh_assinatura_verificar_cadeia(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r record; v_ant text := null; v_calc text; v_erros jsonb := '[]'::jsonb;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  for r in select * from rh_assinatura where org_id = p_org_id order by seq loop
    v_calc := encode(digest(
      coalesce(v_ant, '') || '|' || r.seq::text || '|' || r.hash || '|' ||
      r.colaborador_id::text || '|' || coalesce(r.competencia::text, '') || '|' ||
      r.papel || '|' || r.assinado_por::text || '|' || r.assinado_em::text, 'sha256'), 'hex');
    if r.hash_cadeia is distinct from v_calc or r.hash_anterior is distinct from v_ant then
      v_erros := v_erros || jsonb_build_object('seq', r.seq, 'id', r.id, 'motivo',
        case when r.hash_anterior is distinct from v_ant then 'elo anterior não confere (linha removida ou reordenada)'
             else 'conteúdo alterado após a assinatura' end);
    end if;
    v_ant := r.hash_cadeia;
  end loop;
  return jsonb_build_object('total', (select count(*) from rh_assinatura where org_id = p_org_id),
                            'integra', jsonb_array_length(v_erros) = 0, 'erros', v_erros);
end; $$;
revoke execute on function rh_assinatura_verificar_cadeia(uuid) from public;
grant execute on function rh_assinatura_verificar_cadeia(uuid) to authenticated;

-- ── 3) Append-only por TRIGGER: nem o app pode reescrever a prova ──
-- Em rh_assinatura só a INVALIDAÇÃO é permitida (e uma vez só).
create or replace function rh_assinatura_imutavel() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Assinatura não pode ser excluída (registro de prova).';
  end if;
  if old.invalidada_em is not null then
    raise exception 'Assinatura já invalidada não pode ser alterada.';
  end if;
  if new.hash is distinct from old.hash or new.hash_cadeia is distinct from old.hash_cadeia
     or new.conteudo is distinct from old.conteudo or new.assinado_por is distinct from old.assinado_por
     or new.assinado_em is distinct from old.assinado_em or new.seq is distinct from old.seq
     or new.colaborador_id is distinct from old.colaborador_id or new.papel is distinct from old.papel
     or new.ip is distinct from old.ip or new.user_agent is distinct from old.user_agent then
    raise exception 'Assinatura é imutável: só a invalidação (reabertura do ciclo) é permitida.';
  end if;
  return new;
end; $$;
drop trigger if exists rh_assinatura_imutavel_tg on rh_assinatura;
create trigger rh_assinatura_imutavel_tg before update or delete on rh_assinatura
  for each row execute function rh_assinatura_imutavel();

-- Log de ponto e OTP são append-only puros.
create or replace function rh_append_only() returns trigger
language plpgsql set search_path to 'public' as $$
begin raise exception 'Registro de auditoria não pode ser alterado nem excluído.'; end; $$;
drop trigger if exists rh_ponto_log_imutavel_tg on rh_ponto_log;
create trigger rh_ponto_log_imutavel_tg before update or delete on rh_ponto_log
  for each row execute function rh_append_only();

-- ── 4) Reset de senha registrado (vetor de personificação fica visível) ──
create table if not exists rh_evento_seguranca (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade,
  user_id    uuid not null,               -- usuário afetado
  tipo       text not null,               -- reset_senha_admin | reset_senha_self
  por        uuid,                        -- quem executou
  detalhe    text,
  em         timestamptz not null default now()
);
create index if not exists rh_evento_seg_idx on rh_evento_seguranca (user_id, em desc);
alter table rh_evento_seguranca enable row level security;
drop policy if exists rh_evento_seg_ro on rh_evento_seguranca;
create policy rh_evento_seg_ro on rh_evento_seguranca for select
  using (org_id is null or rh_can(org_id) or user_id = auth.uid());
drop trigger if exists rh_evento_seg_imutavel_tg on rh_evento_seguranca;
create trigger rh_evento_seg_imutavel_tg before update or delete on rh_evento_seguranca
  for each row execute function rh_append_only();

create or replace function rh_registrar_evento_seguranca(p_org_id uuid, p_user_id uuid, p_tipo text, p_detalhe text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into rh_evento_seguranca (org_id, user_id, tipo, por, detalhe)
  values (p_org_id, p_user_id, p_tipo, auth.uid(), p_detalhe);
end; $$;
revoke execute on function rh_registrar_evento_seguranca(uuid, uuid, text, text) from public;
grant execute on function rh_registrar_evento_seguranca(uuid, uuid, text, text) to authenticated;

-- ── 6) Ciência por divergência: ciente OU pedido de explicação, dia a dia ──
create table if not exists rh_ciencia (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  competencia    date not null,
  data           date not null,
  divergencia    text not null,              -- ajustado | intervalo_curto | sem_marcacao | extra_pendente
  decisao        text not null,              -- ciente | explicacao
  texto          text,                       -- o que a pessoa escreveu ao pedir explicação
  resposta       text,                       -- resposta do RH
  respondido_por uuid, respondido_em timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists rh_ciencia_uk on rh_ciencia (colaborador_id, data, divergencia);
alter table rh_ciencia enable row level security;
drop policy if exists rh_ciencia_rw on rh_ciencia;
create policy rh_ciencia_rw on rh_ciencia for all
  using (rh_can(org_id) or rh_is_self(colaborador_id))
  with check (rh_can(org_id) or rh_is_self(colaborador_id));

create or replace function rh_dar_ciencia(
  p_colaborador_id uuid, p_competencia date, p_data date, p_divergencia text, p_decisao text, p_texto text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if not rh_is_self(p_colaborador_id) then
    raise exception 'Só o próprio colaborador dá ciência' using errcode = '42501';
  end if;
  if p_decisao not in ('ciente','explicacao') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'explicacao' and coalesce(btrim(p_texto),'') = '' then
    raise exception 'Descreva o que precisa ser explicado';
  end if;
  insert into rh_ciencia (org_id, colaborador_id, competencia, data, divergencia, decisao, texto)
  values (v_org, p_colaborador_id, p_competencia, p_data, p_divergencia, p_decisao, nullif(btrim(p_texto),''))
  on conflict (colaborador_id, data, divergencia) do update
    set decisao = excluded.decisao, texto = excluded.texto, created_at = now()
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function rh_dar_ciencia(uuid, date, date, text, text, text) from public;
grant execute on function rh_dar_ciencia(uuid, date, date, text, text, text) to authenticated;

-- Assinar o espelho exige ciência de TODA divergência do ciclo, e nenhuma
-- explicação pode estar em aberto (senão "conferi e concordo" seria vazio).
create or replace function rh_ciencia_pendente(p_colaborador_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid; v_ini date; v_fim date; v_pend jsonb := '[]'::jsonb; r record;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if not (rh_can(v_org) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(v_org, p_competencia);

  for r in
    select p.data, x.div from rh_ponto p
    cross join lateral (values
      (case when p.ajuste_em is not null then 'ajustado' end),
      (case when p.intervalo_ok = false then 'intervalo_curto' end),
      (case when p.extra_status = 'pendente' then 'extra_pendente' end)
    ) as x(div)
    where p.colaborador_id = p_colaborador_id and p.data between v_ini and v_fim and x.div is not null
  loop
    if not exists (select 1 from rh_ciencia c where c.colaborador_id = p_colaborador_id
                    and c.data = r.data and c.divergencia = r.div) then
      v_pend := v_pend || jsonb_build_object('data', r.data, 'divergencia', r.div);
    end if;
  end loop;

  return jsonb_build_object('pendentes', v_pend,
    'explicacoes_abertas', (select count(*) from rh_ciencia c
       where c.colaborador_id = p_colaborador_id and c.competencia = p_competencia
         and c.decisao = 'explicacao' and c.respondido_em is null));
end; $$;
revoke execute on function rh_ciencia_pendente(uuid, date) from public;
grant execute on function rh_ciencia_pendente(uuid, date) to authenticated;

notify pgrst, 'reload schema';
