#!/usr/bin/env bash
# Deploy do Roteiros Virais na VPS compartilhada (etapa 13). Roda DESTE Mac,
# nunca do GitHub Actions: a chave SSH nao sai daqui (acessos/VPS.md).
#
# O que faz, em ordem:
#   1. confere que o alias responde srv1953618
#   2. copia deploy/compose.prod.yml para /srv/roteiros/docker-compose.yml
#   3. docker compose pull (imagens do GHCR, construidas no CI)
#   4. sobe o Postgres e espera ficar saudavel
#   5. roda as migracoes pelo container do worker (tem tsx e a pasta drizzle)
#   6. sobe tudo (app, worker, backup) e confere /api/saude por dentro da rede
#
# Uso: deploy/deploy.sh [tag]   (padrao: latest). Nao faz build, nao mexe no
# proxy, nao toca fora de /srv/roteiros. Domínio e .env ja precisam existir.
set -euo pipefail

TAG="${1:-latest}"
ALIAS=getorbita-vps
DIR=/srv/roteiros
AQUI="$(cd "$(dirname "$0")" && pwd)"

host=$(ssh -o BatchMode=yes "$ALIAS" hostname)
if [ "$host" != "srv1953618" ]; then
  echo "hostname inesperado: $host (esperado srv1953618). Parando." >&2
  exit 1
fi

ssh "$ALIAS" "test -f $DIR/.env" || { echo "$DIR/.env nao existe na VPS. Parando." >&2; exit 1; }
ssh "$ALIAS" "docker network inspect web >/dev/null 2>&1" || { echo "rede web nao existe (o proxy compartilhado ainda nao foi criado). Parando." >&2; exit 1; }

echo "== copiando o compose"
scp -q "$AQUI/compose.prod.yml" "$ALIAS:$DIR/docker-compose.yml"

echo "== puxando imagens ($TAG)"
ssh "$ALIAS" "cd $DIR && TAG=$TAG docker compose pull --quiet"

echo "== subindo o banco"
ssh "$ALIAS" "cd $DIR && TAG=$TAG docker compose up -d roteiros-postgres"
ssh "$ALIAS" "cd $DIR && for i in \$(seq 1 30); do docker compose ps --format '{{.Health}}' roteiros-postgres | grep -q healthy && exit 0; sleep 2; done; echo 'postgres nao ficou saudavel' >&2; exit 1"

echo "== migrando o banco"
ssh "$ALIAS" "cd $DIR && TAG=$TAG docker compose run --rm --no-deps roteiros-worker npm run -s db:migrate"

echo "== subindo app, worker e backup"
ssh "$ALIAS" "cd $DIR && TAG=$TAG docker compose up -d --remove-orphans"

echo "== conferindo /api/saude"
ssh "$ALIAS" "for i in \$(seq 1 30); do docker exec roteiros-app curl -fsS http://localhost:3000/api/saude >/dev/null 2>&1 && echo ok && exit 0; sleep 2; done; echo 'app nao respondeu em /api/saude' >&2; docker logs --tail 50 roteiros-app >&2; exit 1"

echo "== containers"
ssh "$ALIAS" "cd $DIR && docker compose ps"
echo "deploy concluido ($TAG)"
