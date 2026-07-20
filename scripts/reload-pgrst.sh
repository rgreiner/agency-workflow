DB=j14j0o0lmmk20mbcya17dgnd
PGRST=$(docker ps --format '{{.Names}}' | grep -i postgrest | grep -v '^$')
n=$(printf '%s\n' "$PGRST" | grep -c .)
found=0
for P in $PGRST; do
  if docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$P" | grep -q "@$DB:"; then
    echo ">>> PostgREST do Flow (por conexão): $P — reiniciando"; docker restart "$P"; found=1
  fi
done
if [ "$found" = "0" ]; then
  if [ "$n" = "1" ]; then
    echo ">>> Só há 1 PostgREST ($PGRST) — reiniciando"; docker restart $PGRST
  else
    echo "!! $n PostgREST e nenhum casou por conexão. Escolha manualmente:"; printf '%s\n' "$PGRST"
  fi
fi
