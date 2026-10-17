#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Backup diário do FLOW → B2 (oneaone-sensivel/flow-backup). Criado em 17/10/2026:
# até aqui o banco do Flow (financeiro, ponto, RH) não tinha backup NENHUM.
#   • Banco: pg_dump -Fc, conferido com pg_restore -l antes de subir.
#     Retenção: 30 dias de diários; o dump do dia 01 de cada mês fica para sempre.
#   • Arquivos (NFs, OFX, documentos de RH): espelho ADD-ONLY (`rclone copy`,
#     nunca `sync`) — apagar no Flow não apaga no backup.
#   • Container do Postgres achado PELO SCHEMA (tabela activities), nunca pelo
#     nome: o hash muda a cada redeploy.
#   • Bucket sensível (chave própria `b2sens`): o dump tem CPF, salário e financeiro.
# Restaurar: rclone copy b2sens:oneaone-sensivel/flow-backup/db/<arquivo> . e
#   docker exec -i <pg> pg_restore -U postgres -d <banco_novo> --no-owner < <arquivo>
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEST="b2sens:oneaone-sensivel/flow-backup"
LOG="/var/log/flow-backup.log"
DIA=$(date +%F)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
exec >>"$LOG" 2>&1

# Falha não pode ser silenciosa: vai para Configurações → Erros do Flow.
acha_pg() {
  for c in $(docker ps --format '{{.Names}}'); do
    if docker exec "$c" sh -c 'command -v psql >/dev/null && psql -U postgres -tAc "select to_regclass('"'"'public.activities'"'"')"' 2>/dev/null | grep -q activities; then
      echo "$c"; return
    fi
  done
}
falhou() {
  echo "ERRO na linha $1"
  local pg; pg=$(acha_pg) || true
  [ -n "$pg" ] && docker exec "$pg" psql -U postgres -c \
    "insert into system_errors (org_id, context, message, detail, resolved, created_at)
     select id, 'backup:flow', 'Backup diário do Flow falhou (linha $1)', 'Ver /var/log/flow-backup.log no VPS', false, now()
     from organizations" >/dev/null 2>&1 || true
}
trap 'falhou $LINENO' ERR
echo "=== início $(date -Is)"

PG=$(acha_pg)
[ -n "$PG" ] || { echo "ERRO: Postgres do Flow não encontrado"; falhou "acha_pg"; exit 1; }

ARQ="$TMP/flow-db-$DIA.dump"
docker exec "$PG" pg_dump -U postgres -d postgres -Fc > "$ARQ"
# Dump que não lista é dump quebrado: não sobe nem apaga os antigos.
docker exec -i "$PG" pg_restore -l < "$ARQ" > /dev/null
echo "dump ok: $(du -h "$ARQ" | cut -f1)"
rclone copy "$ARQ" "$DEST/db/"

VOL=$(docker volume ls --format '{{.Name}}' | grep -E -- '-flow-uploads$' | head -1)
if [ -n "$VOL" ]; then
  rclone copy "/var/lib/docker/volumes/$VOL/_data" "$DEST/uploads/" --fast-list --transfers=4
  echo "uploads ok ($VOL)"
else
  echo "AVISO: volume de uploads não encontrado"
fi

rclone delete "$DEST/db/" --min-age 30d --filter "- flow-db-*-01.dump" --filter "+ flow-db-*.dump" --filter "- *"
echo "$DIA $(date -Is)" > "$TMP/ultimo-ok.txt"
rclone copy "$TMP/ultimo-ok.txt" "$DEST/"
echo "=== fim $(date -Is)"
