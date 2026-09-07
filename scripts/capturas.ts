/**
 * Capturas do painel para revisao visual (etapa 12, ajuste 3 da revisao da
 * parte 1; nomes no padrao do design v2 desde a D2 parte 1, item 9 do
 * `PROXIMO.md`: `Tela.Estado.Largura.Modo`, como
 * `entregaveis/design-v2/entrega/telas/README.md`): as ferramentas de
 * navegador das sessoes de agente nao gravam arquivo, entao um pedido de
 * captura nunca sai de verdade. Este script sobe o Playwright direto, fora
 * da suite de testes, entra com o cliente de exemplo de limpeza e grava um
 * PNG de cada tela pedida, claro e escuro, a 390 (celular), 1024 (tablet) e
 * 1280 (desktop). Usa o cliente de limpeza, nao o de dentistas, porque
 * `scripts/semear.ts` deixa o de dentistas de proposito sem briefing
 * completo, para `briefing.spec.ts` exercitar o fluxo de onboarding
 * inteiro.
 *
 * Revisao do PR #31 (item 11): a captura "depois" do PR mostrava Hoje no
 * estado vazio, porque o seed nao grava `temas_dia` de hoje para o cliente
 * de exemplo, e isso invalidou a conferencia visual contra o design. Agora
 * o script garante uma linha de hoje (tres temas, evidencia apontando para
 * um video real do seed) antes de capturar, e tira Hoje duas vezes: sem
 * roteiro do dia (`Hoje.Normal`) e com (`Hoje.Gerado`).
 *
 * Pre-requisitos, antes de rodar:
 * 1. `DATABASE_URL` do `.env` apontando para `roteiros_dev` (nunca
 *    `roteiros`, o banco de trabalho: `FLUXO.md`, "Um Postgres local,
 *    varias sessoes"; `resetarSchema` ja recusa esse nome).
 * 2. `npm run db:seed` rodado uma vez contra esse banco.
 * 3. `npm run dev` rodando, na mesma porta que `CAPTURAS_URL` aponta
 *    (padrao `http://localhost:3000`).
 *
 * Uso: `npm run capturas -- <nome-da-etapa>` (ex.: `npm run capturas --
 * etapa-12`). Grava em `entregaveis/design/capturas/<nome-da-etapa>/`. O
 * comando no `package.json` ja forca `AI_PROVIDER=mock` (gerar um roteiro
 * de exemplo no seed nao deveria gastar credito real).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";

import { PERGUNTAS_BRIEFING } from "../src/config/briefing";
import { db, getPool } from "../src/db";
import { briefings, clientes, temasDia, videos, type AvaliacaoResposta, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { clienteDoUsuario, salvarTema } from "../src/servicos/clientes";
import { gerarRoteiro, roteiroDeHoje } from "../src/servicos/roteiro";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;
/**
 * Cliente do seed sem briefing completo, de proposito (semear.ts): serve
 * para capturar Comecar sem inventar dado, com um cliente que realmente
 * esta nesse momento do fluxo.
 */
const USUARIO_SEED_COMECAR = "seed-cliente-dentistas";
const EMAIL_SEED_COMECAR = `${USUARIO_SEED_COMECAR}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1024", largura: 1024, altura: 768 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function entrar(page: Page, baseUrl: string, email: string = EMAIL_SEED): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

function avaliacaoExemplo(nota: number): AvaliacaoResposta {
  return {
    nota,
    bom: "Resposta com exemplo concreto.",
    melhorar: "Falta um numero ou um caso real.",
    como: "Escreva como se fosse para alguem que nunca ouviu falar do seu ramo.",
    impacto: "Uma resposta mais concreta gera um roteiro mais parecido com voce.",
  };
}

/** Garante um roteiro de hoje para o cliente de seed, gerando um se faltar. */
async function garantirRoteiro(clienteId: number): Promise<number> {
  const existente = await roteiroDeHoje(clienteId);
  if (existente) return existente.id;

  const roteiro = await gerarRoteiro(clienteId, {
    origem: "livre",
    textoTema: "como organizar o guarda roupa em uma tarde sem gastar muito",
    objetivo: "conversao",
  });
  return roteiro.id;
}

/**
 * Garante os temas de hoje do nicho do cliente, com evidência real
 * (revisão do PR #31, item 11): sem isso, Hoje cai no estado vazio e a
 * captura não mostra o que o design desenha.
 */
async function garantirTemasDeHoje(nichoId: number): Promise<void> {
  const [existente] = await db()
    .select({ data: temasDia.data })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (existente) return;

  const videosDoNicho = await db()
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.nichoId, nichoId))
    .orderBy(desc(videos.foraDaCurva))
    .limit(3);
  const evidenciaPrincipal = videosDoNicho.map((v) => v.id).slice(0, 2);

  const temas: TemaDoDia[] = [
    {
      titulo: "[exemplo] o erro que faz a mancha voltar depois da limpeza",
      descricao: "descrição do tema de exemplo",
      porQue: "está subindo mais rápido que o normal da conta",
      evidencias: evidenciaPrincipal,
      puxaPara: "conversao",
    },
    {
      titulo: "[exemplo] o que fazer antes de aplicar o produto",
      descricao: "descrição do tema de exemplo",
      porQue: "uma dúvida que aparece toda semana nos comentários",
      evidencias: videosDoNicho[2] ? [videosDoNicho[2].id] : [],
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

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas -- <nome-da-etapa> (ex.: "etapa-12")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const cliente = await clienteDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(
      `cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" contra o banco desta sessao (roteiros_dev, nunca roteiros).`,
    );
  }
  if (!cliente.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }

  const clienteComecar = await clienteDoUsuario(USUARIO_SEED_COMECAR);
  if (!clienteComecar) {
    throw new Error(
      `cliente de seed "${USUARIO_SEED_COMECAR}" nao encontrado; rode "npm run db:seed" contra o banco desta sessao.`,
    );
  }

  await garantirTemasDeHoje(cliente.nichoId);

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function paraCadaTelaDe(
    clienteId: number,
    email: string,
    acao: (page: Page, tamanho: (typeof TAMANHOS)[number], modo: (typeof MODOS)[number]) => Promise<void>,
    tamanhos: typeof TAMANHOS = TAMANHOS,
  ): Promise<void> {
    for (const modo of MODOS) {
      await salvarTema(clienteId, modo.colorScheme === "dark" ? "escuro" : "claro");
      for (const tamanho of tamanhos) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl, email);
        await acao(page, tamanho, modo);
        await contexto.close();
      }
    }
  }

  async function paraCadaTela(
    acao: (page: Page, tamanho: (typeof TAMANHOS)[number], modo: (typeof MODOS)[number]) => Promise<void>,
  ): Promise<void> {
    await paraCadaTelaDe(cliente!.id, EMAIL_SEED, acao);
  }

  async function capturar(page: Page, caminho: string, tela: string, estado: string, rotulo: string, modo: string): Promise<void> {
    await page.goto(`${baseUrl}${caminho}`);
    await page.waitForLoadState("networkidle");
    const nomeArquivo = `${tela}.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  try {
    // Passo 1: Hoje.Normal, sem roteiro do dia, em todas as larguras e nos dois modos.
    await paraCadaTela(async (page, tamanho, modo) => {
      await capturar(page, "/hoje", "Hoje", "Normal", tamanho.rotulo, modo.rotulo);
    });

    /**
     * O seed grava notaGeral, completo e perfil do cliente de limpeza direto
     * (`semear.ts`), sem respostas nem avaliacoes por pergunta: sem isto, a
     * captura de Briefing mostrava as doze perguntas abertas, sem nenhuma
     * linha ".resposta" fechada, o que a tela nem desenha para o cliente ja
     * liberado (achado revisando a propria captura desta rodada).
     */
    const respostasBriefing: Record<string, string> = {};
    const avaliacoesBriefing: Record<string, AvaliacaoResposta> = {};
    for (const [indice, pergunta] of PERGUNTAS_BRIEFING.entries()) {
      respostasBriefing[pergunta.id] = `Resposta de exemplo para ${pergunta.id}, com um numero 42 e um caso real.`;
      avaliacoesBriefing[pergunta.id] = avaliacaoExemplo(indice === 2 ? 4.8 : indice === 1 ? 7.1 : 8.6);
    }
    await db()
      .update(briefings)
      .set({ respostas: respostasBriefing, avaliacoes: avaliacoesBriefing })
      .where(eq(briefings.clienteId, cliente.id));

    // Passo 2: o roteiro do dia passa a existir; o resto das telas, com Hoje.Gerado.
    const roteiroId = await garantirRoteiro(cliente.id);
    await paraCadaTela(async (page, tamanho, modo) => {
      await capturar(page, "/hoje", "Hoje", "Gerado", tamanho.rotulo, modo.rotulo);
      await capturar(page, `/roteiros/${roteiroId}`, "Roteiro", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, `/roteiros/${roteiroId}/gravar`, "Gravacao", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/referencias", "Referencias", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/historico", "Historico", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/briefing", "Briefing", "Normal", tamanho.rotulo, modo.rotulo);
      await capturar(page, "/conta", "Conta", "Normal", tamanho.rotulo, modo.rotulo);
    });

    // Passo 3: Comecar, com o cliente de seed sem briefing completo (item 6 do PROXIMO.md, D2 parte 2).
    const dadosFixosOriginais = {
      cidade: clienteComecar.cidade,
      nichoId: clienteComecar.nichoId,
      ramoOutro: clienteComecar.ramoOutro,
    };

    await db()
      .update(clientes)
      .set({ cidade: null, nichoId: null, ramoOutro: null })
      .where(eq(clientes.id, clienteComecar.id));
    await paraCadaTelaDe(clienteComecar.id, EMAIL_SEED_COMECAR, async (page, tamanho, modo) => {
      await capturar(page, "/comecar", "Comecar", "Intro", tamanho.rotulo, modo.rotulo);
    });

    await db()
      .update(clientes)
      .set(dadosFixosOriginais)
      .where(eq(clientes.id, clienteComecar.id));
    await db()
      .update(briefings)
      .set({
        respostas: {
          p1: "Somos uma clinica de estetica que atende mulheres de 30 a 50 anos, com procedimentos faciais.",
          p2: "O produto que mais vende e o peeling facial.",
        },
        avaliacoes: { p1: avaliacaoExemplo(8.6), p2: avaliacaoExemplo(7.1) },
        notaGeral: "6.83",
        completo: false,
      })
      .where(eq(briefings.clienteId, clienteComecar.id));
    await paraCadaTelaDe(clienteComecar.id, EMAIL_SEED_COMECAR, async (page, tamanho, modo) => {
      await capturar(page, "/comecar", "Comecar", "Perguntas", tamanho.rotulo, modo.rotulo);
    });
    // A folha (BarraNotaGeral) so existe abaixo de 1180px; acima disso vira cartao lateral fixo.
    await paraCadaTelaDe(
      clienteComecar.id,
      EMAIL_SEED_COMECAR,
      async (page, tamanho, modo) => {
        await page.goto(`${baseUrl}/comecar`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "as doze notas" }).click();
        await page.getByRole("dialog", { name: "as doze notas" }).waitFor({ state: "visible" });
        const nomeArquivo = `Comecar.Folha.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
        arquivosGravados.push(
          path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)),
        );
      },
      TAMANHOS.filter((t) => t.largura < 1180),
    );

    /**
     * "Liberado" nao e uma pagina: e um estado de cliente que so aparece no
     * instante em que a ultima pergunta pendente e avaliada (`ComecarWizard`,
     * `aoAtualizarPergunta`); com o briefing ja completo no banco,
     * `comecar/page.tsx` redireciona para `/hoje` antes mesmo de renderizar.
     * Por isso onze das doze ficam prontas (nota alta, mas abaixo da meta
     * geral) e a ultima (P12) e respondida e avaliada pela tela de verdade,
     * deixando o cliente cruzar a meta ao vivo.
     */
    const respostasQuaseCompletas: Record<string, string> = {};
    const avaliacoesQuaseCompletas: Record<string, AvaliacaoResposta> = {};
    for (const pergunta of PERGUNTAS_BRIEFING) {
      if (pergunta.id === "p12") continue;
      respostasQuaseCompletas[pergunta.id] = `Resposta de exemplo para ${pergunta.id}, com um numero 42 e um caso real.`;
      avaliacoesQuaseCompletas[pergunta.id] = avaliacaoExemplo(8.2);
    }
    await paraCadaTelaDe(clienteComecar.id, EMAIL_SEED_COMECAR, async (page, tamanho, modo) => {
      // Refeito a cada largura e modo: a captura anterior deixa o briefing completo no banco.
      await db()
        .update(briefings)
        .set({ respostas: respostasQuaseCompletas, avaliacoes: avaliacoesQuaseCompletas, notaGeral: "7.69", completo: false })
        .where(eq(briefings.clienteId, clienteComecar.id));
      await page.goto(`${baseUrl}/comecar`);
      await page.getByLabel(PERGUNTAS_BRIEFING.at(-1)!.enunciado).fill(
        'Admiro @perfilexemplo pela didatica, com quem aprendi a testar antes de aplicar. Concorrente direto e a Clinica Exemplo, na Rua das Flores, 42.',
      );
      await page.getByRole("button", { name: "Avaliar esta resposta" }).click();
      await page.getByRole("heading", { name: "Seu painel está aberto." }).waitFor({ state: "visible" });
      const nomeArquivo = `Comecar.Liberado.${tamanho.rotulo}.${modo.rotulo}.png`;
      await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
      arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)));
    });
  } finally {
    await browser.close();
    await salvarTema(cliente.id, "sistema");
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
