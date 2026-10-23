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
| `reindexar-depois-da-troca.sh` | refaz e confere os indices do banco depois de trocar a imagem do Postgres (E17, uma vez; ver "Trocar a imagem do banco") |

As imagens sao construidas pelo GitHub Actions (`.github/workflows/imagem.yml`) a cada
merge na `main` e publicadas em `ghcr.io/ogusttavs/roteiros-virais/{app,worker,backup}`
com as tags `latest` e o sha curto. A VPS so puxa.

`roteiros-pot` (transcricao do YouTube, rodada 2): servico do `compose.prod.yml`, imagem de
terceiro (`brainicism/bgutil-ytdlp-pot-provider:2.0.0`, nao publicada por este projeto), so
na rede interna, sem porta publicada. O provedor de PO Token que o `yt-dlp` do worker usa
para baixar video/audio do YouTube com o cliente `mweb` (`src/jobs/youtube-cliente.ts`);
sem ele, o YouTube volta a bloquear com "Sign in to confirm you're not a bot".

`yt-dlp` no worker (V2a, item 4, 19/09/2026): instalado por `pip install "yt-dlp[default,curl-cffi]==<versao>"`,
nao mais o zipapp baixado do release. So por pip o yt-dlp consegue fazer impersonation de
navegador (extra `curl-cffi`), que o TikTok exige; o zipapp Unix nunca teve esse extra
disponivel, versao nenhuma (README do yt-dlp). Isso muda onde o plugin do provedor de PO
Token precisa ficar: o yt-dlp acha a pasta `yt-dlp-plugins` pelo diretorio do pacote Python
(`get_executable_path()`, achado do ensaio desta rodada: o primeiro build passou mas o
provedor sumiu da lista "PO Token Providers"), nao mais pelo diretorio do script em
`/usr/local/bin`; `Dockerfile.worker` calcula o caminho certo chamando essa mesma funcao em
build, em vez de supor o caminho fixo.

## Primeiro deploy (uma vez)

Ordem que aconteceu de verdade em 05/09/2026, com o painel indo ao ar em
`https://app.srv1953618.hstgr.cloud` (`acessos/VPS.md`, "Estado em 05/09/2026").

1. Endereco: dominio proprio com registro A de `app.<dominio>` para `179.199.142.54`, ou o
   curinga que a propria Hostinger ja da (`app.srv1953618.hstgr.cloud`), sem precisar de
   DNS proprio. Foi o curinga que este primeiro deploy usou; dominio proprio continua em
   aberto (`../../TODO.md`).
2. `/srv/roteiros/.env` na VPS (`chmod 600`), conferido chave a chave contra o
   `.env.example` atual: `APP_URL` e `BETTER_AUTH_URL` com o endereco escolhido,
   `EMAIL_CONTATO` (mostrado em `/termos` e `/privacidade`), `POSTGRES_PASSWORD` igual a
   senha da `DATABASE_URL`, e `SENTRY_DSN` quando a conta existir (etapa 13, decisao 1 e 5
   do `PROXIMO.md`). Sem dominio proprio verificado na Resend, `EMAIL_FROM` fica
   `onboarding@resend.dev` (remetente de teste, entrega so no e-mail do dono da conta
   Resend; a chave e so de envio e nao lista dominios, entao nao precisa trocar so por
   isso). Sem `EMAIL_CONTATO`, o texto mostra "contato@localhost"; sem `SENTRY_DSN`, o
   Sentry simplesmente nao inicia (nada quebra, nenhum erro vai para lugar nenhum alem do
   `docker logs`).
3. Snapshot da VPS pela API da Hostinger antes de tocar em qualquer coisa fora do proprio
   diretorio do produto, incluindo o proxy (`acessos/VPS.md`, convencao de convivencia).
4. Imagens publicadas (o workflow "Imagens" roda no merge; conferir em Actions).
5. `deploy/deploy.sh <sha>`, com o sha curto do commit que passou na CI, nunca `latest`:
   fixa exatamente a imagem testada, em vez de depender do que a `main` tiver quando o
   comando rodar.
6. Proxy compartilhado no ar (`/srv/proxy`, rede `web`): ver `proxy/`. Bloco `roteiros` do
   `Caddyfile` ativo com o endereco escolhido, validar e recarregar; ver "Editar o Caddyfile
   compartilhado" abaixo para a forma segura de editar o arquivo na VPS.
7. Primeiro admin, ninguem se cadastra sozinho (`scripts/criar-admin.ts`):
   ```bash
   ssh getorbita-vps 'cd /srv/roteiros && docker compose run --rm --no-deps \
     -e ADMIN_EMAIL=... -e ADMIN_NOME=... -e ADMIN_SENHA=... \
     roteiros-worker npm run -s admin:criar'
   ```
   Idempotente: rodar de novo com o mesmo `ADMIN_EMAIL` imprime "ja existe" e sai com 0.

## Deploys seguintes

```bash
deploy/deploy.sh <sha>      # sempre com o sha do commit que passou na CI (7 a 40 hexadecimais)
```

O script **exige o sha**: sem argumento, com `latest` ou com qualquer coisa que nao seja um sha,
recusa (codigo 2) antes de tocar na VPS. Voltar para uma versao anterior e o mesmo comando com o
sha dela (`acessos/DEPLOYS.md` guarda a lista). A regra existe desde 10/10/2026: um comentario de PR
com uma crase em aspas duplas executou o script sem argumento e subiu `latest` em producao.
`deploy/deploy.sh --conferir <sha>` so valida o argumento e sai.

## Editar o Caddyfile compartilhado

`/srv/proxy/Caddyfile` e de dois produtos (`acessos/VPS.md`, convencao de convivencia); cada
um so mexe no proprio bloco, marcado com o nome.

**Nunca `sed -i`.** O `docker-compose.yml` do proxy monta o arquivo como bind mount de um
arquivo so (`./Caddyfile:/etc/caddy/Caddyfile:ro`), e `sed -i` cria um arquivo novo e troca o
inode no lugar do antigo. O container continua com o inode velho aberto: `caddy validate` e
`caddy reload` rodam sem erro nenhum, mas leem a versao de antes da edicao, silenciosamente.

Editar com redirecionamento no mesmo arquivo (por exemplo `cat /tmp/novo > Caddyfile`, nunca
`mv`), depois conferir que bateu com o que o container realmente ve:

```bash
ssh getorbita-vps 'cd /srv/proxy && diff Caddyfile <(docker exec proxy-caddy-1 cat /etc/caddy/Caddyfile)'
```

Se divergir (a causa e sempre uma ferramenta que grava um arquivo novo e renomeia por cima
do antigo: `sed -i`, e varios editores de texto fazem o mesmo), recriar o container basta e
custa poucos segundos fora do ar, so deste produto no proxy:

```bash
ssh getorbita-vps 'cd /srv/proxy && docker compose up -d --force-recreate'
```

O e-mail de contato do bloco global (`{$CADDY_EMAIL:...}`) precisa ter um dominio de
verdade; `admin@localhost` e recusado tanto pelo Let's Encrypt quanto pelo ZeroSSL ("Domain
name needs at least one dot"), e nenhum certificado sai enquanto isso nao for corrigido.

## Operacao

```bash
ssh getorbita-vps 'cd /srv/roteiros && docker compose ps'
ssh getorbita-vps 'docker logs --tail 100 roteiros-app'
ssh getorbita-vps 'docker logs --tail 100 roteiros-worker'
ssh getorbita-vps 'docker exec roteiros-backup /usr/local/bin/backup.sh agora'
ssh getorbita-vps 'docker run --rm -v roteiros_backups:/b alpine ls -la /b'
```

A senha do primeiro admin foi gerada e gravada a mao pelo Fable, uma vez so, no deploy de
05/09/2026, em `/srv/roteiros/admin-inicial.senha` (`600`); o Gustavo le, guarda num
gerenciador de senhas e apaga o arquivo. `scripts/criar-admin.ts` nunca escreve esse
arquivo: para os proximos admins, quem roda `admin:criar` escolhe a senha em `ADMIN_SENHA`
e entrega por um canal seguro, nada fica gravado na maquina.

```bash
ssh getorbita-vps 'cat /srv/roteiros/admin-inicial.senha'
ssh getorbita-vps 'rm /srv/roteiros/admin-inicial.senha'
```

Trocar `EMAIL_FROM`, `SENTRY_DSN`, `YTDLP_PROXY` ou o bucket do backup (`BACKUP_RCLONE_REMOTE` e
`RCLONE_CONFIG_*`): editar `/srv/roteiros/.env` na VPS e subir de novo so o servico afetado.

```bash
ssh getorbita-vps 'cd /srv/roteiros && docker compose up -d roteiros-app roteiros-worker'   # EMAIL_FROM, SENTRY_DSN, YTDLP_PROXY
ssh getorbita-vps 'cd /srv/roteiros && docker compose up -d roteiros-backup'                # bucket do backup
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
worker (do jeito que `deploy.sh` faz), sobe o resto (inclusive `roteiros-pot`, o provedor de
PO Token), confere `/api/saude`, confere que o worker acha o `roteiros-pot` pela rede
interna (`yt-dlp -v --simulate` mostrando o provedor na lista, transcrição do YouTube,
rodada 2), confere que o `yt-dlp` da imagem tem alvo de impersonação disponível
(`yt-dlp --list-impersonate-targets`, V2a item 4; sem rede, só confere que o extra
`curl-cffi` foi instalado certo, o download de um TikTok de verdade é provado à parte, pela
rede do Gustavo), semeia, loga como o admin de exemplo e confere `/admin/clientes`, dispara
`coleta-noticias` de verdade três vezes (a segunda depois de um `stop`/`start` gracioso do
worker, a terceira depois de um `kill` abrupto), tira um backup e confere o dump. Para no
primeiro erro; imprime um resumo de uma linha por passo, com o tempo de cada um.

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

## A assinatura pelo Stripe (E22 PR 1)

Entra desligada: sem `COBRANCA_ATIVA=1` no `.env` da VPS ninguem e mandado para `/assinar`, mesmo com o resto no ar.

- **Variaveis** (`.env.example`, bloco "Assinatura pelo Stripe"): `STRIPE_SECRET_KEY` (chave restrita), `STRIPE_WEBHOOK_SECRET` e `COBRANCA_ATIVA`. Com `COBRANCA_ATIVA=1` em producao o app recusa subir sem as duas primeiras (`verificarSegredosDeProducao`).
- **O produto e o preco** (uma vez por modo, teste e producao): `npm run stripe:preparar` com a chave do modo certo. Idempotente; so cria o que leva `metadata.produto = roteiros` (produto `roteiros_plano_trimestral`, preco com a chave de busca `roteiros_trimestral`: R$ 1.191,00 a cada 3 meses). A chave de producao pede `--producao`.
- **O aviso (webhook)**: no painel do Stripe, um endpoint em `https://<endereco do app>/api/webhooks/stripe` para os eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`; o segredo dele (`whsec_`) vai em `STRIPE_WEBHOOK_SECRET`. A conta e dividida com o OdontoTech: os eventos dele chegam ao mesmo endpoint e sao ignorados (sem `metadata.produto = roteiros`).
- **Ligar o portao**: marcar as cortesias em `/admin/clientes/<id>` (Ajustes, "Cortesia") antes de pôr `COBRANCA_ATIVA=1` e reiniciar o app.
- **A prova ponta a ponta em modo teste, com a CLI do Stripe**: no PR da etapa.

## Trocar a imagem do banco (E17 parte 1, uma vez, so com o sim do Gustavo)

O banco passa de `postgres:16-alpine` para `pgvector/pgvector:0.8.7-pg16-bookworm` (a busca por significado precisa do pgvector). **Nao e um deploy comum.** A imagem nova e Debian (glibc), a antiga e Alpine (musl); o banco guarda a ordem do texto em indices, e essa ordem muda de um sistema para o outro. Sem refazer os indices, a busca por e-mail, `id_externo` ou `handle` pode errar e deixar duplicata entrar (medido em 22/10/2026: `bt_index_check` reprovou e uma consulta de faixa devolveu 0 linhas pelo indice contra 7 sem ele). Por isso o `deploy.sh` comum (que sobe o banco e ja migra com o app e o worker de pe) **nao** pode ser o deploy da troca. Detalhe, alternativas e motivos: `../../entregaveis/revisoes/e17-escopo.md`, secao 4.

Procedimento (na VPS, com o Gustavo avisado e o aplicativo parado):

1. `cd /srv/roteiros && docker compose stop roteiros-app roteiros-worker roteiros-backup` (o banco fica de pe).
2. Backup: `docker compose run --rm roteiros-backup agora` e copiar o dump para fora do volume. Mais o desfazer rapido, com o banco **parado** (`docker compose stop roteiros-postgres`): `docker run --rm -v roteiros_pg:/de -v roteiros_pg_antes:/para alpine cp -a /de/. /para/`. Voltar atras = devolver `postgres:16-alpine` ao compose e apontar o volume para `roteiros_pg_antes`.
3. Trocar o compose (`deploy.sh` copia o arquivo, mas sem subir nada: copiar a mao `compose.prod.yml` para `/srv/roteiros/docker-compose.yml`) e `docker compose pull roteiros-postgres && docker compose up -d roteiros-postgres`, sem subir o resto.
4. `deploy/reindexar-depois-da-troca.sh roteiros-postgres roteiros roteiros`. Recusa rodar com o app no ar; confere todos os indices no fim. **So seguir se terminar com "ok".**
5. `deploy/deploy.sh <sha>` normal (a migracao 0094 cria a extensao e a tabela de vetores).
6. A conferencia de sempre (saude, `/entrar`, sonda do admin, log, filas) e uma linha em `acessos/DEPLOYS.md`.

Ensaio antes de fazer de verdade (feito pela Central, nao pelo executor): restaurar o dump de producao mais recente num Postgres Alpine, parar, subir a imagem nova sobre o mesmo volume, rodar `reindexar-depois-da-troca.sh` e conferir que passa e que o app sobe em cima. `restaurar.sh` agora exige um destino com pgvector (restaurar num `postgres:16-alpine` comum falha no `CREATE EXTENSION`). **Nunca trocar a tag da imagem (por exemplo para outro Debian) sem repetir os passos 2 a 4.**

Quem desenvolve com o volume local antigo (`compose.dev.yml`): depois do `npm run db:up` com a imagem nova, rode `deploy/reindexar-depois-da-troca.sh roteiros-postgres roteiros_dev roteiros` (uma vez por banco que quiser guardar), ou apague o volume (`npm run db:down -- -v`, depois `npm run db:up` e `npm run db:reset`).

## O que nunca fazer

Build na VPS; publicar porta; mexer em `/srv/odontotech` ou no bloco do OdontoTech no
`Caddyfile`; commitar `.env`; deploy sem o Gustavo pedir.
