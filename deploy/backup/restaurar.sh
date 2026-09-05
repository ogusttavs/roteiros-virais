#!/usr/bin/env bash
# Restaura um dump do backup.sh num Postgres vazio (etapa 13, decisao 2).
# Recusa restaurar se o banco de destino ja tiver a tabela "clientes" (nunca
# sobrescrever producao por engano); --forcar=<nome-do-banco> desliga essa
# recusa, exigindo que quem roda confirme de proposito o nome exato do banco
# que vai ser derrubado (achado da revisao adversarial desta etapa: um
# --forcar sem nome nenhum nao protege contra um DESTINO errado por engano,
# por exemplo apontando pro banco do OdontoTech na mesma VPS compartilhada).
#
# Uso: deploy/backup/restaurar.sh <dump.sql.gz> <DATABASE_URL> [--forcar=<nome-do-banco>]
#
# Precisa de psql na maquina que roda o script (pg_dump mais novo restaurando
# num Postgres igual ou mais velho e compativel; o caminho contrario nao e).
#
# As consultas parametrizadas abaixo usam variavel do psql (:'var' vira
# literal SQL escapado, :"var" vira identificador escapado) para nunca
# concatenar NOME_BANCO direto numa string SQL. Achado rodando de verdade:
# isso so interpola quando o SQL entra pela entrada padrao do psql
# (`<<<`); com `-c "..."`, o psql NAO substitui `:'var'`/`:"var"` (mesmo
# com `-v` setado), e falha com "syntax error at or near \":\"" sem
# nenhum aviso melhor.
set -euo pipefail

ARQUIVO="${1:?uso: restaurar.sh <dump.sql.gz> <DATABASE_URL> [--forcar=<nome-do-banco>]}"
DESTINO="${2:?uso: restaurar.sh <dump.sql.gz> <DATABASE_URL> [--forcar=<nome-do-banco>]}"
FORCAR="${3:-}"

if [ ! -f "$ARQUIVO" ]; then
  echo "[restaurar] arquivo nao encontrado: $ARQUIVO" >&2
  exit 1
fi

TEM_CLIENTES=$(psql "$DESTINO" -tA <<< "select to_regclass('public.clientes') is not null;")

if [ "$TEM_CLIENTES" = "t" ]; then
  # Nome de verdade do banco, pelo proprio Postgres: cortar DESTINO na
  # ultima barra quebrava em silencio quando a URL tinha query string
  # (?sslmode=require, por exemplo) — achado da revisao adversarial desta
  # etapa.
  NOME_BANCO=$(psql "$DESTINO" -tA <<< "select current_database();")

  if [ "$FORCAR" != "--forcar=$NOME_BANCO" ]; then
    echo "[restaurar] o banco de destino ($NOME_BANCO) ja tem a tabela clientes; parece producao ou um banco ja usado." >&2
    echo "[restaurar] para confirmar de proposito que quer sobrescrever, rode de novo com: --forcar=$NOME_BANCO" >&2
    exit 1
  fi

  # URL de manutencao (mesmo host, banco "postgres"), preservando a query
  # string se houver.
  SEM_QUERY="${DESTINO%%\?*}"
  QUERY="${DESTINO#"$SEM_QUERY"}"
  URL_MANUTENCAO="${SEM_QUERY%/*}/postgres${QUERY}"

  # pg_dump (sem --clean) so cria; restaurar por cima de um banco ja usado
  # esbarra em "already exists". --forcar derruba e recria o banco inteiro
  # em vez de tentar adivinhar cada schema (drizzle, pgboss...) na unha.
  echo "[restaurar] --forcar: derrubando e recriando o banco $NOME_BANCO"
  psql "$URL_MANUTENCAO" -v ON_ERROR_STOP=1 -q -v nome_banco="$NOME_BANCO" > /dev/null <<< \
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = :'nome_banco' and pid <> pg_backend_pid();"

  # pg_terminate_backend so pede o encerramento e retorna na hora; espera de
  # verdade as conexoes fecharem antes do DROP DATABASE (achado da revisao
  # adversarial: sem esperar, o DROP podia falhar com "is being accessed by
  # other users" logo depois de derrubar as conexoes, sem terminar).
  for _ in $(seq 1 20); do
    RESTANTES=$(psql "$URL_MANUTENCAO" -tA -v nome_banco="$NOME_BANCO" <<< \
      "select count(*) from pg_stat_activity where datname = :'nome_banco';")
    [ "$RESTANTES" = "0" ] && break
    sleep 0.5
  done

  psql "$URL_MANUTENCAO" -v ON_ERROR_STOP=1 -q -v nome_banco="$NOME_BANCO" > /dev/null <<< 'drop database if exists :"nome_banco";'
  psql "$URL_MANUTENCAO" -v ON_ERROR_STOP=1 -q -v nome_banco="$NOME_BANCO" > /dev/null <<< 'create database :"nome_banco";'
fi

echo "[restaurar] restaurando $ARQUIVO em $DESTINO"
gunzip -c "$ARQUIVO" | psql "$DESTINO" -v ON_ERROR_STOP=1 -q > /dev/null
echo "[restaurar] ok"
