#!/usr/bin/env bash
# Refaz os indices de um banco depois de trocar a imagem do Postgres de postgres:16-alpine (musl) para
# pgvector/pgvector:*-bookworm (Debian, glibc) sobre o MESMO volume (E17 parte 1,
# entregaveis/revisoes/e17-escopo.md, secao 4). Os dois sistemas ordenam texto de jeitos diferentes
# (o Alpine por byte, o Debian pela localidade en_US.utf8 que o banco registrou): os indices de texto
# gravados no Alpine ficam fora de ordem no Debian, e a busca por e-mail, id_externo ou handle pode
# errar sem aviso. Medido em 22/10/2026: bt_index_check falhou e uma consulta de faixa devolveu 0
# linhas pelo indice contra 7 sem ele.
#
# O que faz, em ordem:
#   1. recusa se o app ou o worker estiverem no ar (escrever em indice fora de ordem piora tudo);
#   2. confere que o servidor tem o pgvector disponivel (senao a troca nao foi feita);
#   3. REINDEX DATABASE, ALTER DATABASE ... REFRESH COLLATION VERSION;
#   4. bt_index_check (com heapallindexed) em TODOS os indices de arvore; qualquer falha derruba o script.
# Saida 0 so se a verificacao passou inteira. Nao apaga nada, nao toca nos dados.
#
# Uso: deploy/reindexar-depois-da-troca.sh <container-do-postgres> <banco> [usuario] [--com-o-app-no-ar]
#   producao (na VPS): deploy/reindexar-depois-da-troca.sh roteiros-postgres roteiros roteiros
#   ensaio: o mesmo, com roteiros-postgres-ensaio
set -euo pipefail

USO="uso: deploy/reindexar-depois-da-troca.sh <container-do-postgres> <banco> [usuario] [--com-o-app-no-ar]"
CONTAINER="${1:?$USO}"
BANCO="${2:?$USO}"
USUARIO="${3:-roteiros}"
SEM_TRAVA=0
for a in "$@"; do [ "$a" = "--com-o-app-no-ar" ] && SEM_TRAVA=1; done
[ "$USUARIO" = "--com-o-app-no-ar" ] && USUARIO="roteiros"

psql_() { docker exec -i "$CONTAINER" psql -U "$USUARIO" -d "$BANCO" -v ON_ERROR_STOP=1 -X -q "$@"; }

if [ "$SEM_TRAVA" != "1" ]; then
  NO_AR=$(docker ps --format '{{.Names}}' | grep -E '^roteiros-(app|worker)(-ensaio)?$' || true)
  if [ -n "$NO_AR" ]; then
    echo "[reindexar] recusando: estes containers estao no ar e escreveriam em indice fora de ordem:" >&2
    echo "$NO_AR" >&2
    echo "[reindexar] pare-os (docker compose stop roteiros-app roteiros-worker roteiros-backup) ou use --com-o-app-no-ar de proposito." >&2
    exit 1
  fi
fi

echo "[reindexar] servidor: $(psql_ -tA -c 'show server_version') em $CONTAINER, banco $BANCO"

TEM_VECTOR=$(psql_ -tA -c "select count(*) from pg_available_extensions where name = 'vector'")
if [ "$TEM_VECTOR" != "1" ]; then
  echo "[reindexar] o servidor nao tem o pgvector disponivel: a imagem ainda e a antiga. Nada feito." >&2
  exit 1
fi

TINHA_AMCHECK=$(psql_ -tA -c "select count(*) from pg_extension where extname = 'amcheck'")
[ "$TINHA_AMCHECK" = "1" ] || psql_ -c "create extension amcheck"

TOTAL=$(psql_ -tA -c "select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_am am on am.oid = c.relam where am.amname = 'btree' and c.relpersistence <> 't'")
echo "[reindexar] $TOTAL indices de arvore a refazer e conferir"

echo "[reindexar] REINDEX DATABASE (pode levar alguns minutos)"
psql_ -c "reindex database \"$BANCO\""

echo "[reindexar] atualizando a versao de colacao registrada (vindo do Alpine ela nao existe e o Postgres recusa; sem ela ele nao avisa de mudanca futura de sistema, por isso a tag da imagem e fixa)"
psql_ -c "alter database \"$BANCO\" refresh collation version" 2>/dev/null || echo "[reindexar] sem versao de colacao registrada (normal vindo do Alpine); seguindo"

echo "[reindexar] conferindo todos os indices (bt_index_check com heapallindexed)"
CONFERIDOS=$(psql_ -tA -c "select count(*) from (select bt_index_check(c.oid, true) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_am am on am.oid = c.relam where am.amname = 'btree' and c.relpersistence <> 't') x")

[ "$TINHA_AMCHECK" = "1" ] || psql_ -c "drop extension amcheck"

echo "[reindexar] ok: $CONFERIDOS de $TOTAL indices conferidos sem erro"
