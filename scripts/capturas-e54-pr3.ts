/**
 * Capturas da parte 3 da E54 (as telas do passo 22: "Pesquisar antes de escrever"), em 390 e 1280, claro e escuro: o campo fechado, aberto e sem saldo no Tema livre, a tela da pesquisa
 * (a espera, os dados, a premissa que não bate, a pergunta de posição, sem achados e erro), a linha que o Criar mostra para a pesquisa deixada para depois, o objetivo com o selo e o roteiro
 * com o "Atenção", o "pode aparecer" e as "Fontes". Nenhum dado de cliente: a marca é a da limpeza do seed, e os dados são inventados e marcados "[exemplo]". O script escreve as pesquisas
 * de exemplo direto no banco (nenhuma busca, nenhuma IA), tira as fotos e apaga o que criou.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`, `npm run dev` na porta de `CAPTURAS_URL`,
 * `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e54-pr3.ts <nome-da-pasta>` (ex.: "pr-e54-3").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { pesquisasNaHora, roteiros, type AchadoDaPesquisa, type DestinoDaPesquisa } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;
const PEDIDO = "quanto subiu o preço dos produtos de limpeza este ano";
const TITULO_DO_ROTEIRO = "O produto de limpeza subiu 9,4%: como gastar menos sem trocar de marca";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 900 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

const ACHADOS: AchadoDaPesquisa[] = [
  {
    id: 1,
    texto: "Os produtos de limpeza ficaram 9,4% mais caros em 12 meses.",
    fonteNome: "IBGE",
    fonteTipo: "oficial",
    url: "https://www.ibge.gov.br/exemplo",
    titulo: null,
    dataDaPagina: "2026-09-10",
    dataTexto: "2026-09-10",
    antigo: false,
    citacao: "[exemplo] Os artigos de limpeza acumulam alta de 9,4% nos últimos 12 meses, acima da inflação geral.",
  },
  {
    id: 2,
    texto: "A inflação de tudo, no mesmo período, foi de 4,1%.",
    fonteNome: "IBGE",
    fonteTipo: "oficial",
    url: "https://www.ibge.gov.br/exemplo-2",
    titulo: null,
    dataDaPagina: "2026-09-10",
    dataTexto: "2026-09-10",
    antigo: false,
    citacao: "[exemplo] O índice geral de preços fechou os 12 meses em 4,1%.",
  },
  {
    id: 3,
    texto: "41% das pessoas trocaram de marca de produto de limpeza por causa do preço.",
    fonteNome: "Diário Nacional",
    fonteTipo: "imprensa",
    url: "https://www.diarionacional.exemplo.gov.br/troca",
    titulo: null,
    dataDaPagina: "2026-09-02",
    dataTexto: "2026-09-02",
    antigo: false,
    citacao: "[exemplo] 41% dos entrevistados disseram ter trocado de marca no último semestre por causa do preço.",
  },
  {
    id: 4,
    texto: "Do outro lado: os fabricantes dizem que a alta veio da embalagem e do frete.",
    fonteNome: "Portal do Varejo",
    fonteTipo: "imprensa",
    url: "https://www.portaldovarejo.exemplo.gov.br/frete",
    titulo: null,
    dataDaPagina: "2026-09-05",
    dataTexto: "2026-09-05",
    antigo: false,
    citacao: "[exemplo] Segundo a associação do setor, embalagem e frete explicam a maior parte do reajuste.",
  },
  {
    id: 5,
    texto: "O Procon orienta comparar o preço pelo litro, não pelo tamanho da embalagem.",
    fonteNome: "Procon",
    fonteTipo: "oficial",
    url: "https://www.procon.exemplo.gov.br/litro",
    titulo: null,
    dataDaPagina: "2026-08-28",
    dataTexto: "2026-08-28",
    antigo: false,
    citacao: "[exemplo] Antes de escolher, compare o preço por litro ou por quilo, que aparece na etiqueta da prateleira.",
  },
  {
    id: 6,
    texto: "No ano anterior, a alta tinha sido de 3,2%.",
    fonteNome: "IBGE",
    fonteTipo: "oficial",
    url: "https://www.ibge.gov.br/exemplo-antigo",
    titulo: null,
    dataDaPagina: "2025-03-10",
    dataTexto: "2025-03-10",
    antigo: true,
    citacao: "[exemplo] Em 2024, os artigos de limpeza subiram 3,2%.",
  },
];

const DESTINO: DestinoDaPesquisa = { tipo: "objetivo", consulta: { livre: "o preço dos produtos de limpeza subiu este ano" } };

const CONTEUDO_DO_ROTEIRO = {
  titulo: TITULO_DO_ROTEIRO,
  duracaoS: 40,
  gancho: "O produto de limpeza ficou 9,4% mais caro em um ano. Dá para gastar menos sem trocar de marca.",
  corpo:
    "Mostre duas embalagens na prateleira, uma grande e uma pequena. Diga: segundo o IBGE, a alta foi de 9,4%, e a inflação de tudo foi de 4,1%.\n\nVire as etiquetas e mostre o preço por litro. Diga que 41% trocaram de marca por causa do preço, segundo o Diário Nacional, e que antes de trocar vale fazer essa conta.",
  fechamento: "Mostre a que rende mais.",
  chamadaFinal: "Me manda o nome do produto que você usa, que eu te digo se tem um jeito mais barato de usar.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na frente da prateleira de produtos de limpeza",
  edicao: {
    textoNaTela: [{ quando: "0 a 3 s", onde: "no topo", oQue: "9,4% em 1 ano" }],
    ritmoDeCorte: "um corte a cada 4 segundos",
    recursos: ["aproxime nas etiquetas da prateleira, uma de cada vez"],
    audio: null,
    referencia: null,
  },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
  entregaDaPesquisa: {
    ganchos: [
      { texto: "O produto de limpeza ficou 9,4% mais caro em um ano.", recomendado: true },
      { texto: "Você paga mais caro e nem percebe.", recomendado: false },
      { texto: "Antes de trocar de marca, faça esta conta.", recomendado: false },
    ],
    oQueVaoTeResponder: [
      { objecao: "Pode aparecer: no mercado está mais barato.", resposta: "Compare pelo litro: o barato que rende menos sai mais caro." },
      { objecao: "Pode aparecer: isso é culpa do imposto.", resposta: "Em parte. Os fabricantes falam de embalagem e de frete; o que está na sua mão é comprar certo." },
      { objecao: "Pode aparecer: 9,4% não é tanto assim.", resposta: "É mais que o dobro da inflação do mesmo período, que foi de 4,1%." },
    ],
    fontes: [1, 2, 3],
    atencao: [
      "Os números são do IBGE, de agosto. Se sair um número novo antes de você postar, use o novo.",
      "Preço da sua loja na tela, só se for o de hoje.",
    ],
  },
};

/** Esconde o portal e o que é fixo ou grudado (as barras ficam por cima do recorte); `restaurarTela` devolve o que escondeu, para a tela continuar usável depois da foto. */
async function limparTela(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const posicao = getComputedStyle(el).position;
      if (posicao === "fixed" || posicao === "sticky") {
        el.setAttribute("data-oculto-pela-captura", el.style.visibility);
        el.style.visibility = "hidden";
      }
    }
  });
}

async function restaurarTela(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-oculto-pela-captura]")) {
      el.style.visibility = el.getAttribute("data-oculto-pela-captura") ?? "";
      el.removeAttribute("data-oculto-pela-captura");
    }
  });
}

async function fotografarTela(page: Page, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: arquivo, fullPage: true });
  await restaurarTela(page);
}

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await limparTela(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
  await restaurarTela(page);
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e54-pr3.ts <nome-da-pasta> (ex.: "pr-e54-3")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca) throw new Error(`marca de seed "${USUARIO}" nao encontrada; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).`);

  const criadas: number[] = [];
  const semear = async (valores: Partial<typeof pesquisasNaHora.$inferInsert> = {}) => {
    const [linha] = await db()
      .insert(pesquisasNaHora)
      .values({
        clienteId: marca.id,
        pedido: PEDIDO,
        tema: "o preço dos produtos de limpeza subiu este ano",
        destino: DESTINO,
        status: "pronta",
        achados: ACHADOS,
        selecionados: [1, 2, 3],
        buscas: 3,
        custoUsd: "0.05",
        terminadoEm: new Date(),
        ...valores,
      })
      .returning();
    criadas.push(linha.id);
    return linha.id;
  };
  const apagarPesquisas = async () => {
    if (criadas.length > 0) await db().delete(pesquisasNaHora).where(inArray(pesquisasNaHora.id, criadas));
    criadas.length = 0;
  };

  const gravados: string[] = [];
  const browser = await chromium.launch();
  let roteiroId: number | null = null;
  try {
    // O roteiro com pesquisa (a cópia dos dados que a pessoa marcou fica no roteiro).
    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: marca.id,
        data: hojeISO(),
        tema: "o preço dos produtos de limpeza subiu este ano",
        origem: "livre",
        objetivo: "conversao",
        formato: "reels",
        estilo: "falado",
        conteudo: CONTEUDO_DO_ROTEIRO as never,
        status: "gerado",
        pesquisaNaHora: {
          pesquisaId: 0,
          dados: ACHADOS.slice(0, 3),
          posicaoDaPessoa: null,
          decisaoDaPremissa: null,
          avisoDaPremissa: null,
          pesquisadaEm: new Date().toISOString(),
        },
      })
      .returning({ id: roteiros.id });
    roteiroId = roteiro.id;

    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const nome = (tela: string) => path.join(pastaDestino, `${tela}.${tamanho.rotulo}.${modo.rotulo}.png`);
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme });
        const page = await contexto.newPage();
        page.setDefaultTimeout(120_000);
        await entrar(page, baseUrl);
        const registrar = (arquivo: string) => gravados.push(arquivo);

        // O Tema livre: o campo fechado, aberto e sem saldo (a nota é a do próprio tema; o campo depende dela, então a tela de nota é montada abrindo a fase pelo texto de teste).
        await page.goto(`${baseUrl}/criar/tema-livre`);
        await page.getByLabel("Sobre o que você quer falar?").fill("aprova este tema de teste sem ressalva");
        await page.getByRole("button", { name: "Avaliar o tema" }).click();
        await page.getByRole("button", { name: /Pesquisar antes de escrever/ }).waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarTela(page, nome("TemaLivre.Pesquisa.Fechado"));
        registrar(nome("TemaLivre.Pesquisa.Fechado"));
        await page.getByRole("button", { name: /Pesquisar antes de escrever/ }).click();
        await page.getByRole("textbox", { name: "O que pesquisar" }).fill(PEDIDO);
        await fotografarTela(page, nome("TemaLivre.Pesquisa.Aberto"));
        registrar(nome("TemaLivre.Pesquisa.Aberto"));

        const tres = [await semear({ status: "erro", buscas: 3 }), await semear({ status: "erro", buscas: 3 }), await semear({ status: "erro", buscas: 3 })];
        void tres;
        await page.goto(`${baseUrl}/criar/tema-livre`);
        await page.getByLabel("Sobre o que você quer falar?").fill("aprova este tema de teste sem ressalva");
        await page.getByRole("button", { name: "Avaliar o tema" }).click();
        await page.locator('[data-pesquisar="sem-saldo"]').waitFor();
        await fotografarTela(page, nome("TemaLivre.Pesquisa.SemSaldo"));
        registrar(nome("TemaLivre.Pesquisa.SemSaldo"));
        await apagarPesquisas();

        // A tela da pesquisa
        const espera = await semear({ status: "pesquisando", achados: [], selecionados: [], buscas: 0, terminadoEm: null });
        await page.goto(`${baseUrl}/criar/pesquisa/${espera}`);
        await page.locator("[data-pesquisando]").waitFor();
        await page.waitForTimeout(600);
        // A espera cobre a tela inteira (é fixa): aqui ela é o conteúdo, então não se esconde o que é fixo.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.screenshot({ path: nome("Pesquisa.Pesquisando") });
        registrar(nome("Pesquisa.Pesquisando"));

        // O Criar com a pesquisa deixada para depois (rodando e pronta)
        await page.goto(`${baseUrl}/criar`);
        await page.locator('[data-pesquisa-em-aberto="pesquisando"]').waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarElemento(page, page.locator('[data-pesquisa-em-aberto="pesquisando"]'), nome("Criar.PesquisaEmAberto.Pesquisando"));
        registrar(nome("Criar.PesquisaEmAberto.Pesquisando"));
        await db().update(pesquisasNaHora).set({ status: "pronta", achados: ACHADOS, selecionados: [1, 2, 3], terminadoEm: new Date(), buscas: 3 }).where(eq(pesquisasNaHora.id, espera));
        await page.goto(`${baseUrl}/criar`);
        await page.locator('[data-pesquisa-em-aberto="pronta"]').waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarElemento(page, page.locator('[data-pesquisa-em-aberto="pronta"]'), nome("Criar.PesquisaEmAberto.Pronta"));
        registrar(nome("Criar.PesquisaEmAberto.Pronta"));

        await page.goto(`${baseUrl}/criar/pesquisa/${espera}`);
        await page.getByRole("heading", { name: "O que a pesquisa achou", level: 1 }).waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarTela(page, nome("Pesquisa.Achados"));
        registrar(nome("Pesquisa.Achados"));

        const premissa = await semear({
          premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: o preço subiu 9,4% em 12 meses, não dobrou.", anguloSugerido: "Dá para falar da alta de 9,4% e de quem está trocando de marca, sem dizer que dobrou.", achadoIds: [1] },
          perguntaDePosicao: { pergunta: "Para você, de quem é a culpa da alta?", opcoes: ["Do fabricante", "Do imposto e do frete", "Dos dois", "Prefiro não dar opinião"] },
        });
        await page.goto(`${baseUrl}/criar/pesquisa/${premissa}`);
        await page.getByText("O que você escreveu não bate com as fontes", { exact: true }).waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarTela(page, nome("Pesquisa.Premissa"));
        registrar(nome("Pesquisa.Premissa"));
        await page.getByRole("radio", { name: /Seguir com o que eu escrevi, mesmo assim/ }).click();
        await fotografarTela(page, nome("Pesquisa.PremissaMantida"));
        registrar(nome("Pesquisa.PremissaMantida"));
        await page.getByRole("button", { name: "Escrever com estes 3" }).click();
        await page.getByRole("heading", { name: "Uma pergunta antes de escrever", level: 1 }).waitFor();
        await page.getByRole("radio", { name: "Dos dois" }).click();
        await fotografarTela(page, nome("Pesquisa.Posicao"));
        registrar(nome("Pesquisa.Posicao"));

        const vazia = await semear({ status: "sem_achados", achados: [], selecionados: [] });
        await page.goto(`${baseUrl}/criar/pesquisa/${vazia}`);
        await page.getByRole("heading", { name: "Não achamos dado confiável sobre isso", level: 1 }).waitFor();
        await fotografarTela(page, nome("Pesquisa.SemAchados"));
        registrar(nome("Pesquisa.SemAchados"));

        const quebrada = await semear({ status: "erro", achados: [], selecionados: [], buscas: 0, motivo: "A pesquisa não terminou. Tente de novo em alguns minutos, ou escreva sem pesquisa." });
        await page.goto(`${baseUrl}/criar/pesquisa/${quebrada}`);
        await page.getByRole("heading", { name: "A pesquisa não terminou", level: 1 }).waitFor();
        await fotografarTela(page, nome("Pesquisa.Erro"));
        registrar(nome("Pesquisa.Erro"));

        // O objetivo com a pesquisa presa e o roteiro com pesquisa
        const pronta = await semear();
        await page.goto(`${baseUrl}/criar/objetivo?livre=${encodeURIComponent("o preço dos produtos de limpeza subiu este ano")}&pesquisa=${pronta}`);
        await page.getByText("Com pesquisa: 3 dados").waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarTela(page, nome("Objetivo.ComPesquisa"));
        registrar(nome("Objetivo.ComPesquisa"));

        await page.goto(`${baseUrl}/roteiros/${roteiroId}`);
        await page.locator("[data-selo-pesquisa]").waitFor();
        await page.waitForLoadState("networkidle");
        await fotografarTela(page, nome("Roteiro.ComPesquisa"));
        registrar(nome("Roteiro.ComPesquisa"));

        await apagarPesquisas();
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await apagarPesquisas();
    if (roteiroId !== null) await db().delete(roteiros).where(and(eq(roteiros.id, roteiroId), like(roteiros.tema, "o preço dos produtos de limpeza%")));
  }

  console.log(`${gravados.length} captura(s) gravada(s) em ${pastaDestino}`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  // O pool do banco fica aberto se algo falhar no meio, e o processo nunca terminaria.
  .finally(() => getPool().end());
