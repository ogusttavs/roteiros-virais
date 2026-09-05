#!/usr/bin/env bash
# Restaura um dump do backup.sh num Postgres vazio (etapa 13, decisao 2).
# Recusa restaurar se o banco de destino ja tiver a tabela "clientes" (nunca
# sobrescrever producao por engano); --forcar desliga essa recusa.
#
# Uso: deploy/backup/restaurar.sh <dump.sql.gz> <DATABASE_URL> [--forcar]
#
# Precisa de psql na maquina que roda o script (pg_dump mais novo restaurando
# num Postgres igual ou mais velho e compativel; o caminho contrario nao e).
set -euo pipefail

ARQUIVO="${1:?uso: restaurar.sh <dump.sql.gz> <DATABASE_URL> [--forcar]}"
DESTINO="${2:?uso: restaurar.sh <dump.sql.gz> <DATABASE_URL> [--forcar]}"
FORCAR="${3:-}"

if [ ! -f "$ARQUIVO" ]; then
  echo "[restaurar] arquivo nao encontrado: $ARQUIVO" >&2
  exit 1
fi

TEM_CLIENTES=$(psql "$DESTINO" -tAc "select to_regclass('public.clientes') is not null")

if [ "$TEM_CLIENTES" = "t" ]; then
  if [ "$FORCAR" != "--forcar" ]; then
    echo "[restaurar] o banco de destino ja tem a tabela clientes; parece producao ou um banco ja usado." >&2
    echo "[restaurar] use --forcar so se tiver certeza de que quer sobrescrever." >&2
    exit 1
  fi
  # pg_dump (sem --clean) so cria; restaurar por cima de um banco ja usado
  # esbarra em "already exists". --forcar derruba e recria o banco inteiro
  # em vez de tentar adivinhar cada schema (drizzle, pgboss...) na unha.
  NOME_BANCO="${DESTINO##*/}"
  URL_MANUTENCAO="${DESTINO%/*}/postgres"
  echo "[restaurar] --forcar: derrubando e recriando o banco $NOME_BANCO"
  psql "$URL_MANUTENCAO" -v ON_ERROR_STOP=1 -q -c \
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$NOME_BANCO' and pid <> pg_backend_pid();" \
    > /dev/null
  psql "$URL_MANUTENCAO" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$NOME_BANCO\";" > /dev/null
  psql "$URL_MANUTENCAO" -v ON_ERROR_STOP=1 -q -c "create database \"$NOME_BANCO\";" > /dev/null
fi

echo "[restaurar] restaurando $ARQUIVO em $DESTINO"
gunzip -c "$ARQUIVO" | psql "$DESTINO" -v ON_ERROR_STOP=1 -q > /dev/null
echo "[restaurar] ok"
