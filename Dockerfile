# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Imagem de produção do Flow (Coolify → Build strategy: Dockerfile).
# Substitui o Nixpacks (17/10/2026): a imagem dele tinha 2,88 GB porque levava
# ferramentas de build e TODO o node_modules, inclusive de desenvolvimento. Aqui
# o build acontece numa etapa e a imagem final leva só a saída `standalone` do
# Next (servidor + dependências que ele de fato usa) e os programas de sistema
# que o app chama: openssl (certificado da NFS-e) e poppler — pdftotext/pdfimages
# (leitura de PDF: inventário de mídia, documentos).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Só o que o BUILD precisa enxergar: as NEXT_PUBLIC_* entram no bundle do
# navegador, e o SOURCE_COMMIT vira o deploymentId (aba antiga recarrega sozinha
# depois de um deploy). Segredo NÃO entra como ARG — ficaria gravado na imagem.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG SOURCE_COMMIT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    SOURCE_COMMIT=$SOURCE_COMMIT \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Os arquivos enviados vivem no volume montado em /app/uploads (dono root,
# como no container do Nixpacks) — por isso o processo segue como root.
EXPOSE 3000
CMD ["node", "server.js"]
