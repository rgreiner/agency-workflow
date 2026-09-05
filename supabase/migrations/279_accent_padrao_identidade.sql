-- 279: accent padrão passa a ser o laranja da identidade do Flow (#ff6a00).
--
-- O default da coluna ainda era o indigo da migration 016 (#6366f1) e o app
-- caía no #f97316 (orange-500 do Tailwind) quando a org não tinha escolhido.
-- Aqui: (1) default da coluna = #ff6a00; (2) quem está num dos dois defaults
-- antigos (nunca escolheu de fato) vai para o novo. Quem escolheu outra cor em
-- Aparência não é tocado. Idempotente.

alter table public.org_settings
  alter column accent_color set default '#ff6a00';

update public.org_settings
   set accent_color = '#ff6a00',
       updated_at   = now()
 where lower(accent_color) in ('#f97316', '#6366f1');

notify pgrst, 'reload schema';
