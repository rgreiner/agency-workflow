-- 301: o recálculo do dia passa a usar a CARGA LÍQUIDA (22/09/2026).
--
-- Caso real: fechamento da Luiza Boschirolli, que cumpriu aviso prévio com
-- redução de 2h/dia (21/08 → 20/09). O espelho mostrava 2:11 de extra e saldo
-- −1:48; o fechamento, 0:00* de extra e −3:59. As 2:11 não apareciam em
-- Aprovações — não havia como aprová-las.
--
-- Causa: rh_recalc_ponto era a ÚLTIMA cópia da régua de carga. Usava a jornada
-- crua (8h) e não sabia de aviso prévio, abono, emenda nem vínculo. Contra 8h,
-- todo dia de 6h10 fechava negativo, a extra nunca virava 'pendente', e a fila
-- (que lê extra_status) não a mostrava; o fechamento, que usa a carga líquida,
-- a contava como pendente. Pior: qualquer recálculo APAGAVA decisão tomada —
-- a extra de 21/08, aprovada em 25/08 e paga no fechamento de agosto (enviado
-- em 26/08), perdeu o status num recálculo em 28/08.
--
-- Agora a carga vem de rh_esperado_min, a mesma do espelho, do fechamento e da
-- fila. `saldo_min` gravado passa a ser o saldo LÍQUIDO (o painel de RH e o
-- retorno de rh_bater_ponto/rh_editar_ponto leem essa coluna).

create or replace function rh_recalc_ponto(p_ponto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  p rh_ponto; j rh_jornada; v_min int := 0; v_carga int; v_bate boolean;
  v_maior int := 0; v_n int; v_ini time; v_fim time; v_ant time; r record; v_i int := 0;
  v_saldo int; v_tol int;
begin
  select * into p from rh_ponto where id = p_ponto_id;
  if p.id is null then return; end if;
  if p.origem is not null then return; end if;   -- histórico importado é congelado
  j := rh_jornada_em(p.colaborador_id, p.data);   -- jornada do dia (mig. 288)

  select count(*) into v_n from rh_marcacao where ponto_id = p.id;

  for r in select hora, seq from rh_marcacao where ponto_id = p.id order by seq loop
    v_i := v_i + 1;
    if v_i % 2 = 1 then
      v_ini := r.hora;
      if v_ant is not null then
        v_maior := greatest(v_maior, rh_min_do_dia(v_ini) - rh_min_do_dia(v_ant));
      end if;
    else
      v_fim := r.hora;
      v_min := v_min + greatest(0, rh_min_do_dia(v_fim) - rh_min_do_dia(v_ini));
      v_ant := v_fim;
    end if;
  end loop;

  if v_n = 0 or v_n % 2 = 1 then
    update rh_ponto set minutos = 0, saldo_min = 0, acima_10h = false,
      intervalo_maior_min = nullif(v_maior, 0), intervalo_ok = null, updated_at = now()
    where id = p.id;
    return;
  end if;

  -- Carga LÍQUIDA do dia: jornada, feriado, emenda, vínculo, aviso prévio e
  -- abono — a mesma régua de espelho, fechamento e fila. Nunca mais recriar
  -- essa conta aqui.
  v_bate  := coalesce((select bate_ponto from rh_colaborador where id = p.colaborador_id), true);
  v_carga := rh_esperado_min(p.colaborador_id, p.data);
  v_min   := least(v_min, coalesce(j.max_dia_min, 600));
  v_tol   := coalesce(j.tolerancia_min, 10);
  -- Dispensado de ponto (art. 62, mig. 259) não tem saldo nem extra: as horas
  -- entram como estão. Os demais seguem a tolerância do TOTAL do dia (mig. 223);
  -- sem carga (fim de semana, feriado), conta desde o primeiro minuto.
  v_saldo := case when v_bate then rh_saldo_tolerado(v_min, v_carga, v_tol) else 0 end;

  update rh_ponto set
    minutos   = v_min,
    acima_10h = (v_min >= coalesce(j.max_dia_min, 600)),
    saldo_min = v_saldo,
    intervalo_maior_min = v_maior,
    intervalo_ok = case when v_min > 360 then v_maior >= coalesce(j.intervalo_min, 60) else true end,
    -- Só pede aprovação quando sobrou extra DE VERDADE; decisão tomada fica
    -- enquanto a extra existir. Dispensado nunca entra na fila.
    extra_status = case
      when not v_bate then case when extra_status in ('aprovado', 'rejeitado') then extra_status end
      when v_saldo > 0 then coalesce(extra_status, 'pendente')
      else null end,
    entrada       = (select hora from rh_marcacao where ponto_id = p.id and seq = 1),
    intervalo_ini = (select hora from rh_marcacao where ponto_id = p.id and seq = 2),
    intervalo_fim = (select hora from rh_marcacao where ponto_id = p.id and seq = 3),
    saida         = (select hora from rh_marcacao where ponto_id = p.id order by seq desc limit 1),
    updated_at = now()
  where id = p.id;
end; $$;

-- ── Reprocessa os dias vivos cujo gravado diverge da régua líquida ──────────
-- Medido antes (22/09): 73 dias com saldo gravado diferente; de status, só 6
-- dias da Luiza Boschirolli (null → pendente) e 1 sábado do Rafael (pendente →
-- null: dispensado não tem extra). Nenhuma decisão tomada muda.
do $$
declare r record; v_n int := 0;
begin
  for r in
    select p.id
      from rh_ponto p join rh_colaborador c on c.id = p.colaborador_id
     where p.origem is null
       and p.saldo_min is distinct from (
             case when coalesce(c.bate_ponto, true)
                  then rh_saldo_tolerado(p.minutos, rh_esperado_min(p.colaborador_id, p.data),
                         coalesce((rh_jornada_em(p.colaborador_id, p.data)).tolerancia_min, 10))
                  else 0 end)
  loop
    perform rh_recalc_ponto(r.id);
    v_n := v_n + 1;
  end loop;
  raise notice 'dias reprocessados: %', v_n;
end $$;

-- ── Devolve a aprovação que o recálculo cru apagou ─────────────────────────
-- 21/08 da Luiza Boschirolli: aprovada pelo Rafael em 25/08 15:18 (extra_por e
-- extra_em continuam no registro) e paga no fechamento de agosto enviado em
-- 26/08 — H.E. de 56 min = os 42 que seguem aprovados + estes 14. Única linha
-- do time com decisão registrada, status apagado e extra líquida existente.
update rh_ponto set extra_status = 'aprovado'
 where id = '11a58a6d-1351-4dbc-8c49-e4555b1bd794'
   and extra_em is not null
   and extra_status is distinct from 'aprovado';

notify pgrst, 'reload schema';
