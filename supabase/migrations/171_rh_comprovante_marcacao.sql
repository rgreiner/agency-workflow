-- 171_rh_comprovante_marcacao.sql
-- Comprovante de CADA marcação, na hora em que acontece (prova contemporânea).
--
-- MODELO: a cadeia NÃO fica sobre rh_marcacao (estado atual, que o RH corrige por
-- rh_editar_ponto). Fica num LIVRO-RAZÃO append-only de eventos. Assim:
--   · toda batida e toda correção viram um evento novo, encadeado por pessoa;
--   · correção autorizada NÃO quebra a cadeia — ela ACRESCENTA um evento
--     'correcao'/'remocao' (o histórico mostra o que era e o que virou);
--   · apagar/alterar evento no banco quebra a cadeia e fica detectável.
-- A ordem da cadeia é a de INSERÇÃO (bigserial), que é determinística.
-- Efeito equivalente ao comprovante que a Portaria 671/2021 exige do REP-P — vocês
-- estão dispensados (<20 empregados), mas o valor probatório é o mesmo.
-- Idempotente.

-- Desfaz a 1ª tentativa (cadeia sobre o estado atual — quebrava a cada correção).
drop trigger if exists rh_marcacao_encadear_tg on rh_marcacao;
drop trigger if exists rh_marcacao_sem_update_tg on rh_marcacao;
drop function if exists rh_marcacao_encadear();
drop function if exists rh_marcacao_verificar(uuid);
alter table rh_marcacao drop column if exists hash;
alter table rh_marcacao drop column if exists hash_anterior;
alter table rh_marcacao add column if not exists registrado_em timestamptz not null default now();
alter table rh_marcacao drop column if exists codigo;

create table if not exists rh_marcacao_evento (
  id             bigserial primary key,        -- ordem da cadeia (determinística)
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  data           date not null,
  hora           time,                          -- null em remoção
  seq            int,
  acao           text not null,                 -- registro | correcao | remocao
  origem         text,                          -- flow | ajuste | pontomais
  em             timestamptz not null default now(),
  hash           text not null,
  hash_anterior  text,
  codigo         text not null                  -- 8 chars, o que a pessoa vê no comprovante
);
create index if not exists rh_marc_ev_colab_idx on rh_marcacao_evento (colaborador_id, id);
create index if not exists rh_marc_ev_data_idx  on rh_marcacao_evento (colaborador_id, data);

alter table rh_marcacao_evento enable row level security;
drop policy if exists rh_marc_ev_ro on rh_marcacao_evento;
create policy rh_marc_ev_ro on rh_marcacao_evento for select
  using (rh_can(org_id) or rh_is_self(colaborador_id));
-- Append-only: nem UPDATE nem DELETE, para ninguém.
drop trigger if exists rh_marc_ev_imutavel_tg on rh_marcacao_evento;
create trigger rh_marc_ev_imutavel_tg before update or delete on rh_marcacao_evento
  for each row execute function rh_append_only();

-- Escreve o evento encadeado (chamado pelos triggers de rh_marcacao).
create or replace function rh_marcacao_evento_add(
  p_colab uuid, p_org uuid, p_data date, p_hora time, p_seq int, p_acao text, p_origem text
) returns text language plpgsql security definer set search_path to 'public' as $$
declare v_ant text; v_hash text; v_em timestamptz := now();
begin
  select hash into v_ant from rh_marcacao_evento
   where colaborador_id = p_colab order by id desc limit 1;
  v_hash := encode(digest(
    coalesce(v_ant, '') || '|' || p_colab::text || '|' || p_data::text || '|' ||
    coalesce(p_hora::text, '') || '|' || coalesce(p_seq::text, '') || '|' ||
    p_acao || '|' || coalesce(p_origem, 'flow') || '|' || v_em::text, 'sha256'), 'hex');
  insert into rh_marcacao_evento (colaborador_id, org_id, data, hora, seq, acao, origem, em, hash, hash_anterior, codigo)
  values (p_colab, p_org, p_data, p_hora, p_seq, p_acao, coalesce(p_origem, 'flow'), v_em,
          v_hash, v_ant, upper(substr(v_hash, 1, 8)));
  return upper(substr(v_hash, 1, 8));
end; $$;
revoke execute on function rh_marcacao_evento_add(uuid, uuid, date, time, int, text, text) from public;

create or replace function rh_marcacao_log() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_colab uuid; v_org uuid; v_data date; r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  select colaborador_id, org_id, data into v_colab, v_org, v_data from rh_ponto where id = r.ponto_id;
  if v_colab is null then return r; end if;
  perform rh_marcacao_evento_add(v_colab, v_org, v_data,
    case when tg_op = 'DELETE' then null else r.hora end,
    r.seq,
    case when tg_op = 'DELETE' then 'remocao'
         when coalesce(r.origem, 'flow') = 'ajuste' then 'correcao' else 'registro' end,
    r.origem);
  return r;
end; $$;
drop trigger if exists rh_marcacao_log_ins_tg on rh_marcacao;
create trigger rh_marcacao_log_ins_tg after insert on rh_marcacao
  for each row execute function rh_marcacao_log();
drop trigger if exists rh_marcacao_log_del_tg on rh_marcacao;
create trigger rh_marcacao_log_del_tg after delete on rh_marcacao
  for each row execute function rh_marcacao_log();

-- Verifica a cadeia de eventos de uma pessoa.
create or replace function rh_marcacao_verificar(p_colaborador_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r record; v_ant text := null; v_calc text; v_erros jsonb := '[]'::jsonb; v_n int := 0;
begin
  if not (rh_is_self(p_colaborador_id)
          or rh_can((select org_id from rh_colaborador where id = p_colaborador_id))) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  for r in select * from rh_marcacao_evento where colaborador_id = p_colaborador_id order by id loop
    v_n := v_n + 1;
    v_calc := encode(digest(
      coalesce(v_ant, '') || '|' || r.colaborador_id::text || '|' || r.data::text || '|' ||
      coalesce(r.hora::text, '') || '|' || coalesce(r.seq::text, '') || '|' ||
      r.acao || '|' || coalesce(r.origem, 'flow') || '|' || r.em::text, 'sha256'), 'hex');
    if r.hash is distinct from v_calc then
      v_erros := v_erros || jsonb_build_object('id', r.id, 'data', r.data, 'codigo', r.codigo,
        'motivo', case when r.hash_anterior is distinct from v_ant
                       then 'elo anterior não confere (evento removido ou reordenado)'
                       else 'evento alterado após o registro' end);
    end if;
    v_ant := r.hash;
  end loop;
  return jsonb_build_object('total', v_n, 'integra', jsonb_array_length(v_erros) = 0, 'erros', v_erros);
end; $$;
revoke execute on function rh_marcacao_verificar(uuid) from public;
grant execute on function rh_marcacao_verificar(uuid) to authenticated;

-- Comprovante da última marcação do dia (o que a tela mostra depois de bater).
create or replace function rh_comprovante_dia(p_colaborador_id uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (rh_is_self(p_colaborador_id)
          or rh_can((select org_id from rh_colaborador where id = p_colaborador_id))) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'hora', to_char(e.hora, 'HH24:MI:SS'), 'acao', e.acao,
            'codigo', e.codigo, 'em', e.em) order by e.id), '[]'::jsonb)
          from rh_marcacao_evento e
         where e.colaborador_id = p_colaborador_id and e.data = p_data);
end; $$;
revoke execute on function rh_comprovante_dia(uuid, date) from public;
grant execute on function rh_comprovante_dia(uuid, date) to authenticated;

-- Backfill: eventos para o que já existe, na ordem cronológica real.
insert into rh_marcacao_evento (colaborador_id, org_id, data, hora, seq, acao, origem, em, hash, hash_anterior, codigo)
select x.colaborador_id, x.org_id, x.data, x.hora, x.seq, 'registro', coalesce(x.origem, 'flow'),
       x.registrado_em, '', null, ''
from (select p.colaborador_id, p.org_id, p.data, m.hora, m.seq, m.origem, m.registrado_em
        from rh_marcacao m join rh_ponto p on p.id = m.ponto_id
       where not exists (select 1 from rh_marcacao_evento e where e.colaborador_id = p.colaborador_id)
       order by p.colaborador_id, p.data, m.seq) x;

-- Calcula a cadeia do backfill na ordem do id. O trigger de imutabilidade é
-- desligado FORA do bloco (não se pode ALTER TABLE dentro de um loop sobre ela).
alter table rh_marcacao_evento disable trigger rh_marc_ev_imutavel_tg;
do $$
declare v_colab uuid; r record; v_ant text; v_calc text;
begin
  for v_colab in select distinct colaborador_id from rh_marcacao_evento where hash = '' loop
    v_ant := null;
    for r in select * from rh_marcacao_evento where colaborador_id = v_colab order by id loop
      v_calc := encode(digest(
        coalesce(v_ant, '') || '|' || r.colaborador_id::text || '|' || r.data::text || '|' ||
        coalesce(r.hora::text, '') || '|' || coalesce(r.seq::text, '') || '|' ||
        r.acao || '|' || coalesce(r.origem, 'flow') || '|' || r.em::text, 'sha256'), 'hex');
      update rh_marcacao_evento set hash = v_calc, hash_anterior = v_ant, codigo = upper(substr(v_calc,1,8))
       where id = r.id;
      v_ant := v_calc;
    end loop;
  end loop;
end $$;
alter table rh_marcacao_evento enable trigger rh_marc_ev_imutavel_tg;

notify pgrst, 'reload schema';
