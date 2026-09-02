# Plataforma (MVP)

Codigo do produto. Leia primeiro o `../CLAUDE.md` (regras do projeto), depois o `CLAUDE.md`
desta pasta (comandos e convencoes) e a etapa do `../estrategia/plano-de-execucao.md` que
vai executar.

## Rodar localmente

Precisa de Node 24 e Docker (Docker Desktop ou OrbStack).

```bash
npm ci
cp .env.example .env
npm run db:up
npm run dev
```

Abra http://localhost:3000. Sem chave de IA o sistema responde em modo simulado
(`AI_PROVIDER=mock`), o suficiente para ver as telas e rodar os testes.

`npm run db:migrate` e `npm run db:seed` entram na etapa 2, junto com a primeira migracao do
schema; ainda nao ha nada para migrar ou semear.

## Qualidade

```bash
npm run lint && npm run typecheck && npm run test && npm run checar-texto && npm run build
npm run test:e2e
```

`npm run test` usa o Postgres do `db:up` (testes de integracao contra banco real).

## Estado

Etapa 1 (02/09/2026): repositorio, ambiente local, ESLint, Prettier, Vitest, Playwright,
`checar-texto` e CI no ar. Schema inicial do banco e conexao existem, mas sem migracao ainda.
As telas de produto, os jobs e os prompts entram etapa por etapa, conforme o plano de
execucao.
