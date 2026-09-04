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
| `compose.prod.yml` | o Compose de producao; vira `/srv/roteiros/docker-compose.yml` |
| `proxy/` | copia do proxy compartilhado (`/srv/proxy`): Caddy e `Caddyfile` |
| `deploy.sh` | o deploy, rodado deste Mac |

As imagens sao construidas pelo GitHub Actions (`.github/workflows/imagem.yml`) a cada
merge na `main` e publicadas em `ghcr.io/ogusttavs/roteiros-virais/{app,worker,backup}`
com as tags `latest` e o sha curto. A VPS so puxa.

## Primeiro deploy (uma vez)

1. Dominio com registro A de `app.<dominio>` para `179.199.142.54`.
2. `/srv/roteiros/.env` na VPS (`chmod 600`), com `APP_URL`, `BETTER_AUTH_URL` e
   `EMAIL_FROM` ja com o dominio, e `POSTGRES_PASSWORD` igual a senha da `DATABASE_URL`.
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

Restaurar um dump num Postgres local (e o teste da migracao):

```bash
scp getorbita-vps:/var/lib/docker/volumes/roteiros_backups/_data/<arquivo>.sql.gz .
gunzip -c <arquivo>.sql.gz | docker exec -i roteiros-postgres psql -U roteiros -d roteiros_restaurado
```

## O que nunca fazer

Build na VPS; publicar porta; mexer em `/srv/odontotech` ou no bloco do OdontoTech no
`Caddyfile`; commitar `.env`; deploy sem o Gustavo pedir.
