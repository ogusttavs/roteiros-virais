# deploy: producao na VPS compartilhada

Leia antes `../../acessos/VPS.md` e `../../../_compartilhado/INFRA-VPS.md` (a regra de
convivencia com o OdontoTech manda). Sem segredo nesta pasta.

## O que ha aqui

| Arquivo | Para que |
|---|---|
| `Dockerfile` | imagem do app web (Next standalone) |
| `Dockerfile.worker` | imagem do worker (pg-boss, yt-dlp, ffmpeg) |
| `Dockerfile.backup` | imagem do backup (pg_dump diario, rclone opcional para o bucket) |
| `backup/backup.sh` | o script do backup: dump diario (vai ao bucket) e dump de deploy (so no volume), com retencao nos dois lugares |
| `backup/restaurar.sh` | restaura um dump do `backup.sh` num banco vazio (etapa 13) |
| `compose.prod.yml` | o Compose de producao; vira `/srv/roteiros/docker-compose.yml` |
| `proxy/` | copia do proxy compartilhado (`/srv/proxy`): Caddy e `Caddyfile` |
| `deploy.sh` | o deploy, rodado deste Mac |

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

### Backup: o que vai para onde (23/10/2026)

Dois tipos de dump, os dois casam com `roteiros-*.sql.gz` (o que o ensaio e o `restaurar.sh` leem):

| Tipo | Nome | Quem faz | Vai ao Backblaze | Fica no volume |
|---|---|---|---|---|
| diario | `roteiros-AAAA-MM-DD-HHMM.sql.gz` | o laco do servico, as 06:00 UTC (`backup.sh diario` faz um na hora) | sim | 30 dias (`BACKUP_RETENCAO_DIAS`) |
| de deploy | `roteiros-AAAA-MM-DD-HHMM-deploy.sql.gz` | `backup.sh agora`, o que o deploy chama antes de subir | nao (so com `agora --enviar`) | 3 dias (`BACKUP_RETENCAO_DEPLOY_DIAS`) |

Por que: num dia de muitos deploys cada `agora` mandava mais um dump de uns 385 MB e o bucket
(teto gratis de 10 GB) encheu; o envio passou a falhar com `403 storage_cap_exceeded` e o
`agora` saia com erro, o que travava o deploy. Agora:

- `agora` so sai com erro se o `pg_dump` local falhar. Bucket cheio, fora do ar ou sem credencial
  nunca derruba o deploy; o log mostra `ERRO` e o dump local fica guardado.
- Depois de enviar o diario, o script apaga do bucket os dumps com mais de `BACKUP_REMOTO_DIAS`
  dias (padrao 14) com `rclone delete --min-age ... --b2-hard-delete`. No B2 o apagar comum so
  esconde a versao e ela continua contando no espaco; `--b2-hard-delete` tira de verdade
  (fonte: `pesquisa/plataformas/docs/rclone/b2-backblaze.md`, baixada em 23/10/2026). Os filtros
  deixam de fora o arquivo que acabou de subir e tudo que nao seja `roteiros-*.sql.gz`. Em
  seguida roda `rclone backend cleanup-hidden` para limpar versoes escondidas por apagamentos
  antigos. A poda roda mesmo se o envio falhou (com o bucket cheio e ela que abre espaco).
- `BACKUP_REMOTO_DIAS`, `BACKUP_RETENCAO_DIAS` e `BACKUP_RETENCAO_DEPLOY_DIAS` precisam ser inteiros
  de 1 em diante; valor torto volta ao padrao com um aviso no log (um `0` apagaria o dump novo).
- Os nomes antigos (sem `-deploy`) contam como diarios e saem do volume em 30 dias; quem quiser
  liberar o espaco antes apaga a mao os que nao forem das 06:00.

Comandos do dia a dia na VPS (a imagem nova so existe depois do deploy; `agora` com a imagem antiga
ainda manda para o bucket):

```bash
ssh getorbita-vps 'docker exec roteiros-backup /usr/local/bin/backup.sh podar-remoto'   # so a poda do bucket, sem dump
ssh getorbita-vps 'docker exec roteiros-backup /usr/local/bin/backup.sh agora --enviar'  # dump de deploy que tambem vai ao bucket
ssh getorbita-vps 'docker exec roteiros-backup /usr/local/bin/backup.sh diario'          # um diario na hora, com envio e poda
ssh getorbita-vps 'docker exec roteiros-backup sh -c "rclone size \$BACKUP_RCLONE_REMOTE; rclone lsl \$BACKUP_RCLONE_REMOTE"'  # quanto o bucket guarda
```

Testes: `scripts/backup-so-diario.test.ts` roda o script com `pg_dump` e `rclone` de mentira
(quem foi chamado, com que argumentos, o que sobrou no volume). O ensaio
(`deploy/ensaio/ensaiar.sh`) roda `agora` e `diario` e confere os dois nomes no volume; ele nao
tem bucket, entao o envio e a poda so sao provados pelo teste e pela conferencia na VPS.

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

**O que o worker novo faz com o que o morto deixou (22/10/2026).** Um `kill -9` no meio de um
job deixa a linha dele `active` no pg-boss e a execução "rodando" em `execucoes_job`. Ao subir,
o worker (`src/jobs/orfaos.ts`) dá os `active` como falhos e fecha as execuções presas; isso
vale porque existe um worker só (o Compose para o antigo antes de criar o novo): nunca suba
um segundo `roteiros-worker`. Como segunda rede, toda fila tem pulso (`heartbeatSeconds` 180):
sem pulso, o monitor do pg-boss dá o job como falho em 3 a 4 minutos. O disparo de fora
(`POST /api/jobs/<nome>`, `src/jobs/disparo.ts`) só recusa quando já há um igual na fila ou
rodando; não há janela de tempo, e o ensaio agora reprova um `202` com `"duplicado":true`.

## A assinatura pelo Stripe (E22 PR 1)

Entra desligada: sem `COBRANCA_ATIVA=1` no `.env` da VPS ninguem e mandado para `/assinar`, mesmo com o resto no ar.

- **Variaveis** (`.env.example`, bloco "Assinatura pelo Stripe"): `STRIPE_SECRET_KEY` (chave restrita), `STRIPE_WEBHOOK_SECRET` e `COBRANCA_ATIVA`. Com `COBRANCA_ATIVA=1` em producao o app recusa subir sem as duas primeiras (`verificarSegredosDeProducao`).
- **O produto e o preco** (uma vez por modo, teste e producao): `npm run stripe:preparar` com a chave do modo certo. Idempotente; so cria o que leva `metadata.produto = roteiros` (produto `roteiros_plano_trimestral`, preco com a chave de busca `roteiros_trimestral`: R$ 1.191,00 a cada 3 meses). A chave de producao pede `--producao`. **O nome na fatura do cartao (23/10/2026):** o mesmo comando poe no produto `roteiros_plano_trimestral` o `statement_descriptor` vindo de `APP_NAME` em maiusculas, sem acento, so letras, numeros e espacos, de 5 a 22 caracteres (hoje `KLAKI`); se o produto ja existe com outro descritor (ou sem), so ele e atualizado, e so se levar `metadata.produto = roteiros`. O descritor da conta, que e do OdontoTech tambem, nao muda. Para assinatura o Stripe nao aceita descritor no PaymentIntent nem sufixo no Checkout: vem da fatura ou do produto (`pesquisa/plataformas/docs/stripe/descritor-na-fatura.md`). Trocar o nome do app depois: mudar `APP_NAME` e rodar o comando de novo. Aplicar: `APP_NAME=Klaki STRIPE_SECRET_KEY=<chave do modo> npm run stripe:preparar` (modo teste) e o mesmo com a chave de producao e `-- --producao`.
- **O aviso (webhook)**: no painel do Stripe, um endpoint em `https://<endereco do app>/api/webhooks/stripe` para os eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`; o segredo dele (`whsec_`) vai em `STRIPE_WEBHOOK_SECRET`. A conta e dividida com o OdontoTech: os eventos dele chegam ao mesmo endpoint e sao ignorados (sem `metadata.produto = roteiros`).
- **Ligar o portao**: marcar as cortesias em `/admin/clientes/<id>` (Ajustes, "Cortesia") antes de pôr `COBRANCA_ATIVA=1` e reiniciar o app.
- **A prova ponta a ponta em modo teste, com a CLI do Stripe**: no PR da etapa.
- **O portal do cliente (E22 PR 2)**: `npm run stripe:preparar` tambem acha ou cria a configuracao do portal PROPRIA do Roteiros (`metadata.produto = roteiros`: cartao, faturas, e-mail e cancelar no fim do periodo; sem trocar de plano). A padrao da conta e do OdontoTech: o app nunca a usa, e sem a nossa o portal nao abre (erro, nao reserva). A chave restrita precisa de permissao de escrita em "Customer portal" e leitura de "Checkout Sessions" e "Subscriptions" (escrita para cancelar/expirar).
- **Um Checkout por marca**: a sessao aberta fica em `checkouts_stripe` (migracao 0095, so `CREATE TABLE`); o segundo clique em Assinar a reaproveita se o Stripe ainda a diz aberta.
- **O portao fora do layout**: toda Server Action do painel e toda rota `/api` chama `exigirAssinaturaValida` / `recusaDaCobranca` (`src/lib/portao-cobranca.ts`); `npm run checar-portao-cobranca` (na CI) reprova a que esquecer. Desligado, nada muda.
- **Apagar uma marca**: so por `npm run marca:apagar -- <id> --confirmo` (cancela a assinatura no Stripe antes e so apaga se o Stripe confirmar). **Nunca apague a linha de `clientes` por SQL**: sem cancelar no Stripe antes, ele continua cobrando (desde a E22 PR 3 o banco recusa apagar a marca que ainda tem linha em `assinaturas`, `ON DELETE RESTRICT`).

## O Instagram ligado direto pelo Instagram, sem Facebook (E19b, 27/10/2026)

Troca a via da ligacao: a pessoa entra com o login do Instagram (API do Instagram com o Login do Instagram, `graph.instagram.com`), sem Pagina do Facebook. A via do Facebook da E19 continua no codigo, **desligada por padrao** (`META_VIA_FACEBOOK=1` para ligar). Nao havia conta ligada em producao quando a troca foi feita.

- **Variaveis novas** (`.env.example`, bloco "E19b"): `META_IG_APP_ID` e `META_IG_APP_SECRET` (os do PRODUTO Instagram do aplicativo, diferentes dos do Facebook), juntos com `META_TOKEN_CHAVE` (a mesma chave). Preencher alguma sem as outras faz o app recusar subir. `PUBLICAR_PASTA_TEMP` e opcional.
- **No aplicativo da Meta** (so o Gustavo): produto "Instagram" > "Configuracao da API com o login do Instagram" > "Configure o login da empresa no Instagram": a URI `<APP_URL>/api/meta/retorno` em "URIs de redirecionamento do OAuth" (a mesma da via antiga), e as tres permissoes `instagram_business_basic`, `instagram_business_manage_insights` e `instagram_business_content_publish`; em Funcoes do aplicativo, quem vai testar entra como "Testador do Instagram" e aceita o convite no Instagram dele; as URLs de "Cancelar autorizacao" e de "Solicitacao de exclusao de dados" apontam para `<APP_URL>/api/meta/exclusao` (assinadas com a chave secreta do app do Instagram, que o aplicativo ja confere).
- **O video de uma publicacao** fica em disco por poucas horas (o envio retomavel so existe na via do Facebook): a Meta o baixa por `<APP_URL>/api/publicar-arquivo/<codigo assinado>/video.mp4`, que precisa ser alcancavel da internet (o Caddy ja encaminha tudo). O arquivo some quando a publicacao termina, falha ou e cancelada; o que sobrar e varrido pela idade. Fica no volume nomeado `roteiros_publicar`, montado em `/var/publicar` no **app e no worker** (sao containers separados, cada um com o seu `/tmp`; o app guarda e serve o arquivo, o worker o apaga na conferencia): `PUBLICAR_PASTA_TEMP=/var/publicar` ja vem no `compose.prod.yml`, e as duas imagens criam a pasta aberta (`1777`) para o volume novo ser gravavel por qualquer um dos dois. Um video de ate 300 MB ocupa disco ate a publicacao terminar. A varredura do que ficou velho (mais de 6 horas) roda no app (ao comecar uma publicacao), no worker a cada conferencia e no job diario `renovar-contas-ligadas` (campo `videosVarridos` no resumo). **Primeiro deploy com este volume: `docker compose up -d` cria `roteiros_publicar` sozinho; nao ha o que migrar.**
- **Renovacao**: o job `renovar-contas-ligadas` usa `refresh_access_token` para as contas dessa via (60 dias a mais, pelo menos 24 horas depois da ligacao).

## A edicao de video pela IA: o volume e o ffprobe (E47 PR 2)

A pessoa sobe o video bruto pelo celular (`PUT /api/edicao/<id>/video`), o app o confere e o guarda, e o worker transcreve. Decisoes do Gustavo em 29/10/2026: **o bruto sai sozinho em 48 horas, o editado em 7 dias, ate 30 edicoes por mes por conta, video de ate 3 minutos e ate 1080p, sem musica no servidor.**

- **Volume `roteiros_edicao`**, montado em `/var/edicao` no **app e no worker** (`EDICAO_PASTA=/var/edicao` ja vem no `compose.prod.yml`). Dois subdiretorios: `bruto/` (`ed-<id>.video`) e `editado/` (`ed-<id>.mp4`, o video final) e `previa/` (`ed-<id>.mp4`, a previa 540p, que sai junto com o bruto). As duas imagens criam `/var/edicao` aberta (`1777`) para o volume novo ser gravavel pelo app (usuario sem privilegio) e pelo worker (root). **Primeiro deploy com este volume: `docker compose up -d` cria `roteiros_edicao` sozinho; nao ha o que migrar.** Disco: a 1080p o iPhone grava uns 65 MB por minuto; com 48 horas de guarda o bruto nao acumula (30 clientes gravando 1 minuto por dia ocupam uns 2 GB por dia, ~4 GB no pico). Vale um alarme de disco antes de abrir para muita gente.
- **`ffprobe` na imagem do app** (o pacote `ffmpeg` do Debian, `deploy/Dockerfile`): a rota confere duracao (ate 3 minutos), qualidade (o lado menor da imagem, ate 1080) e som, e recusa com uma frase clara o que nao serve. A imagem do app cresce com isso (uns 150 MB). O worker ja tinha o ffmpeg.
- **Limpeza**: o job `limpar-edicoes` roda de hora em hora (aos 25 minutos), apaga o bruto vencido (com as palavras e a curva de energia que estao no banco), o editado vencido, falha o envio parado e varre do volume todo arquivo sem dono (linha apagada, arquivo ja dado como apagado, `.parte` de envio que morreu). A linha da edicao continua, para a conta do mes. O resumo (so numeros) aparece em Rotinas, no admin.
- **Transcricao**: o job `transcrever-edicao` (por evento) extrai o audio a 16 kHz mono e chama a Groq com o tempo de cada palavra e um prompt de nomes tirado do briefing. O custo vai para `custos_externos` (em dolar) e os segundos de audio para `consumo_api` (fonte `groq`). Usa a `GROQ_API_KEY` que o worker ja tem.
- **O ensaio** (`deploy/ensaio/ensaiar.sh`) ganhou um passo: o app grava e o worker le e apaga em `/var/edicao`, `EDICAO_PASTA` aponta para o volume nos dois e a imagem do app tem o `ffprobe`.
- **Nao ha migracao que apague ou altere coluna**: so `CREATE TABLE edicoes` (migracao 0107).
- **Alarme do disco** (29/10/2026): o job `vigiar-disco` roda a cada 15 minutos no worker, mede o disco que o conteiner enxerga (`fs.statfs`, a mesma particao da VPS) e o tamanho de `/var/edicao` e `/var/publicar`, e avisa o admin por e-mail (Resend), pelo Sentry e pelo Inicio do admin: **atencao com 80% de uso e critico com 90%** (`DISCO_ATENCAO_PERCENTUAL` e `DISCO_CRITICO_PERCENTUAL`, opcionais). Um aviso por nivel por dia e um de "voltou ao normal" (com folga de 2 pontos para nao piscar). No critico a limpeza (`limpar-edicoes`) roda na hora e `PUT /api/edicao/<id>/video` recusa com 503 ("O envio de videos esta pausado por alguns minutos"); publicar no Instagram continua. Sem migracao (o estado fica em `configuracao_admin`) e sem volume novo.

## O render da edicao: o conteiner `roteiros-render` (E47 PR 4)

Depois que a decisao da edicao fica pronta (`verificado`), um conteiner novo monta a **previa 540p**; a pessoa assiste, aprova, e so entao ele monta o **video final 1080p**. Sem musica no servidor (decisao do Gustavo, 29/10/2026): a pessoa poe a musica no Instagram ou no TikTok ao postar.

- **O conteiner `roteiros-render`** usa a MESMA imagem do worker (`ghcr.io/.../worker`), com outro comando (`tsx src/jobs/worker-render.ts`). So consome a fila `renderizar-edicao`, **um video por vez**, e nao agenda nada. **`cpus: 1.0`** e a trava que impede o ffmpeg de roubar o processador do painel, do worker e do OdontoTech (a VPS e dividida): nunca aumente sem medir o `/api/saude` dos dois produtos durante um render. `mem_limit: 1500m`, `tmpfs /tmp` de 256 MB (so o arquivo de legenda e a fonte), mesmo volume `roteiros_edicao` do app e do worker, sem porta, so na rede interna. O worker comum NUNCA consome essa fila (`src/jobs/worker.test.ts` prova).
- **Tempo maximo**: o ffmpeg e morto (`SIGKILL`) em tres vezes o tempo esperado, com piso e teto (`limiteDoRenderMs`: previa de 90 s a 10 min, final de 3 a 30 min). A fila espera 45 minutos pelo job. Medido em 29/10/2026 com 1 vCPU (contêiner limitado, máquina de desenvolvimento, vídeo sintético de 60 s de bruto e 50 s de saída): prévia 0,5 s por segundo de vídeo em cor normal e 1,6 em HDR do iPhone; final 1080p 0,96 em cor normal e 5,2 em HDR (o conversor de cor do HDR é o que pesa; o vídeo sintético é mais leve de codificar que um vídeo de verdade, então o número real tende a ser um pouco maior). Falhou, a edicao volta para a vez e o job se enfileira de novo em 1 minuto; na terceira vez a edicao falha com uma frase e os arquivos saem.
- **Deploy no meio de um render**: ao subir, o conteiner recolhe (`recolherRendersOrfaos`) o que o anterior deixou montando e enfileira de novo na hora; a limpeza de hora em hora e a segunda rede (render sem sinal ha 40 minutos).
- **A fonte da legenda** (Montserrat Bold, SIL Open Font License) vem na imagem, em `src/edicao/fontes/`: a imagem do sistema nao traz nenhuma. O HDR do iPhone e convertido para cor normal (`zscale` e `tonemap`); se o ffmpeg do servidor nao tiver esses filtros, o render tenta uma vez mais sem a conversao.
- **Medir o render na VPS** (sem mandar video de ninguem para la): `ssh getorbita-vps 'docker exec roteiros-render npx tsx scripts/render-fumaca.ts --segundos 60 --hdr'`. Gera um video sintetico, monta a previa e o final como a producao monta e imprime o tempo de cada um e a razao tempo de render por segundo de video. Como o `exec` roda dentro do conteiner limitado, o numero e o de 1 vCPU. Para ver o painel aguentando, rode em paralelo `ssh getorbita-vps 'for i in 1 2 3 4 5; do docker exec roteiros-app curl -fsS -o /dev/null -w "%{time_total}
" http://localhost:3000/api/saude; sleep 5; done'`.
- **O ensaio** (`deploy/ensaio/ensaiar.sh`) ganhou um passo: o conteiner de render esta no ar com 1 vCPU, o ffmpeg dele tem `subtitles`, `xfade`, `zscale`, `tonemap` e `loudnorm`, a fonte esta na imagem, e um render DE VERDADE (video sintetico HDR, previa e final) sai com a duracao do plano.
- **Migracao**: so `ADD COLUMN` em `edicoes` (0109: `caminho_previa`, `progresso_do_render`, `tentativas_do_render`, `pedidos_de_ajuste`, `refeitas`). Volume novo: nenhum (a previa fica em `previa/` dentro de `roteiros_edicao`). **Primeiro deploy**: `docker compose up -d --remove-orphans` ja sobe o `roteiros-render` sozinho.

## O Instagram ligado pela propria pessoa (E19 PR 1)

Entra desligado: sem os quatro dados abaixo no `.env` da VPS, ninguem consegue comecar a ligacao (o botao do PR 2 diz que ainda nao esta aberta) e a curva segue pelo usuario do sistema e pelo Apify, como antes.

- **Variaveis** (`.env.example`, bloco "E19"): `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` e `META_TOKEN_CHAVE` (mais `META_REDIRECT_URI`, opcional). Em producao, preencher algum e nao todos, ou uma chave que nao tenha 32 bytes, faz o app recusar subir (`verificarSegredosDeProducao`). O web e o worker leem o mesmo `.env`; os dois precisam da chave (o worker le a curva e renova os acessos).
- **O aviso de aplicativo em teste** (E19 PR 2): `META_APP_APROVADO=1`, so quando a Meta aprovar o aplicativo para todo mundo. Sem ele, o cartao "Seu Instagram" da Conta avisa com calma que a ligacao direta ainda abre para poucas pessoas (so quem tem papel no aplicativo passa pelo dialogo da Meta em modo de desenvolvimento).
- **A chave dos acessos** (`META_TOKEN_CHAVE`): `openssl rand -base64 32`. Cifra o acesso de cada conta ligada (AES-256-GCM). Perdeu ou trocou a chave: as contas ligadas nao abrem mais e cada pessoa precisa ligar de novo (nada quebra, a curva cai para os outros caminhos). Guarde uma copia fora da VPS e nunca reuse a de outro ambiente.
- **No aplicativo da Meta** (so o Gustavo): a URI `<APP_URL>/api/meta/retorno` em URIs de redirecionamento OAuth validos; o dominio do app em Dominios do aplicativo; a URL `<APP_URL>/api/meta/exclusao` em "URL de solicitacao de exclusao de dados"; a configuracao de login (Login do Facebook para Empresas) com as quatro permissoes; o papel de quem vai testar. O passo a passo esta no corpo do PR.
- **Rotina**: o job `renovar-contas-ligadas` roda todo dia as 06:20 (renova o que vence em menos de 15 dias e avisa o dono por e-mail, uma vez, quando nao da mais). Rodar uma vez: `npm run job -- renovar-contas-ligadas`.

## As migracoes e o journal do Drizzle

- **Quem manda e o `when`, nao o `idx`.** O migrador aplica, em ordem, as entradas de `drizzle/meta/_journal.json` cuja data (`when`) e maior que a da ultima migracao ja aplicada naquele banco. Entao o `when` de cada entrada nova precisa ser maior que o da anterior; o `drizzle-kit generate` ja faz isso, e quem escrever uma entrada a mao tem de conferir.
- **O journal pula de `0089` para `0091`, e esta certo.** A `0090` foi gerada numa branch de 22/10/2026 e descartada antes de entrar na `main`; nunca existiu em nenhuma versao em producao. Nao renumerar: a `0091` e as seguintes ja foram aplicadas na VPS, e renumerar trocaria o nome de migracao ja registrada. O `drizzle-kit generate` usa o ultimo `idx` mais um, entao a numeracao segue de onde parou.
- Regra do deploy sem pedir (`CLAUDE.md` do projeto, regra 14): so migracao de `ADD COLUMN` ou `CREATE TABLE`.

## Limites conhecidos

- **Um processo web so.** A avaliacao do tema livre nao paga duas vezes o toque repetido porque a chamada em curso fica num `Map` na memoria do processo (`AVALIACOES_EM_CURSO` em `src/app/(painel)/(completo)/criar/tema-livre/acoes.ts`). Hoje ha um unico container `web` em producao, entao basta. Se um dia houver mais de um (ou uma troca de container no meio de uma avaliacao), o toque repetido pode pagar duas vezes: a saida e trocar o `Map` por uma trava no banco (`pg_advisory_xact_lock` ou uma linha com a chave e o prazo), como o webhook do Stripe ja faz.

## O que nunca fazer

Build na VPS; publicar porta; mexer em `/srv/odontotech` ou no bloco do OdontoTech no
`Caddyfile`; commitar `.env`; deploy sem o Gustavo pedir.

## A decisao da edicao (E47 PR 3)

- **Job `decidir-edicao`** (por evento): a transcricao pronta (`transcrito`) enfileira a decisao. O modelo forte (`decidirEdicao`, esforco medio) decide o que fica no video por numero de palavra, o motor de corte (`src/edicao/`) calcula o plano e a legenda, o codigo confere (corte com palavra soando, nome da marca quase igual na legenda, numero e promessa do titulo) e um modelo barato (`verificarEdicao`) le a legenda e o titulo. Termina em `verificado` (pronta para o render do PR 4) ou `para_revisao` (reprovou nas duas decisoes; nao segue sozinha). Estados novos: `decidindo`, `decidido`, `verificado`, `para_revisao`.
- **Custo estimado por video**: uns US$ 0,15 para 1 minuto (R$ 0,80) e US$ 0,22 para 2 minutos, com a decisao no modelo forte e o verificador no barato (a conta do estudo); dobra no pior caso (duas decisoes e dois verificadores). Tokens e custo reais ficam em `geracoes_ia` (tarefas `decidirEdicao` e `verificarEdicao`, so numeros: a fala nunca vai para o registro) e a soma em `edicoes.custo_ia_usd`.
- **Se a IA estiver fora do ar** (sem credito, sobrecarga): a edicao volta ao passo anterior e a limpeza de hora em hora enfileira de novo (ate 3 rodadas; na terceira a edicao falha com a frase e o bruto sai). Se so o verificador cair, o plano fica guardado (`decidido`) e a rodada seguinte retoma dele sem pagar a decisao de novo.
- **Migracao 0108**: so `ADD COLUMN` (`decisao`, `resultado`, `tentativas_da_decisao`). A decisao e o plano (que tem a fala da pessoa) saem junto com o ultimo arquivo da edicao.
- Sem infra nova: o job roda no worker de hoje.
