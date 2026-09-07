# Imagem do app web (etapa 13). Construida no GitHub Actions, publicada no
# GHCR e so puxada na VPS (regra compartilhada: sem build em producao).
#
# Tres estagios: dependencias, build do Next (output standalone,
# next.config.ts) e a imagem final so com o necessario para rodar.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build nao precisa de segredo nenhum: config.ts so le variaveis e o
# guarda de producao pula o passo de build (NEXT_PHASE).
ENV NODE_ENV=production
ENV AI_PROVIDER=mock
# A coleta de paginas do build cria o pool do Postgres (sem conectar); precisa
# de uma URL, qualquer uma. A de verdade so entra em runtime, pelo .env da VPS.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
# O projeto ainda nao tem pasta public; o estagio final a copia mesmo assim.
RUN mkdir -p public && npm run build

FROM node:24-slim AS runner
WORKDIR /app
# Sha curto do commit (etapa 13, decisao 1): vira `release` no Sentry.
# Passado pelo workflow "Imagens"; vazio fora dele (build local).
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# curl para o healthcheck do Compose
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# O rastreamento do standalone so copia o que o import estatico usa
# (chromium de "playwright"), sem o cli.js nem playwright-core inteiro que o
# instalador do Chromium precisa; por isso os dois entram por cima, prontos,
# em vez de reinstalar via npx (achado buildando a imagem: o node_modules/
# playwright incompleto do standalone fazia o npx errar "playwright: not
# found" em vez de cair para a versao de verdade).
COPY --from=build /app/node_modules/playwright ./node_modules/playwright
COPY --from=build /app/node_modules/playwright-core ./node_modules/playwright-core
# Chromium do Playwright, so para a rota /api/roteiros/[id]/pdf (roteiro em
# PDF, PROXIMO.md, acabamento do iPad, item 5, decisao registrada no
# TODO.md): fica fora de node_modules (o instalador guarda o binario do
# navegador à parte), num caminho fixo que o processo em runtime acha pela
# variavel de ambiente. --with-deps instala tambem as bibliotecas de sistema
# que faltam nesta imagem slim; roda antes do USER app porque precisa de
# root para o apt-get.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN node node_modules/playwright/cli.js install --with-deps chromium \
  && chown -R app:app /app/.playwright
USER app
EXPOSE 3000
CMD ["node", "server.js"]
