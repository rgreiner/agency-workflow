-- Campos de qualificação para o time comercial
alter table organizations
  add column if not exists company_type text,   -- agencia | empresa | freelancer | outro
  add column if not exists company_size text,   -- 1-5 | 6-20 | 21-50 | 50+
  add column if not exists segment text;        -- marketing | comunicacao | publicidade | tech | outro

alter table profiles
  add column if not exists role_title text,     -- cargo/função
  add column if not exists phone text;          -- telefone (opcional)
