-- Fundação da hierarquia de pastas (Flow dono da estrutura no S3).
-- Cliente (workspace) ganha a pasta-raiz; campanha ganha o ano (year-scoped).
-- Idempotente. Só dados/coluna — a lógica de provisão vem no código depois.

alter table workspaces add column if not exists folder_root text;   -- pasta-raiz do cliente no bucket (ex.: "Comil")
alter table campaigns  add column if not exists ano int;            -- ano da campanha (marco do início; NÃO auto-avança)

-- Backfill do ANO: extrai o /YYYY/ do caminho já gravado (Cliente/YYYY/Campanha).
update campaigns set ano = split_part(drive_folder_id, '/', 2)::int
where ano is null
  and drive_folder_id ~ '/'
  and split_part(drive_folder_id, '/', 2) ~ '^\d{4}$';

-- Backfill do FOLDER_ROOT: 1º segmento do caminho de qualquer campanha do cliente.
update workspaces w set folder_root = sub.root
from (
  select c.workspace_id, split_part(c.drive_folder_id, '/', 1) as root,
         row_number() over (partition by c.workspace_id order by c.created_at) rn
  from campaigns c where c.drive_folder_id ~ '/'
) sub
where sub.workspace_id = w.id and sub.rn = 1 and w.folder_root is null;

-- Fallback: cliente sem campanha no S3 herda o próprio nome como pasta-raiz.
update workspaces set folder_root = name where folder_root is null and name is not null and name <> '';
