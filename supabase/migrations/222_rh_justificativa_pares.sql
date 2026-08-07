-- 222_rh_justificativa_pares.sql
-- Pedido do RH (07/08): a justificativa do colaborador só permitia 2 períodos
-- (manhã/tarde — 4 horários fixos). Passa a aceitar N pares, como o modal de
-- correção do RH no espelho: `marcacoes` guarda o dia COMPLETO como deveria
-- ficar (["08:30","12:00","13:30","18:00", …]). Ao aprovar, o RH grava a lista
-- inteira via rh_editar_ponto — o caminho único da migration 193.
--
-- Os 4 campos antigos (hora_entrada/intervalo_ini/intervalo_fim/saida) seguem
-- valendo para justificativa pendente criada antes desta migration. De quebra,
-- o merge por posição ganha o conserto do dia ÍMPAR: aprovar "esqueci de bater
-- a saída" num dia de 3 marcações (08:30 · 12:00 · 13:30) descartava o par do
-- almoço — o dia virava 08:30–18:00 direto, 9h30 trabalhadas e extra fantasma.
-- Idempotente.

-- Dia completo proposto, em pares ["HH:MM", …]. NULL = sem correção de horário.
alter table rh_justificativa add column if not exists marcacoes jsonb;

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

  v_pede := coalesce(jsonb_array_length(jt.marcacoes), 0) > 0
            or jt.hora_entrada is not null or jt.hora_intervalo_ini is not null
            or jt.hora_intervalo_fim is not null or jt.hora_saida is not null;

  if p_status = 'aprovado' and v_pede then
    -- Correção de horário vale para UM dia. A tela já impede pedir horário em
    -- justificativa de período; aplicar a mesma entrada/saída em cinco dias
    -- seria inventar marcação, então o resto fica registrado como não aplicado.
    insert into rh_ponto (org_id, colaborador_id, data) values (jt.org_id, jt.colaborador_id, jt.data_ini)
      on conflict (colaborador_id, data) do nothing;
    select * into p from rh_ponto where colaborador_id = jt.colaborador_id and data = jt.data_ini;

    begin
      if coalesce(jsonb_array_length(jt.marcacoes), 0) > 0 then
        -- Caminho novo: a justificativa traz o dia inteiro em pares. Nada de
        -- mesclar posição — a lista É o dia depois da aprovação.
        v_novo := array(select jsonb_array_elements_text(jt.marcacoes));
        if array_length(v_novo, 1) % 2 = 1 then
          raise exception 'As marcações vêm em pares (entrada e saída).';
        end if;
      else
        -- Caminho legado (justificativa anterior à 222): os quatro campos são
        -- POSIÇÕES no dia — 1ª, saída p/ intervalo, volta, ÚLTIMA. O que não
        -- foi informado é preservado.
        v_marc := coalesce(
          (select array_agg(to_char(hora, 'HH24:MI') order by seq) from rh_marcacao where ponto_id = p.id),
          '{}'::text[]);
        v_n := coalesce(array_length(v_marc, 1), 0);

        -- Posições 2 e 3 existem como intervalo a partir de 3 marcações (num
        -- dia de 2, a posição 2 é a saída). A última só é saída com nº PAR —
        -- em dia aberto (ímpar) ela é uma volta, não o fim da jornada.
        v_e  := coalesce(to_char(jt.hora_entrada, 'HH24:MI'),       v_marc[1]);
        v_ii := coalesce(to_char(jt.hora_intervalo_ini, 'HH24:MI'), case when v_n >= 3 then v_marc[2] end);
        v_if := coalesce(to_char(jt.hora_intervalo_fim, 'HH24:MI'), case when v_n >= 3 then v_marc[3] end);
        v_s  := coalesce(to_char(jt.hora_saida, 'HH24:MI'),         case when v_n >= 2 and v_n % 2 = 0 then v_marc[v_n] end);
        -- Pausas extras do meio do dia (5ª marcação em diante) continuam de pé.
        v_extras := case when v_n >= 5
          then (case when v_n % 2 = 0 then v_marc[4 : v_n - 1] else v_marc[4 : v_n] end)
          else '{}'::text[] end;

        v_novo := array_remove(array[v_e, v_ii, v_if] || v_extras || array[v_s], null);
      end if;

      perform rh_editar_ponto(
        jt.org_id, jt.colaborador_id, jt.data_ini,
        to_jsonb(v_novo),
        'Justificativa aprovada pelo RH — ' || jt.tipo
      );
      update rh_ponto set ajuste_just_id = p_id where id = p.id;
      v_ajustados := 1;
    exception when others then
      -- Competência assinada, dia importado, lista ímpar: a decisão vale, o
      -- ajuste não. Nunca engolir em silêncio (é o que a 193 consertou).
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
