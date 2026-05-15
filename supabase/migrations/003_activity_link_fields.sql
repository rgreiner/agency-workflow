alter table activities
  add column if not exists drive_folder_url  text,  -- pasta raiz no Google Drive
  add column if not exists redacao_url       text,  -- Google Docs redação
  add column if not exists layout_url        text,  -- Google Drive layout/editáveis
  add column if not exists finalizacao_url   text,  -- arquivo final
  add column if not exists orcamento         text;  -- orçamento
