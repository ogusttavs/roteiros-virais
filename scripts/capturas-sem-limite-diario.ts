/**
 * Capturas do Hoje com o plano `sem_limite` (V9b-0, definição de pronto do
 * `PROXIMO.md`): dois cartões de roteiro, com os três temas sempre
 * visíveis abaixo, em 390 e 1280, claro e escuro. Mesmo padrão de
 * `scripts/capturas-v9b-plano.ts`: insere direto no banco (mais rápido e
 * determinístico do que gerar pela tela) e liga o plano `sem_limite` no
 * cliente de seed.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:sem-limite-diario -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { clientes, roteiros, temasDia, videos, type ConteudoRoteiro, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

function conteudoExemplo(titulo: string): ConteudoRoteiro {
  return {
    titulo,
    duracaoS: 40,
    gancho: "olha essa mancha saindo em segundos",
    corpo: "explicacao direta sobre o produto, com uma cena real do negocio",
    fechamento: "resumo do que foi mostrado",
    chamadaFinal: "comenta se voce ja passou por isso",
    cenas: [],
    ondeGravar: "no balcao da loja",
    edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: false,
    forcaEvidencia: null,
  };
}

/** Mesmo raciocínio de `garantirTemasDeHoje` em `scripts/capturas.ts`: sem tema de hoje, `/hoje` cai no estado vazio. */
async function garantirTemasDeHoje(nichoId: number): Promise<void> {
  const [existente] = await db()
    .select({ data: temasDia.data })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (existente) return;

  const videosDoNicho = await db().select({ id: videos.id }).from(videos).where(eq(videos.nichoId, nichoId)).limit(2);
  const temas: TemaDoDia[] = [
    {
      titulo: "[exemplo] o erro que faz a mancha voltar depois da limpeza",
      descricao: "descrição do tema de exemplo",
      porQue: "está subindo mais rápido que o normal da conta",
      evidencias: videosDoNicho.map((v) => v.id),
      puxaPara: "conversao",
    },
    {
      titulo: "[exemplo] o que fazer antes de aplicar o produto",
      descricao: "descrição do tema de exemplo",
      porQue: "uma dúvida que aparece toda semana nos comentários",
      evidencias: [],
      puxaPara: "engajamento",
    },
    {
      titulo: "[exemplo] quanto custa limpar errado duas vezes",
      descricao: "descrição do tema de exemplo",
      porQue: "assunto de custo está subindo no setor",
      evidencias: [],
      puxaPara: "alcance",
    },
  ];
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
}

/** Dois roteiros de hoje, direto no banco, para o cartão duplo (`roteirosDeHoje` só lê a tabela). */
async function garantirDoisRoteirosDeHoje(clienteId: number): Promise<void> {
  await db().delete(roteiros).where(and(eq(roteiros.clienteId, clienteId), eq(roteiros.data, hojeISO())));
  await db()
    .insert(roteiros)
    .values([
      {
        clienteId,
        data: hojeISO(),
        tema: "o erro que faz a mancha voltar depois da limpeza",
        origem: "sugerido",
        objetivo: "conversao",
        conteudo: conteudoExemplo("o erro que faz a mancha voltar depois da limpeza"),
      },
      {
        clienteId,
        data: hojeISO(),
        tema: "andando entre os estandes, atras de embalagem nova",
        origem: "momento",
        objetivo: "engajamento",
        conteudo: conteudoExemplo("andando entre os estandes, atras de embalagem nova"),
      },
    ]);
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:sem-limite-diario -- <nome-da-etapa> (ex.: "pr-57")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(
      `cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra o banco desta sessao (roteiros_dev, nunca roteiros).`,
    );
  }
  if (!cliente.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }

  await db().update(clientes).set({ plano: "sem_limite" }).where(eq(clientes.id, cliente.id));
  await garantirTemasDeHoje(cliente.nichoId);
  await garantirDoisRoteirosDeHoje(cliente.id);

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        await page.goto(`${baseUrl}/hoje`);
        await page.getByText("Seus roteiros de hoje (2)").waitFor({ state: "visible" });

        const nomeArquivo = `SemLimiteDiario.DoisCartoes.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo), fullPage: true });
        arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
