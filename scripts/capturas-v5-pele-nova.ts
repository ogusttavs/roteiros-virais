/**
 * Capturas da V5, a pele nova (definição de pronto do `PROXIMO.md`): as sete
 * telas exigidas (Entrar, Hoje, Roteiro, Referências, Histórico, Conta, uma
 * tela do admin) nas larguras do design (390, 1024, 1280) e nos dois modos,
 * mais a cápsula das abas encolhida, a folha de notas aberta e uma captura
 * de Hoje com transparência reduzida simulada. Script próprio, fora da
 * suíte de testes, no mesmo padrão de `scripts/capturas-v3-marcas.ts` e
 * `scripts/capturas-v4-forca-evidencia.ts`: monta o fixture direto no banco
 * (o seed não grava roteiro nenhum) e usa o Playwright para navegar e
 * gravar PNG.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v5-pele-nova -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";

import { PERGUNTAS_BRIEFING } from "../src/config/briefing";
import { db, getPool } from "../src/db";
import {
  briefings,
  contas,
  roteiros,
  temasDia,
  videos,
  type AvaliacaoResposta,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;
const EMAIL_ADMIN = "admin@exemplo.teste";

/** As tres larguras do PROXIMO.md desta etapa: 820, nao 1024 (o iPad Air em pe, tablet como tamanho proprio). */
const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "820", largura: 820, altura: 1180 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function entrar(page: Page, baseUrl: string, email: string): Promise<void> {
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

/** Garante um roteiro pronto (não gerado pela IA, direto no banco) para Roteiro e Histórico. */
async function garantirRoteiro(clienteId: number): Promise<number> {
  const tema = "[exemplo] o erro que faz a mancha voltar depois da limpeza";
  const existente = await db().select().from(roteiros).where(eq(roteiros.tema, tema));
  if (existente.length > 0) return existente[0].id;

  const [videoReferencia] = await db()
    .select()
    .from(videos)
    .where(eq(videos.idExterno, "captura-v5-referencia-0"));

  const conteudo: ConteudoRoteiro = {
    titulo: tema,
    duracaoS: 42,
    gancho: "se a mancha volta dois dias depois, o problema nao e o produto",
    corpo: "explique a ordem certa enquanto faz. aplicar, esperar o tempo, e so entao esfregar.",
    fechamento: "mostre a peca limpa, sem mancha nenhuma",
    chamadaFinal: "manda uma mensagem que eu te digo qual produto usar",
    cartoes: null,
    porQueAssim: [],
    cenas: [
      { momento: "abertura", oQueFazer: "mostrar a mancha de perto" },
      { momento: "meio", oQueFazer: "aplicar o produto na ordem certa" },
      { momento: "fechamento", oQueFazer: "mostrar o resultado" },
    ],
    ondeGravar: "na sala, perto do sofa, com luz natural",
    edicao: {
      textoNaTela: [{ quando: "abertura", oQue: "a mancha volta?", onde: "topo" }],
      ritmoDeCorte: "moderado",
      recursos: ["zoom na mancha"],
      audio: null,
      referencia: videoReferencia
        ? { videoId: videoReferencia.id, segundo: 4, oQueOlhar: "o antes e depois" }
        : null,
    },
    evidencias: videoReferencia ? [videoReferencia.id] : [],
    semEvidencia: !videoReferencia,
    forcaEvidencia: videoReferencia ? "forte" : null,
  };

  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: "2026-01-01",
      tema,
      origem: "livre",
      objetivo: "conversao",
      conteudo,
      referenciaVideoId: videoReferencia?.id,
      tipoAbertura: "resultado",
    })
    .returning();

  return roteiro.id;
}

/**
 * Garante oito vídeos que passam no filtro de `referenciasDoNicho` (fora da
 * curva >= 1,5x, publicado nos últimos 90 dias, com análise): o seed não
 * grava `analise` nem `foraDaCurva` alto o bastante, então `/referencias`
 * fica no estado vazio sem este fixture. Oito, não três: precisa de lista
 * comprida o bastante para rolar de verdade no celular (captura da cápsula
 * encolhida).
 */
async function garantirVideosReferencia(nichoId: number): Promise<void> {
  const [conta] = await db().select().from(contas).where(eq(contas.nichoId, nichoId)).limit(1);
  if (!conta) throw new Error(`nicho ${nichoId} sem conta de seed; confira "npm run db:seed".`);

  const TITULOS = [
    "o erro que faz a mancha voltar depois da limpeza",
    "o que fazer antes de aplicar o produto",
    "quanto custa limpar errado duas vezes",
    "a ordem certa para nao estragar o tecido",
    "o teste rapido antes de usar em qualquer superficie",
    "por que o cheiro forte nao significa mais limpeza",
    "o pano certo para cada tipo de mancha",
    "quando chamar um profissional em vez de tentar sozinho",
  ];

  for (const [indice, titulo] of TITULOS.entries()) {
    const idExterno = `captura-v5-referencia-${indice}`;
    const existente = await db().select().from(videos).where(eq(videos.idExterno, idExterno));
    if (existente.length > 0) continue;

    await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno,
        url: `https://exemplo.invalido/${idExterno}`,
        nichoId,
        contaId: conta.id,
        titulo,
        views: 27600,
        foraDaCurva: "3.5",
        publicadoEm: new Date(),
        idioma: "pt",
        analise: {
          assunto: "mancha em estofado",
          gancho: "esse produto tira qualquer mancha do estofado",
          estrutura: "mostra o antes e o depois lado a lado",
          fechamento: "resumo do que foi mostrado",
          chamadaFinal: "comenta se voce ja passou por isso",
          formato: "fala_para_camera",
          porQueFuncionou: "mostra o produto agindo direto na mancha, sem cortar",
        } as never,
      });
  }
}

/**
 * Garante os temas de hoje do nicho do cliente, com evidência real (mesmo
 * padrão de `scripts/capturas.ts`): sem isso, Hoje cai no estado vazio
 * ("os temas de hoje saem até as 6h30") e a captura não mostra o cartão que
 * o design desenha.
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

/** As doze respostas do briefing preenchidas com nota alta, para a folha não mostrar "sem nota" em toda linha. */
async function preencherBriefingCompleto(clienteId: number): Promise<void> {
  const respostas: Record<string, string> = {};
  const avaliacoes: Record<string, AvaliacaoResposta> = {};
  for (const pergunta of PERGUNTAS_BRIEFING) {
    respostas[pergunta.id] = `Resposta de exemplo para ${pergunta.id}, com um numero 42 e um caso real.`;
    avaliacoes[pergunta.id] = avaliacaoExemplo(8.6);
  }
  await db()
    .update(briefings)
    .set({ respostas, avaliacoes: avaliacoes as never, notaGeral: "8.6", completo: true })
    .where(eq(briefings.clienteId, clienteId));
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v5-pele-nova -- <nome-da-etapa> (ex.: "pr-49")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" primeiro.`);
  }
  if (!cliente.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }

  await garantirVideosReferencia(cliente.nichoId);
  const roteiroId = await garantirRoteiro(cliente.id);
  await garantirTemasDeHoje(cliente.nichoId);
  await preencherBriefingCompleto(cliente.id);

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function capturar(page: Page, tela: string, estado: string, rotulo: string, modo: string): Promise<void> {
    const nomeArquivo = `${tela}.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  async function paraCadaTela(
    email: string | null,
    caminho: string,
    acao: (page: Page, tamanho: (typeof TAMANHOS)[number], modo: (typeof MODOS)[number]) => Promise<void>,
    tamanhos: typeof TAMANHOS = TAMANHOS,
  ): Promise<void> {
    for (const modo of MODOS) {
      for (const tamanho of tamanhos) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        if (email) await entrar(page, baseUrl, email);
        await page.goto(`${baseUrl}${caminho}`);
        await page.waitForLoadState("networkidle");
        await acao(page, tamanho, modo);
        await contexto.close();
      }
    }
  }

  try {
    // Entrar: tela publica, sem login.
    await paraCadaTela(null, "/entrar", async (page, tamanho, modo) => {
      await capturar(page, "Entrar", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // Hoje: os temas do dia (o seed nao grava temas_dia; sem isso a tela cai no estado vazio).
    await paraCadaTela(EMAIL_SEED, "/hoje", async (page, tamanho, modo) => {
      await capturar(page, "Hoje", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // Roteiro: a tela do roteiro fixture, com evidencia real do seed.
    await paraCadaTela(EMAIL_SEED, `/roteiros/${roteiroId}`, async (page, tamanho, modo) => {
      await capturar(page, "Roteiro", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // Referencias: os videos de seed do nicho aparecem sem fixture extra (NODE_ENV=development).
    await paraCadaTela(EMAIL_SEED, "/referencias", async (page, tamanho, modo) => {
      await capturar(page, "Referencias", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // Historico: precisa de ao menos um roteiro do cliente (o fixture acima).
    await paraCadaTela(EMAIL_SEED, "/historico", async (page, tamanho, modo) => {
      await capturar(page, "Historico", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // Conta: funciona com o cliente de seed puro.
    await paraCadaTela(EMAIL_SEED, "/conta", async (page, tamanho, modo) => {
      await capturar(page, "Conta", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // AdminClientes: a tabela com os dois clientes do seed, sem fixture extra.
    await paraCadaTela(EMAIL_ADMIN, "/admin/clientes", async (page, tamanho, modo) => {
      await capturar(page, "AdminClientes", "Padrao", tamanho.rotulo, modo.rotulo);
    });

    // Casca.CapsulaEncolhida: so existe abaixo de 768px (vira barra lateral acima disso).
    // Referencias tem lista longa o bastante para rolar de verdade no celular.
    await paraCadaTela(
      EMAIL_SEED,
      "/referencias",
      async (page, tamanho, modo) => {
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(300);
        const nav = page.getByRole("navigation", { name: "Navegação principal" });
        const capsula = nav.locator("xpath=..");
        const nomeArquivo = `Casca.CapsulaEncolhida.${tamanho.rotulo}.${modo.rotulo}.png`;
        await capsula.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
        arquivosGravados.push(
          path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)),
        );
      },
      TAMANHOS.filter((t) => t.largura < 768),
    );

    // Briefing.Folha: "as doze notas" so abre como dialogo abaixo de 1180px (vira cartao fixo acima disso).
    await paraCadaTela(
      EMAIL_SEED,
      "/briefing",
      async (page, tamanho, modo) => {
        await page.getByRole("button", { name: "as doze notas" }).click();
        await page.getByRole("dialog", { name: "as doze notas" }).waitFor({ state: "visible" });
        const nomeArquivo = `Briefing.Folha.${tamanho.rotulo}.${modo.rotulo}.png`;
        await page.screenshot({ path: path.join(pastaDestino, nomeArquivo) });
        arquivosGravados.push(
          path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)),
        );
      },
      TAMANHOS.filter((t) => t.largura < 1180),
    );

    // Hoje.SemVidro: uma captura so, prefers-reduced-transparency simulado via ".vidro-solido" (tokens.css).
    {
      const contexto = await browser.newContext({
        viewport: { width: TAMANHOS[0].largura, height: TAMANHOS[0].altura },
        colorScheme: "light",
      });
      const page = await contexto.newPage();
      await entrar(page, baseUrl, EMAIL_SEED);
      await page.goto(`${baseUrl}/hoje`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.documentElement.classList.add("vidro-solido"));
      const nomeArquivo = "Hoje.SemVidro.390.Claro.png";
      await page.screenshot({ path: path.join(pastaDestino, nomeArquivo), fullPage: true });
      arquivosGravados.push(
        path.relative(path.resolve(__dirname, "..", ".."), path.join(pastaDestino, nomeArquivo)),
      );
      await contexto.close();
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
