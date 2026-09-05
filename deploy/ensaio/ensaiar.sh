#!/usr/bin/env bash
# Ensaio local do Compose de producao (etapa 13, parte 3 do PROXIMO.md):
# builda as tres imagens da arvore atual, sobe o Compose de producao com o
# override deste diretorio (porta publicada em 127.0.0.1:3500, tags locais),
# migra e semeia pelo container, dispara um job de verdade, prova que o
# worker volta sozinho depois de uma queda abrupta, tira um backup, e
# derruba tudo no fim (a nao ser que --manter seja passado). Para no
# primeiro erro (set -e); cada passo imprime uma linha de resumo com o
# tempo que levou.
#
# Uso: deploy/ensaio/ensaiar.sh [--manter]
# Precisa de deploy/ensaio/.env.ensaio (copie de .env.ensaio.exemplo).
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
ENV_ENSAIO="$AQUI/.env.ensaio"
ENV_TEMP="$RAIZ/deploy/.env"
COMPOSE=(docker compose -f "$RAIZ/deploy/compose.prod.yml" -f "$AQUI/compose.ensaio.yml")
PORTA=3500
BASE_URL="http://127.0.0.1:$PORTA"
MANTER=0
[ "${1:-}" = "--manter" ] && MANTER=1

# Marca se este script foi quem criou deploy/.env, para o limpar() so
# apagar o que ele mesmo criou (ajuste da revisao desta etapa: o script
# apagava deploy/.env no fim sem conferir se ja existia antes, o que
# derrubaria um segredo de verdade que por acaso estivesse la).
CRIOU_ENV_TEMP=0

cd "$RAIZ"

INICIO_TOTAL=$(date +%s)
declare -a RESUMO

passo() {
  local nome="$1"
  local inicio=$(date +%s)
  echo ">> $nome"
  shift
  if "$@"; then
    local fim=$(date +%s)
    RESUMO+=("[ok] $nome ($((fim - inicio))s)")
  else
    local fim=$(date +%s)
    RESUMO+=("[falhou] $nome ($((fim - inicio))s)")
    imprimir_resumo
    exit 1
  fi
}

imprimir_resumo() {
  echo
  echo "== resumo do ensaio =="
  for linha in "${RESUMO[@]}"; do echo "$linha"; done
  echo "tempo total: $(($(date +%s) - INICIO_TOTAL))s"
}

limpar() {
  [ "$CRIOU_ENV_TEMP" = "1" ] && rm -f "$ENV_TEMP"
  if [ "$MANTER" = "0" ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap limpar EXIT

conferir_env() {
  [ -f "$ENV_ENSAIO" ] || {
    echo "faltou $ENV_ENSAIO; copie de .env.ensaio.exemplo antes de rodar." >&2
    return 1
  }
  for chave in BETTER_AUTH_SECRET JOBS_API_KEY POSTGRES_PASSWORD; do
    valor=$(grep "^${chave}=" "$ENV_ENSAIO" | cut -d= -f2-)
    if [ "${#valor}" -lt 32 ]; then
      echo "$chave em $ENV_ENSAIO tem menos de 32 caracteres." >&2
      return 1
    fi
  done
}

conferir_deploy_env_nao_existe() {
  if [ -f "$ENV_TEMP" ]; then
    echo "ja existe $ENV_TEMP; o ensaio nao sobrescreve arquivo de segredo, apague ou mova antes." >&2
    return 1
  fi
}

buildar_imagens() {
  docker build -f deploy/Dockerfile -t roteiros-app:ensaio --build-arg GIT_SHA=ensaio . || return 1
  docker build -f deploy/Dockerfile.worker -t roteiros-worker:ensaio --build-arg GIT_SHA=ensaio . || return 1
  docker build -f deploy/Dockerfile.backup -t roteiros-backup:ensaio . || return 1
}

garantir_rede_web() {
  docker network inspect web >/dev/null 2>&1 || docker network create web
}

subir_postgres() {
  cp "$ENV_ENSAIO" "$ENV_TEMP"
  CRIOU_ENV_TEMP=1
  "${COMPOSE[@]}" up -d roteiros-postgres
  for _ in $(seq 1 30); do
    estado=$("${COMPOSE[@]}" ps --format '{{.Health}}' roteiros-postgres)
    [ "$estado" = "healthy" ] && return 0
    sleep 2
  done
  echo "postgres nao ficou saudavel a tempo" >&2
  return 1
}

migrar() {
  "${COMPOSE[@]}" run --rm --no-deps roteiros-worker npm run -s db:migrate
}

subir_resto() {
  "${COMPOSE[@]}" up -d --remove-orphans
}

conferir_saude() {
  for _ in $(seq 1 30); do
    codigo=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/saude" || true)
    [ "$codigo" = "200" ] && return 0
    sleep 2
  done
  echo "/api/saude nao respondeu 200 em 60s" >&2
  "${COMPOSE[@]}" logs --tail 60 roteiros-app >&2
  return 1
}

semear() {
  "${COMPOSE[@]}" exec -T roteiros-worker npm run -s db:seed
}

conferir_login_admin() {
  local resposta cookie codigo
  resposta=$(curl -s -i -X POST "$BASE_URL/api/auth/sign-in/email" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@exemplo.teste","password":"ExemploSenha123"}')
  cookie=$(printf '%s' "$resposta" | grep -i '^set-cookie:' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/' | tr -d '\r' | paste -sd '; ' -)
  if [ -z "$cookie" ]; then
    echo "login do admin de seed nao devolveu cookie de sessao" >&2
    printf '%s\n' "$resposta" >&2
    return 1
  fi
  codigo=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $cookie" "$BASE_URL/admin/clientes")
  [ "$codigo" = "200" ] || {
    echo "GET /admin/clientes com o cookie do admin devolveu $codigo, esperava 200" >&2
    return 1
  }
}

disparar_job() {
  local chave
  chave=$(grep '^JOBS_API_KEY=' "$ENV_ENSAIO" | cut -d= -f2-)
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE_URL/api/jobs/coleta-noticias" -H "x-jobs-key: $chave"
}

esperar_execucao_ok() {
  local desde_epoch="$1"
  for _ in $(seq 1 60); do
    status=$("${COMPOSE[@]}" exec -T roteiros-postgres psql -U roteiros -d roteiros -tA \
      -c "select status from execucoes_job where nome='coleta-noticias' and extract(epoch from iniciado_em) >= ${desde_epoch} order by iniciado_em desc limit 1;" \
      2>/dev/null | tr -d '[:space:]')
    [ "$status" = "ok" ] && return 0
    [ "$status" = "erro" ] && {
      echo "execucao de coleta-noticias terminou com erro" >&2
      return 1
    }
    sleep 2
  done
  echo "coleta-noticias nao terminou ok em 2 minutos (ultimo status: ${status:-nenhum})" >&2
  return 1
}

disparar_e_esperar_job() {
  local desde codigo
  desde=$(date +%s)
  codigo=$(disparar_job)
  [ "$codigo" = "202" ] || {
    echo "POST /api/jobs/coleta-noticias devolveu $codigo, esperava 202" >&2
    return 1
  }
  esperar_execucao_ok "$desde"
}

worker_desligou_com_graca() {
  "${COMPOSE[@]}" stop roteiros-worker
  "${COMPOSE[@]}" logs roteiros-worker 2>/dev/null | grep -q "parando com graca" || {
    echo "log do worker nao mostrou 'parando com graca' apos o stop" >&2
    return 1
  }
  "${COMPOSE[@]}" start roteiros-worker
}

# Mata o processo Node que o tsx sobe para rodar o worker de verdade, de
# dentro do container, sem passar pela API do Docker (ajuste da revisao
# desta etapa: "docker kill" e "docker compose stop/kill" contam como
# parada manual, e a politica de restart e ignorada depois de uma parada
# manual em qualquer plataforma, nao so no Docker Desktop, ate o daemon
# reiniciar ou o container ser reiniciado a mao; documentacao do Docker,
# restart policies). O PID 1 do container e o proprio tsx
# (node node_modules/.bin/tsx src/jobs/worker.ts); ele sobe o worker de
# verdade num processo Node filho (PPid 1) e ainda tem um neto esbuild. A
# imagem e node:24-slim, sem "ps", e o "comm" do processo Node e
# "MainThread", nao "node": o alvo certo e achado por /proc/<pid>/status
# (PPid igual a 1) e /proc/<pid>/cmdline (comeca com /usr/local/bin/node).
matar_processo_do_tsx() {
  "${COMPOSE[@]}" exec -T roteiros-worker sh -c '
    for entrada in /proc/[0-9]*; do
      pid=${entrada#/proc/}
      [ -r "/proc/$pid/status" ] || continue
      linha=$(grep "^PPid:" "/proc/$pid/status" 2>/dev/null)
      ppid=$(echo ${linha#PPid:})
      if [ "$ppid" = "1" ]; then
        cmd=$(tr "\0" " " < "/proc/$pid/cmdline" 2>/dev/null)
        case "$cmd" in
          /usr/local/bin/node*) kill -9 "$pid" ;;
        esac
      fi
    done
  '
}

worker_volta_sozinho_apos_kill() {
  local antes depois
  antes=$(docker inspect -f '{{.RestartCount}}' roteiros-worker-ensaio)
  echo "RestartCount antes: $antes"
  matar_processo_do_tsx
  for _ in $(seq 1 30); do
    depois=$(docker inspect -f '{{.RestartCount}}' roteiros-worker-ensaio 2>/dev/null || echo "$antes")
    rodando=$(docker inspect -f '{{.State.Running}}' roteiros-worker-ensaio 2>/dev/null || echo false)
    if [ "$depois" -gt "$antes" ] && [ "$rodando" = "true" ]; then
      echo "RestartCount depois: $depois (State.Running=true)"
      "${COMPOSE[@]}" logs roteiros-worker 2>/dev/null | grep -q "worker no ar" || {
        echo "RestartCount subiu, mas o log nao mostrou 'worker no ar' de novo" >&2
        return 1
      }
      return 0
    fi
    sleep 2
  done
  echo "o worker nao reiniciou sozinho em 60s (RestartCount ficou em $antes)" >&2
  return 1
}

fazer_backup() {
  "${COMPOSE[@]}" exec -T roteiros-backup /usr/local/bin/backup.sh agora
  local dump
  dump=$("${COMPOSE[@]}" exec -T roteiros-backup sh -c 'ls -1 /backups/roteiros-*.sql.gz 2>/dev/null | tail -1')
  [ -n "$dump" ] || {
    echo "backup.sh rodou mas nenhum dump apareceu em /backups" >&2
    return 1
  }
  echo "dump: $(echo "$dump" | tr -d '\r')"
}

passo "confere .env.ensaio (segredos de 32+ caracteres)" conferir_env
passo "confere que deploy/.env nao existe (nunca sobrescrever segredo)" conferir_deploy_env_nao_existe
passo "builda as tres imagens (roteiros-app, roteiros-worker, roteiros-backup :ensaio)" buildar_imagens
passo "garante a rede externa 'web'" garantir_rede_web
passo "sobe o postgres e espera ficar saudavel" subir_postgres
passo "migra o banco pelo container do worker" migrar
passo "sobe o app, o worker e o backup" subir_resto
passo "confere /api/saude em $BASE_URL" conferir_saude
passo "semeia o banco pelo container do worker" semear
passo "login do admin de seed e GET /admin/clientes com o cookie" conferir_login_admin
passo "dispara coleta-noticias e espera terminar ok (1a vez)" disparar_e_esperar_job
passo "para o worker (SIGTERM), confere 'parando com graca', e inicia de novo" worker_desligou_com_graca
passo "dispara coleta-noticias e espera terminar ok (2a vez, depois do stop/start)" disparar_e_esperar_job
passo "mata o processo do worker de dentro do container e confere que o Compose sobe sozinho" worker_volta_sozinho_apos_kill
passo "dispara coleta-noticias e espera terminar ok (3a vez, depois do kill)" disparar_e_esperar_job
passo "roda o backup.sh e confere o dump no volume" fazer_backup

imprimir_resumo
echo
if [ "$MANTER" = "1" ]; then
  echo "--manter: o Compose fica no ar (docker compose -f deploy/compose.prod.yml -f deploy/ensaio/compose.ensaio.yml ... para mexer; 'down -v' quando terminar)."
else
  echo "derrubando tudo (sem --manter)."
fi
