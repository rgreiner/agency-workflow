-- 110_visual_boards_kind.sql
-- Mapa mental como um TIPO de quadro (escolhido na criação), não um módulo novo:
-- reusa visual_boards (lista, RLS, autosave, título, excluir). O que muda é o
-- EDITOR e o formato do blob `data`:
--   kind='quadro' → { elements: [...], arrows: [...] }   (canvas livre, já existia)
--   kind='mapa'   → { root: { id, text, children: [...] } }  (árvore; layout calculado)
-- Aditivo e idempotente: default 'quadro' mantém todo quadro existente intacto.

alter table visual_boards add column if not exists kind text not null default 'quadro';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visual_boards_kind_check') then
    alter table visual_boards add constraint visual_boards_kind_check check (kind in ('quadro', 'mapa'));
  end if;
end $$;

create index if not exists idx_visual_boards_kind on visual_boards(org_id, kind);

notify pgrst, 'reload schema';
