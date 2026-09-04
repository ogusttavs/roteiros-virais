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
USER app
EXPOSE 3000
CMD ["node", "server.js"]
