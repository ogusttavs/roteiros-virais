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
npm ci                    # instalar
npm run db:up              # Postgres local (Docker)
npm run db:migrate         # aplicar migrações
npm run db:seed            # dados de desenvolvimento
npm run db:reset           # derruba, migra, semeia
npm run dev                # painel em http://localhost:3000
npm run worker             # processo de jobs (pg-boss)
npm run job -- <nome>      # rodar um job uma vez
npm run admin:criar        # cria o primeiro admin (ADMIN_EMAIL, ADMIN_NOME, ADMIN_SENHA no ambiente)
npm run lint && npm run typecheck && npm run test && npm run checar-texto && npm run build
npm run test:e2e           # Playwright contra `next build` mais `next start`; demora uns 2
                            # minutos; reusa um servidor já na porta 3000 fora de CI
deploy/ensaio/ensaiar.sh   # ensaio do Compose de produção nesta máquina, antes de qualquer
                            # deploy (`deploy/README.md`)
```

`MODO_E2E` liga o modo da suíte e2e (limite de taxa desligado, e-mail simulado mesmo com
`NODE_ENV=production`); é ligado só pelo `playwright.config.ts` (`webServer.env`) e nunca
entra no `.env`.

## Estrutura

```
src/app/            rotas e telas (App Router). Server Components por padrão.
src/ui/             o que o agente de design entregou: tokens.css, base.css, componentes.
src/db/             schema.ts, index.ts (conexão), migrate.ts. Migrações em ../drizzle/.
src/ia/             cliente.ts, registro.ts, verificador.ts, lote.ts, prompts/<tarefa>.ts
src/servicos/       regras do produto: briefing, temas, roteiro, pontuacao, referencias
src/jobs/           fila.ts, worker.ts, um arquivo por job
src/config/         briefing.ts (perguntas), precos-ia.ts, constantes de produto
src/textos/         textos de tela, um arquivo por área (ver Convenções)
src/lib/            config.ts (env), log.ts, utilidades pequenas
scripts/            seed, reset, checar-texto, checar-tokens, admin:criar, ia:fumaca,
                    avaliar:* (golden sets)
avaliacoes/         golden sets em JSON e o diário dos testes
deploy/             Dockerfile, Dockerfile.worker, Dockerfile.backup, compose.prod.yml,
                    deploy.sh, proxy/, backup/, ensaio/, README.md
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
  rodam em `AI_PROVIDER=mock`. A suíte e2e sobe o app em modo produção com `MODO_E2E=1` e
  as chaves reais zeradas no `webServer.env`; nunca rode o app em `NODE_ENV=production` com
  o `.env` real fora do Playwright (em 05/09 isso mandou e-mail de verdade pelo Resend).
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

## O que já existe (05/09/2026, etapas 1 a 13, em produção)

Banco e autenticação: schema completo do MVP, better-auth com papéis (admin e cliente),
middleware e seed. Briefing: perguntas em blocos, nota de 0 a 10 por resposta com análise
em quatro partes, perfil compilado e reavaliação a cada edição. Coleta, transcrição e base
lenta: YouTube, TikTok, Instagram e notícias com fila e worker; transcrição em lote; análise
visual e modelo do nicho. Temas e roteiro: três temas do dia com nota de cinco pilares e
tema livre; roteiro com edição, outro ângulo e modo gravação. Referências, histórico e
lembrete: biblioteca de referências, histórico dos vídeos postados e lembrete diário por
e-mail. Termos e admin: aceite no primeiro acesso e admin de gerações. Deploy e ensaio:
imagens no GHCR, Compose de produção na VPS compartilhada, backup com restauração testada,
Sentry e ensaio local do Compose antes de qualquer deploy. Lista item a item: `../TODO.md`.
