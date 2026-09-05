# Plataforma (MVP)

Codigo do produto. Leia primeiro o `../CLAUDE.md` (regras do projeto), depois o `CLAUDE.md`
desta pasta (comandos e convencoes) e a etapa do `../estrategia/plano-de-execucao.md` que
vai executar.

## Rodar localmente

Precisa de Node 24 e Docker Desktop.

```bash
npm ci
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Abra http://localhost:3000. Sem chave de IA o sistema responde em modo simulado
(`AI_PROVIDER=mock`), o suficiente para ver as telas e rodar os testes.

`npm run db:reset` derruba o schema, migra e semeia de novo, para voltar ao estado de
desenvolvimento do zero. O seed cria um administrador e um cliente de teste por nicho,
todos com a senha `ExemploSenha123` (so funciona local, o seed nunca roda em producao).

### Os tres bancos (etapa 11, ajuste 1)

`roteiros_dev` (o padrao do `.env.example`) e o do dia a dia, reset e teste podem apagar a
vontade. `roteiros_teste` e um segundo banco isolado para rodar teste sem mexer no que voce
esta explorando manualmente no `roteiros_dev` no momento. O nome `roteiros`, sem sufixo, e
reservado para um banco de trabalho com dado real (por exemplo, coletado com credito de API de
verdade); `resetarSchema` recusa esse nome exato no codigo, para reset por engano parar de ser
possivel mesmo esquecendo a regra.

## Qualidade

```bash
npm run lint && npm run typecheck && npm run test && npm run checar-texto && npm run build
npm run test:e2e
```

`npm run test` usa o Postgres do `db:up` (testes de integracao contra banco real). `npm run
test:e2e` builda e sobe o servidor de producao (`next build` mais `next start`) sozinho, sem
precisar de nada rodando antes. `deploy/ensaio/ensaiar.sh` e o ensaio do Compose de producao
nesta maquina, antes de qualquer deploy (`deploy/README.md`).

## Estado

Etapas 1 a 13 e D completas na `main` (05/09/2026): banco e autenticacao, briefing, coleta e
transcricao, temas e roteiro, referencias e historico, lembrete, termos e admin, deploy. O
painel esta em producao na VPS compartilhada com o OdontoTech, endereco provisorio
`https://app.srv1953618.hstgr.cloud`, ate existir dominio proprio. Proxima etapa: dez dias
de teste com a Dr.Wash, do Gustavo, nao do codigo. Lista item a item: `../TODO.md`.
