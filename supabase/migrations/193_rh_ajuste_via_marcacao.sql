-- 193_rh_ajuste_via_marcacao.sql
-- Auditoria 02/08, RH #2 (alta, verificado): "A correção de marcação por
-- justificativa aprovada regrediu e não tem mais efeito".
--
-- A 163 aplica o ajuste escrevendo nas COLUNAS FIXAS de rh_ponto
-- (entrada/intervalo_ini/intervalo_fim/saida). A 165 trocou o motor: o
-- rh_recalc_ponto passou a recalcular tudo a partir de `rh_marcacao` e, no fim,
-- REESCREVE aquelas mesmas colunas a partir da lista. Ou seja: o RH aprova a
-- justificativa, a tela diz "1 ponto ajustado", e o próprio recálculo desfaz o
-- ajuste no mesmo comando. O saldo continua errado.
--
-- Correção: parar de ter duas maneiras de editar um dia. A decisão passa a
-- delegar para `rh_editar_ponto` (166/169), que é o caminho completo — grava em
-- rh_marcacao, guarda o "antes" em rh_ponto_log, recusa dia importado, respeita a
-- trava da competência assinada e recalcula no fim.
--
-- Idempotente.

-- Por que um ajuste não pôde ser aplicado (competência assinada, dia importado).
-- Fica na justificativa, não só no toast: a tela precisa continuar dizendo a
-- verdade depois que o toast some.
alter table rh_justificativa add column if not exists ajuste_erro text;

-- ── Decisão do RH ───────────────────────────────────────────────────────────
create or replace function rh_decidir_justificativa(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  jt rh_justificativa; p rh_ponto;
  v_pede boolean; v_ajustados int := 0;
  v_marc text[]; v_n int; v_novo text[]; v_erros jsonb := '[]'::jsonb; v_msg text;
  v_e text; v_ii text; v_if text; v_s text; v_extras text[];
begin
  select * into jt from rh_justificativa where id = p_id;
  if jt.id is null then raise exception 'Justificativa não encontrada'; end if;
  if not rh_can(jt.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_status not in ('aprovado','rejeitado','abonado','falta') then raise exception 'Status inválido'; end if;

  update rh_justificativa
     set status = p_status, decidido_por = auth.uid(), decidido_em = now(), ajuste_erro = null
   where id = p_id;

  v_pede := (jt.hora_entrada is not null or jt.hora_intervalo_ini is not null
             or jt.hora_intervalo_fim is not null or jt.hora_saida is not null);

  if p_status = 'aprovado' and v_pede then
    -- Correção de horário vale para UM dia. A tela já impede pedir horário em
    -- justificativa de período; aplicar a mesma entrada/saída em cinco dias
    -- seria inventar marcação, então o resto fica registrado como não aplicado.
    insert into rh_ponto (org_id, colaborador_id, data) values (jt.org_id, jt.colaborador_id, jt.data_ini)
      on conflict (colaborador_id, data) do nothing;
    select * into p from rh_ponto where colaborador_id = jt.colaborador_id and data = jt.data_ini;

    v_marc := coalesce(
      (select array_agg(to_char(hora, 'HH24:MI') order by seq) from rh_marcacao where ponto_id = p.id),
      '{}'::text[]);
    v_n := coalesce(array_length(v_marc, 1), 0);

    -- Os quatro campos da justificativa são POSIÇÕES no dia, não marcações
    -- avulsas: 1ª, saída p/ intervalo, volta, e a ÚLTIMA. O que não foi
    -- informado é preservado — a tela diz "preencha só o que precisa corrigir".
    -- As posições 2 e 3 só existem como intervalo quando o dia tem 4+ marcações;
    -- num dia de 2 marcações a posição 2 é a saída, e sobrescrevê-la apagaria o
    -- fim da jornada.
    v_e  := coalesce(to_char(jt.hora_entrada, 'HH24:MI'),       v_marc[1]);
    v_ii := coalesce(to_char(jt.hora_intervalo_ini, 'HH24:MI'), case when v_n >= 4 then v_marc[2] end);
    v_if := coalesce(to_char(jt.hora_intervalo_fim, 'HH24:MI'), case when v_n >= 4 then v_marc[3] end);
    v_s  := coalesce(to_char(jt.hora_saida, 'HH24:MI'),         case when v_n >= 2 then v_marc[v_n] end);
    -- Pausas extras do meio do dia (5ª marcação em diante) continuam de pé.
    v_extras := case when v_n >= 5 then v_marc[4 : v_n - 1] else '{}'::text[] end;

    v_novo := array_remove(array[v_e, v_ii, v_if] || v_extras || array[v_s], null);

    begin
      perform rh_editar_ponto(
        jt.org_id, jt.colaborador_id, jt.data_ini,
        to_jsonb(v_novo),
        'Justificativa aprovada pelo RH — ' || jt.tipo
      );
      update rh_ponto set ajuste_just_id = p_id where id = p.id;
      v_ajustados := 1;
    exception when others then
      -- Competência assinada ou dia importado: a decisão vale, o ajuste não.
      -- Nunca engolir em silêncio — é exatamente o que esta migration conserta.
      v_msg := SQLERRM;
      v_erros := v_erros || jsonb_build_object('data', jt.data_ini, 'motivo', v_msg);
    end;

    if jt.data_fim > jt.data_ini then
      v_erros := v_erros || jsonb_build_object(
        'data', jt.data_fim,
        'motivo', 'Correção de horário vale para um dia. Os demais dias do período foram apenas decididos.');
    end if;

    if jsonb_array_length(v_erros) > 0 then
      update rh_justificativa set ajuste_erro = (v_erros->0->>'motivo') where id = p_id;
    end if;
  end if;

  return jsonb_build_object('status', p_status, 'pontos_ajustados', v_ajustados, 'nao_aplicados', v_erros);
end $$;

revoke execute on function rh_decidir_justificativa(uuid, text) from public, anon;
grant  execute on function rh_decidir_justificativa(uuid, text) to authenticated;

notify pgrst, 'reload schema';
