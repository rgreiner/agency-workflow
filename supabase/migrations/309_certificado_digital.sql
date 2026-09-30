-- ── Certificado digital e-CNPJ (A1) da org ──────────────────────────────────
--
-- 29/09/2026. Decisão do Rafael: emitir NFS-e pelo Emissor Nacional (rota A). O
-- certificado é o que autentica a agência na Receita — sem ele não há mTLS nem
-- assinatura de DPS. E ele EXPIRA (A1 vale 1 ano), então tem de ser trocável
-- pela tela, com aviso antes de vencer: certificado vencido = nota parada.
--
-- Segredo de valor mais alto do servidor: quem alcança o arquivo emite nota em
-- nome da agência. Mesmo tratamento da chave de IA (mig. 304), e um degrau acima:
--  · tabela SÓ pela conexão direta (role flow_auth), nunca pelo PostgREST;
--  · RLS ligada e sem policy para anon/authenticated;
--  · revoke explícito (DEFAULT PRIVILEGES dá acesso a toda tabela nova);
--  · arquivo E senha cifrados em AES-256-GCM (lib/ai/segredo.ts) — nem um dump
--    do banco entrega o certificado.
--
-- Os metadados (titular, CNPJ, validade) ficam em claro de propósito: a tela
-- avisa do vencimento sem precisar decifrar nada.

create table if not exists org_certificado (
  org_id      uuid primary key references organizations(id) on delete cascade,
  arquivo_enc text not null,          -- .pfx/.p12 em base64, cifrado
  senha_enc   text not null,          -- senha do certificado, cifrada
  nome_arquivo text,
  titular     text,                   -- CN do certificado (ex.: ONE A ONE ... :12345678000199)
  cnpj        text,
  valido_de   timestamptz,
  valido_ate  timestamptz,
  -- Ambiente que o app usa ao falar com a Receita. Começa na produção restrita:
  -- nota emitida em produção é ato público e não se desfaz sem processo.
  ambiente    text not null default 'restrita' check (ambiente in ('restrita', 'producao')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null
);

alter table org_certificado enable row level security;
revoke all on table org_certificado from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'flow_auth') then
    grant usage on schema public to flow_auth;
    grant select, insert, update, delete on table org_certificado to flow_auth;
    drop policy if exists org_certificado_flow_auth on org_certificado;
    create policy org_certificado_flow_auth on org_certificado
      for all to flow_auth using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
