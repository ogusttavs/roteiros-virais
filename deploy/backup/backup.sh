#!/usr/bin/env bash
# Backup diario do Postgres do produto (etapa 13). Roda como servico do
# Compose: dorme ate a hora do backup, faz o pg_dump comprimido em
# /backups (volume roteiros_backups), apaga o que tem mais de 30 dias e,
# se BACKUP_RCLONE_REMOTE estiver definido (ex.: "b2:roteiros-backups"),
# copia para o bucket. O mesmo dump serve para restaurar em outra maquina
# (receita de migracao em _compartilhado/INFRA-VPS.md).
#
# Variaveis (do .env do Compose): DATABASE_URL, BACKUP_HORA_UTC (padrao 06,
# que e 03:00 em Brasilia), BACKUP_RETENCAO_DIAS (padrao 30),
# BACKUP_RCLONE_REMOTE (opcional) e as RCLONE_CONFIG_* do remoto.
set -euo pipefail

HORA="${BACKUP_HORA_UTC:-06}"
RETENCAO="${BACKUP_RETENCAO_DIAS:-30}"
DESTINO=/backups
mkdir -p "$DESTINO"

fazer_backup() {
  local arquivo="$DESTINO/roteiros-$(date -u +%Y-%m-%d-%H%M).sql.gz"
  echo "[backup] iniciando $arquivo"
  pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$arquivo"
  echo "[backup] ok, $(du -h "$arquivo" | cut -f1)"
  find "$DESTINO" -name 'roteiros-*.sql.gz' -mtime +"$RETENCAO" -delete
  if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
    rclone copy "$arquivo" "$BACKUP_RCLONE_REMOTE" && echo "[backup] copiado para $BACKUP_RCLONE_REMOTE"
  else
    echo "[backup] sem BACKUP_RCLONE_REMOTE: dump so no volume local"
  fi
}

if [ "${1:-}" = "agora" ]; then
  fazer_backup
  exit 0
fi

echo "[backup] agendado todo dia as ${HORA}:00 UTC, retencao ${RETENCAO} dias"
while true; do
  if [ "$(date -u +%H)" = "$HORA" ]; then
    fazer_backup || echo "[backup] FALHOU: $?"
    sleep 3600
  fi
  sleep 300
done
