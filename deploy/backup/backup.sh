#!/usr/bin/env bash
# Backup do Postgres do produto (etapa 13). Roda como servico do Compose:
# dorme ate a hora do backup, faz o pg_dump comprimido em /backups (volume
# roteiros_backups) e, se BACKUP_RCLONE_REMOTE estiver definido (ex.:
# "b2:roteiros-backups"), manda o dump DIARIO para o bucket e apaga de la o
# que passou da retencao do bucket. O mesmo dump serve para restaurar em
# outra maquina (receita de migracao em _compartilhado/INFRA-VPS.md).
#
# Dois tipos de dump (23/10/2026, depois que um dia de muitos deploys encheu
# o teto gratis de 10 GB do bucket e o envio passou a falhar com
# 403 storage_cap_exceeded):
#   - diario  : roteiros-AAAA-MM-DD-HHMM.sql.gz, o das 06:00 UTC. Vai para o
#               bucket. Fica 30 dias no volume.
#   - deploy  : roteiros-AAAA-MM-DD-HHMM-deploy.sql.gz, o de "agora", que o
#               deploy tira antes de cada subida. So no volume, 3 dias.
# Os dois casam com roteiros-*.sql.gz, o padrao que o ensaio e o
# restaurar.sh ja usam.
#
# Uso:
#   backup.sh                  laco do servico: um dump diario por dia
#   backup.sh agora            dump de deploy, so local (nunca falha por causa
#                              do bucket: so sai com erro se o dump local falhar)
#   backup.sh agora --enviar   o mesmo, mas manda tambem para o bucket
#   backup.sh diario           um dump diario na hora (envia e poda o bucket)
#   backup.sh podar-remoto     so apaga do bucket o que passou da retencao
#                              (para limpar um bucket cheio sem esperar as 06:00)
#
# Variaveis (do .env do Compose): DATABASE_URL, BACKUP_HORA_UTC (padrao 06,
# que e 03:00 em Brasilia), BACKUP_RETENCAO_DIAS (diarios no volume, padrao
# 30), BACKUP_RETENCAO_DEPLOY_DIAS (de deploy no volume, padrao 3),
# BACKUP_RCLONE_REMOTE (opcional), BACKUP_REMOTO_DIAS (retencao no bucket,
# padrao 14), as RCLONE_CONFIG_* do remoto, e BACKUP_DESTINO (padrao
# /backups, o volume do Compose; sobrescrito no teste local da etapa 13,
# decisao 2, rodando o script fora do container).
set -euo pipefail

HORA="${BACKUP_HORA_UTC:-06}"
DESTINO="${BACKUP_DESTINO:-/backups}"
REMOTO="${BACKUP_RCLONE_REMOTE:-}"

# Dias inteiros e pelo menos 1. Valor torto volta ao padrao, com aviso: um
# "0" na retencao do bucket apagaria o dump que acabou de subir.
dias() {
  local nome="$1" padrao="$2" valor="${!1:-}"
  if [ -z "$valor" ]; then
    echo "$padrao"
  elif [[ "$valor" =~ ^[0-9]+$ ]] && [ "$valor" -ge 1 ]; then
    echo "$valor"
  else
    echo "[backup] AVISO: $nome='$valor' nao e um numero de dias valido (1 ou mais); usando $padrao" >&2
    echo "$padrao"
  fi
}
RETENCAO="$(dias BACKUP_RETENCAO_DIAS 30)"
RETENCAO_DEPLOY="$(dias BACKUP_RETENCAO_DEPLOY_DIAS 3)"
REMOTO_DIAS="$(dias BACKUP_REMOTO_DIAS 14)"

mkdir -p "$DESTINO"

# pg_dump para um arquivo parcial e so entao renomeia: dump pela metade nunca
# ganha o nome de backup. Funcao chamada com "|| " desliga o set -e, por isso
# o status do pipeline (com pipefail) e conferido de proposito.
gerar_dump() {
  local final="$1" parcial="$1.parcial"
  echo "[backup] iniciando $final"
  if ! pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$parcial" || [ ! -s "$parcial" ]; then
    rm -f "$parcial"
    echo "[backup] ERRO: o pg_dump falhou; nenhum dump foi guardado" >&2
    return 1
  fi
  mv "$parcial" "$final"
  echo "[backup] ok, $(du -h "$final" | cut -f1)"
}

# Retencao do volume: os diarios por BACKUP_RETENCAO_DIAS, os de deploy por
# BACKUP_RETENCAO_DEPLOY_DIAS, parciais esquecidos depois de um dia. Em
# minutos, para o corte ser exato (-mtime arredonda para dias inteiros).
retencao_local() {
  find "$DESTINO" -maxdepth 1 -name 'roteiros-*.sql.gz' ! -name '*-deploy.sql.gz' -mmin +"$((RETENCAO * 1440))" -delete
  find "$DESTINO" -maxdepth 1 -name 'roteiros-*-deploy.sql.gz' -mmin +"$((RETENCAO_DEPLOY * 1440))" -delete
  find "$DESTINO" -maxdepth 1 -name 'roteiros-*.sql.gz.parcial' -mmin +1440 -delete
}

enviar_para_fora() {
  local arquivo="$1"
  if rclone copy "$arquivo" "$REMOTO"; then
    echo "[backup] copiado para $REMOTO"
  else
    echo "[backup] ERRO: o envio para $REMOTO falhou; o dump local esta guardado em $arquivo" >&2
    return 1
  fi
}

# Apaga do bucket os dumps com mais de BACKUP_REMOTO_DIAS dias. --b2-hard-delete
# porque no B2 o delete comum so esconde a versao e ela continua contando no
# espaco (pesquisa/plataformas/docs/rclone/b2-backblaze.md). Os filtros deixam
# de fora tudo que nao seja dump nosso e, em primeiro lugar, o arquivo que
# acabou de subir (regra "- nome" antes das outras: vale a primeira que casar).
# Depois, cleanup-hidden limpa versoes escondidas por apagamentos antigos.
podar_remoto() {
  local protegido="${1:-}" filtros=()
  [ -n "$protegido" ] && filtros+=(--filter "- $protegido")
  filtros+=(--filter "+ roteiros-*.sql.gz" --filter "- *")
  local status=0
  echo "[backup] apagando de $REMOTO os dumps com mais de ${REMOTO_DIAS} dias"
  rclone delete "$REMOTO" --min-age "${REMOTO_DIAS}d" --b2-hard-delete -v "${filtros[@]}" || status=1
  rclone backend cleanup-hidden "$REMOTO" || echo "[backup] AVISO: cleanup-hidden nao rodou (remoto que nao e B2?)" >&2
  if [ "$status" -ne 0 ]; then
    echo "[backup] ERRO: a poda de $REMOTO falhou" >&2
    return 1
  fi
}

# fazer_backup <diario|deploy> <enviar:1|0>
# So devolve erro se o dump local falhar. Falha no bucket (envio ou poda) e
# avisada no log mas nao derruba nada: o dump local ja esta guardado.
fazer_backup() {
  local tipo="$1" enviar="$2" sufixo=""
  [ "$tipo" = "deploy" ] && sufixo="-deploy"
  local arquivo="$DESTINO/roteiros-$(date -u +%Y-%m-%d-%H%M)${sufixo}.sql.gz"
  gerar_dump "$arquivo" || return 1
  retencao_local
  if [ "$enviar" != "1" ]; then
    echo "[backup] dump de $tipo: so no volume local (use 'agora --enviar' para mandar tambem para fora)"
  elif [ -z "$REMOTO" ]; then
    echo "[backup] sem BACKUP_RCLONE_REMOTE: dump so no volume local"
  else
    enviar_para_fora "$arquivo" || true
    # A poda roda mesmo se o envio falhou: com o bucket cheio e ela que abre espaco.
    podar_remoto "$(basename "$arquivo")" || true
  fi
  return 0
}

case "${1:-}" in
  agora)
    ENVIAR=0
    if [ "${2:-}" = "--enviar" ]; then ENVIAR=1; fi
    fazer_backup deploy "$ENVIAR"
    exit $?
    ;;
  diario)
    fazer_backup diario 1
    exit $?
    ;;
  podar-remoto)
    if [ -z "$REMOTO" ]; then
      echo "[backup] sem BACKUP_RCLONE_REMOTE: nada para podar" >&2
      exit 1
    fi
    podar_remoto
    exit $?
    ;;
  "") ;;
  *)
    echo "uso: backup.sh [agora [--enviar] | diario | podar-remoto]" >&2
    exit 2
    ;;
esac

echo "[backup] agendado todo dia as ${HORA}:00 UTC; volume: diarios ${RETENCAO} dias, de deploy ${RETENCAO_DEPLOY} dias; bucket: ${REMOTO_DIAS} dias"
while true; do
  if [ "$(date -u +%H)" = "$HORA" ]; then
    fazer_backup diario 1 || echo "[backup] FALHOU: $?"
    sleep 3600
  fi
  sleep 300
done
