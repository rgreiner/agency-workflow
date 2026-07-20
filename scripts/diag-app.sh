APP=kz9ozvt8ee6qf78ailz3y7ol-130341321078
echo "== imagem / criado em =="
docker inspect -f 'img={{.Config.Image}}  criado={{.Created}}  status={{.State.Status}}' "$APP"
echo
echo "== meu código novo está no build? (procura 'briefing_workspace_id' no .next) =="
if docker exec "$APP" sh -c "grep -rl briefing_workspace_id /app/.next 2>/dev/null | head -1"; then
  echo "-> CÓDIGO NOVO PRESENTE"
else
  echo "-> NÃO ENCONTRADO (deploy do meu código não subiu)"
fi
echo
echo "== reiniciando o app do Flow =="
docker restart "$APP" >/dev/null && echo "app reiniciado — aguarde ~15s e dê Cmd+Shift+R na tela de Documentos"
