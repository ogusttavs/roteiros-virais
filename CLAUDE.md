# plataforma: como trabalhar neste código

> Leia antes o `../CLAUDE.md` (regras do projeto) e o `../TODO.md`. Este arquivo é só sobre o
> código. A etapa que você vai executar está em `../estrategia/plano-de-execucao.md`; execute
> uma etapa por sessão e pare.

## Stack (fechada em 01/09/2026, seção 6 do escopo)

TypeScript, Node 24, Next.js 15 (App Router), React 19, CSS Modules com tokens, Postgres 16,
Drizzle ORM, pg-boss, better-auth, SDK oficial da Anthropic, Groq (transcrição), Apify e
YouTube Data API (coleta), Resend (e-mail), pino e Sentry, Vitest e Playwright, ESLint e
Prettier, Docker Compose. Nada além disso sem registrar decisão em `../HISTORICO.md`.

## Comandos

```bash
npm ci                 # instalar
npm run db:up          # Postgres local (Docker)
npm run db:migrate     # aplicar migrações
npm run db:seed        # dados de desenvolvimento
npm run db:reset       # derruba, migra, semeia
npm run dev            # painel em http://localhost:3000
npm run worker         # processo de jobs (pg-boss)
npm run job -- <nome>  # rodar um job uma vez
npm run lint && npm run typecheck && npm run test && npm run checar-texto && npm run build
npm run test:e2e       # Playwright
```

## Estrutura

```
src/app/            rotas e telas (App Router). Server Components por padrão.
src/ui/             o que o agente de design entregou: tokens.css, base.css, componentes.
src/db/             schema.ts, index.ts (conexão), migrate.ts. Migrações em ../drizzle/.
src/ia/             cliente.ts, registro.ts, verificador.ts, lote.ts, prompts/<tarefa>.ts
src/servicos/       regras do produto: briefing, temas, roteiro, pontuacao, referencias
src/jobs/           fila.ts, worker.ts, um arquivo por job
src/config/         briefing.ts (perguntas), precos-ia.ts, constantes de produto
src/lib/            config.ts (env), log.ts, utilidades pequenas
scripts/            seed, checar-texto, ia:fumaca, avaliar:* (golden sets)
avaliacoes/         golden sets em JSON e o diário dos testes
deploy/             Dockerfile, compose.prod.yml, Caddyfile, preparar-vps.sh
tests/              integração e e2e; unitários ficam ao lado do arquivo (*.test.ts)
```

## Convenções

- **Nomes:** termos do domínio em português (roteiro, briefing, nicho, tema, foraDaCurva);
  termos técnicos genéricos em inglês quando é o nome usual (handler, config, schema).
  Arquivos em kebab-case, tipos em PascalCase, funções e variáveis em camelCase.
- **Textos de tela** seguem o `brief-frontend.md`, seção 8. `npm run checar-texto` é
  obrigatório e reprova travessão, emoji e jargão. Textos ficam em `src/textos/*.ts`, nunca
  espalhados em JSX, para o verificador e a futura troca de nome encontrarem tudo.
- **Nada de marca.** `APP_NAME` vem do ambiente. `grep -ri orbita src` precisa voltar vazio.
- **Toda chamada de IA** passa por `src/ia/cliente.ts` com schema Zod e é registrada em
  `geracoes_ia`. Prompt tem `versao`. Nunca chamar o SDK direto de um serviço.
- **Toda consulta de produto** filtra `origem <> 'seed'` fora de desenvolvimento e filtra por
  `cliente_id` da sessão. Dado de um cliente nunca aparece para outro (testado).
- **Segredos** só em `.env` (ignorado) e nos segredos do GitHub. Chave em código reprova o PR.
- **Erros** têm nome (`class ErroIA extends Error`) e mensagem para o cliente separada da
  mensagem técnica. O cliente nunca vê stack trace nem "erro 500".
- **Testes:** regra de negócio tem teste unitário; fluxo tem teste de integração contra
  Postgres; os quatro fluxos críticos (entrar, briefing, tema, roteiro) têm e2e. Testes
  rodam em `AI_PROVIDER=mock`.
- **Commits** convencionais em português: `feat(briefing): nota por resposta`,
  `fix(coleta): cota do youtube`. Um PR por etapa, título `etapa N: nome`.
- **Commit e push a cada bloco que compila**, com prefixo `wip:` enquanto a etapa não
  terminou (`../FLUXO.md`, "Troca de conta"). A conta pode acabar no meio; a branch no
  GitHub é o que a sessão seguinte, em outra conta, consegue continuar. Antes de abrir o
  PR, o último commit recebe a mensagem final. Ao começar e ao terminar cada bloco, escreva
  no cabeçalho "Em andamento agora" do `../TODO.md` onde parou.
- **Antes de abrir o PR:** definição de pronto do plano, `../TODO.md` atualizado, decisão nova
  em `../HISTORICO.md`.

## Repositório

`git@github.com:ogusttavs/roteiros-virais.git`, criado em 02/09/2026. **Público por
enquanto** (decisão do Gustavo em 02/09/2026, para ter a `main` protegida sem pagar o GitHub
Pro). Consequência: nada de dado de cliente, chave, briefing real ou material de venda
entra no repositório, nem em teste nem em fixture. A raiz do repositório é esta pasta
`plataforma/`, não a pasta do projeto acima. `main` tem ruleset: só entra por PR com a CI
"qualidade" verde, merge por squash.

## O que já existe (02/09/2026, etapa 2)

Da etapa 1: `package.json`, `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`,
`.env.example`, `compose.dev.yml`, ESLint, Prettier, Vitest, Playwright,
`scripts/checar-texto.ts`, `.github/workflows/ci.yml`, página inicial mínima com os tokens
provisórios em `src/ui/`.

Da etapa 2: `src/db/schema.ts` completo do MVP (`geracoes_ia`; `user`, `session`, `account`,
`verification` do better-auth; `clientes` com `usuario_id` referenciando `user` e os dados
fixos do briefing, seção 1, `bairro`, `perfis`, `quem_grava`; `videos.etiquetas` e
`videos.busca`, tsvector gerado com índice GIN). Migração inicial em `drizzle/`.
`scripts/semear.ts` (dados de exemplo, puro, testável), `scripts/seed.ts` e
`scripts/reset.ts` (linha de comando), `scripts/resetar-schema.ts` (compartilhado entre o
reset e o teste de integração). Não existe tela, job nem prompt de IA ainda; autenticação de
verdade (rotas, middleware, papéis) entra na etapa 3.
