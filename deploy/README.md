# deploy: producao na VPS compartilhada

Leia antes `../../acessos/VPS.md` e `../../../_compartilhado/INFRA-VPS.md` (a regra de
convivencia com o OdontoTech manda). Sem segredo nesta pasta.

## O que ha aqui

| Arquivo | Para que |
|---|---|
| `Dockerfile` | imagem do app web (Next standalone) |
| `Dockerfile.worker` | imagem do worker (pg-boss, yt-dlp, ffmpeg) |
| `Dockerfile.backup` | imagem do backup (pg_dump diario, rclone opcional) |
| `backup/backup.sh` | o script do backup |
| `backup/restaurar.sh` | restaura um dump do `backup.sh` num banco vazio (etapa 13) |
| `compose.prod.yml` | o Compose de producao; vira `/srv/roteiros/docker-compose.yml` |
| `proxy/` | copia do proxy compartilhado (`/srv/proxy`): Caddy e `Caddyfile` |
| `deploy.sh` | o deploy, rodado deste Mac |

As imagens sao construidas pelo GitHub Actions (`.github/workflows/imagem.yml`) a cada
merge na `main` e publicadas em `ghcr.io/ogusttavs/roteiros-virais/{app,worker,backup}`
com as tags `latest` e o sha curto. A VPS so puxa.

## Primeiro deploy (uma vez)

1. Dominio com registro A de `app.<dominio>` para `179.199.142.54`.
2. `/srv/roteiros/.env` na VPS (`chmod 600`), com `APP_URL`, `BETTER_AUTH_URL` e
   `EMAIL_FROM` ja com o dominio, `EMAIL_CONTATO` (mostrado em `/termos` e `/privacidade`),
   `POSTGRES_PASSWORD` igual a senha da `DATABASE_URL`, e `SENTRY_DSN` quando a conta
   existir (etapa 13, decisao 1 e 5 do `PROXIMO.md`). Sem `EMAIL_CONTATO`, o texto mostra
   "contato@localhost"; sem `SENTRY_DSN`, o Sentry simplesmente nao inicia (nada quebra,
   nenhum erro vai para lugar nenhum alem do `docker logs`).
3. Proxy compartilhado no ar (`/srv/proxy`, rede `web`): ver `proxy/`. Descomentar o bloco
   `roteiros` no `Caddyfile` com o dominio, validar e recarregar.
4. Imagens publicadas (o workflow roda no merge; conferir em Actions).
5. `deploy/deploy.sh`.

## Deploys seguintes

```bash
deploy/deploy.sh            # latest
deploy/deploy.sh <sha>      # voltar para um commit especifico
```

## Operacao

```bash
ssh getorbita-vps 'cd /srv/roteiros && docker compose ps'
ssh getorbita-vps 'docker logs --tail 100 roteiros-app'
ssh getorbita-vps 'docker logs --tail 100 roteiros-worker'
ssh getorbita-vps 'docker exec roteiros-backup /usr/local/bin/backup.sh agora'
ssh getorbita-vps 'docker run --rm -v roteiros_backups:/b alpine ls -la /b'
```

Restaurar um dump num Postgres local (e o teste de restauracao, etapa 13, decisao 2):

```bash
# 1. pegar o dump da VPS (docker cp funciona tambem, direto do volume)
scp getorbita-vps:/var/lib/docker/volumes/roteiros_backups/_data/<arquivo>.sql.gz .

# 2. banco vazio local
docker exec roteiros-postgres createdb -U roteiros roteiros_restaurado

# 3. restaurar (recusa se o banco de destino ja tiver a tabela "clientes";
#    --forcar=<nome-do-banco> derruba e recria o banco antes de restaurar
#    por cima, exigindo o nome exato como confirmacao)
deploy/backup/restaurar.sh <arquivo>.sql.gz \
  postgres://roteiros:roteiros@localhost:5432/roteiros_restaurado

# 4. subir o app apontando para ele (porta livre, .claude/launch.json tem
#    um exemplo, "dev-mock-restaurado")
DATABASE_URL=postgres://roteiros:roteiros@localhost:5432/roteiros_restaurado \
  PORT=3413 npm run dev

# 5. apagar quando terminar
docker exec roteiros-postgres psql -U roteiros -d postgres -c "drop database roteiros_restaurado;"
```

`restaurar.sh` precisa de `psql` na maquina que roda o script. Se a versao local do
`psql`/`pg_dump` for bem mais nova que o Postgres 16 do Compose (comum com o Homebrew), o
dump pode trazer uma opcao de sessao que o servidor mais velho nao reconhece
(`transaction_timeout`, por exemplo); nesse caso gere o dump com a propria imagem do backup
em vez do `psql` do host:

```bash
docker build -f deploy/Dockerfile.backup -t roteiros-backup-local .
docker run --rm --network plataforma_default -v "$(pwd)/dump:/backups" \
  -e DATABASE_URL=postgres://roteiros:roteiros@roteiros-postgres:5432/roteiros_dev \
  roteiros-backup-local agora
```

Testado nesta etapa: dump do `roteiros_dev` semeado, restaurado em `roteiros_restaurado`,
app subindo na porta 3413 e `/hoje` abrindo com o cliente de seed. Anotado no PR.

## Ensaio local antes do deploy (etapa 13, parte 3)

`deploy/ensaio/` sobe o Compose de produção inteiro nesta máquina, com as imagens
construídas da árvore atual (nunca as do GHCR) e publicadas só em `127.0.0.1:3500`, para
provar antes de subir na VPS os dois critérios de aceite da etapa 13 que só tinham sido
provados em unidade ou por documento: o worker volta sozinho depois de cair, e o job
seguinte roda.

```bash
cp deploy/ensaio/.env.ensaio.exemplo deploy/ensaio/.env.ensaio   # so segredo de teste
deploy/ensaio/ensaiar.sh              # builda, sobe, migra, semeia, testa, derruba tudo
deploy/ensaio/ensaiar.sh --manter     # mesma coisa, mas deixa o Compose no ar no fim
```

Builda as três imagens, garante a rede `web`, sobe o Postgres, migra pelo container do
worker (do jeito que `deploy.sh` faz), sobe o resto, confere `/api/saude`, semeia, loga
como o admin de exemplo e confere `/admin/clientes`, dispara `coleta-noticias` de verdade
três vezes (a segunda depois de um `stop`/`start` gracioso do worker, a terceira depois de
um `kill` abrupto), tira um backup e confere o dump. Para no primeiro erro; imprime um
resumo de uma linha por passo, com o tempo de cada um.

**Achados desta rodada, corrigidos no próprio Dockerfile/Compose (não só no ensaio):**
- `container_name: roteiros-postgres` (e os outros três) do `compose.prod.yml` colidiam
  com os containers de `compose.dev.yml`, que usam os mesmos nomes literais e costumam
  estar rodando. `deploy/ensaio/compose.ensaio.yml` dá um sufixo `-ensaio` aos quatro, só
  para o ensaio; `compose.prod.yml` continua como está, correto para a VPS.
- `Dockerfile.worker` rodava `CMD ["npm", "run", "worker"]`; o `npm run` passa por um
  `sh -c` no meio que não repassa `SIGTERM` para o processo Node de verdade (o log só
  mostrava `npm error signal SIGTERM`, nunca o "parando com graça" de
  `src/jobs/desligamento.ts`). Isso valia para todo `docker compose stop`, ou seja, todo
  deploy: o worker nunca tinha a chance de terminar o job em andamento antes do Docker
  matar o processo. Corrigido para rodar o binário do `tsx` direto
  (`node_modules/.bin/tsx`), sem `npm`/`sh` no meio; confirmado com o log mostrando a
  frase certa depois de um `docker compose stop`.

**Por que o ensaio mata o processo, não o container.** `docker kill` (e `docker compose
stop`/`kill`) são parada manual pela API do Docker; a política de `restart` é ignorada
depois de uma parada manual, em qualquer plataforma, até o daemon reiniciar ou o
container ser reiniciado à mão de novo (documentação do Docker,
[restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/)).
Uma primeira versão deste ensaio matava o container pela API e via ele nunca voltar,
achado que a revisão corrigiu: o critério certo é uma queda de verdade do **processo**, de
dentro do container, sem passar pela API. `ensaiar.sh` acha o processo Node que o `tsx`
sobe para rodar o worker (PID 1 é o próprio `tsx`; o worker de verdade é um filho dele,
achado por `PPid` em `/proc/<pid>/status`, nunca por nome de processo: a imagem não tem
`ps`, e o `comm` do Node é "MainThread") e manda `kill -9` nele. O Docker vê o processo
sair sozinho e reinicia o container de verdade: o critério é `RestartCount` subindo (0
para 1 ou mais) e o log mostrando "worker no ar" de novo.

## O que nunca fazer

Build na VPS; publicar porta; mexer em `/srv/odontotech` ou no bloco do OdontoTech no
`Caddyfile`; commitar `.env`; deploy sem o Gustavo pedir.
