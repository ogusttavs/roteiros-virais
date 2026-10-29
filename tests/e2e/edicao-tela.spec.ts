/**
 * E47 PR 4, "Editar o meu vídeo" pela tela do roteiro, no CELULAR e no COMPUTADOR, pelo servidor de verdade (`next start`) com a sessão de verdade, um vídeo SINTÉTICO (nenhum vídeo de
 * ninguém) e o ffmpeg de verdade. O worker, a Groq e a IA não sobem: o teste faz o papel deles escrevendo no banco o que eles escreveriam (a fala, o plano e o `verificado` da decisão) e chama
 * o render como o contêiner de render chama (`rodarRenderizarEdicao`, que mexe no mesmo volume e no mesmo banco que o servidor).
 *
 * Prova, pelo que a pessoa vê: a folha com o aviso de que o vídeo sai sem música, o envio do vídeo, a espera (preparando, a posição na fila, o andamento da prévia), a prévia pronta com o que
 * vale conferir, "Pedir ajuste" com o motivo (e o motivo guardado para a próxima decisão), "Aprovar", o vídeo final com baixar o vídeo e a legenda, e "Publicar no Instagram" com o arquivo
 * editado do servidor chegando inteiro à Meta SIMULADA. E que o "ver como" do admin só vê o aviso e que outra marca não alcança a edição.
 */
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, contasConectadas, edicoes, membrosMarca, nichos, preferenciasUsuario, publicacoes, roteiros, user, videosCliente, type ConteudoRoteiro } from "../../src/db/schema";
import { caminhoNoVolume } from "../../src/edicao/arquivos";
import { energiaParaBanco } from "../../src/edicao/guardada";
import { gerarVideoSintetico, montarCasoSintetico, type CasoSintetico } from "../../src/edicao/sintetica-video";
import { rodarRenderizarEdicao } from "../../src/servicos/render-edicao";
import { fraseDaEdicao, textosEdicao } from "../../src/textos/edicao";
import { textosPublicar } from "../../src/textos/publicar";
import { CONTA_PADRAO, iniciarMetaSimulada, type MetaSimulada } from "../fixtures/meta-simulada";

const SENHA = "ExemploSenha123";
const DONO = "e2e-edtela-dono";
const DONO_EMAIL = "dono-e2e-edtela@exemplo.teste";
const OUTRO = "e2e-edtela-outro";
const OUTRO_EMAIL = "outro-e2e-edtela@exemplo.teste";
const t = textosEdicao.tela;
const tp = textosPublicar.tela;
const VOLUME = process.env.EDICAO_PASTA ?? "";

let marca: number;
let marcaDeFora: number;
let pasta: string;
let caso: CasoSintetico;
let videoBruto: Buffer;
let meta: MetaSimulada;

const CONTEUDO: ConteudoRoteiro = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 30,
  gancho: "O terceiro erro é o que mais estraga o copo.",
  corpo: "Quase sempre sobra detergente no fundo.",
  fechamento: "Enxágue sempre com água morna.",
  chamadaFinal: "Chame no WhatsApp e peça o seu orçamento.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na sua cozinha",
  edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|comecar)/);
}

async function criarPessoa(id: string, email: string, nome: string): Promise<void> {
  await db().delete(user).where(eq(user.id, id));
  await db().insert(user).values({ id, name: nome, email });
  await db().insert(account).values({ id: `${id}-c`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
}

async function novoRoteiro(clienteId = marca): Promise<number> {
  const [r] = await db()
    .insert(roteiros)
    .values({ clienteId, data: "2026-10-29", tema: "louça", origem: "livre", objetivo: "alcance", formato: "reels", estilo: "falado", conteudo: CONTEUDO })
    .returning({ id: roteiros.id });
  return r.id;
}

async function abrirFolha(page: Page, roteiroId: number): Promise<void> {
  await page.goto(`/roteiros/${roteiroId}`);
  await page.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: t.abrir }).click();
  // Cada passo da folha tem o próprio título (o do formulário é "Editar o meu vídeo", o do vídeo pronto é outro): o que vale é a folha ter aberto.
  await expect(page.locator("section[data-parte]").first()).toBeVisible();
}

/** O que o worker e a IA escreveriam quando a decisão termina: a fala, o plano e o `verificado`. O render, ele mesmo, é o de verdade. */
async function deixarVerificada(edicaoId: number): Promise<void> {
  await db()
    .update(edicoes)
    .set({
      estado: "verificado",
      palavras: caso.palavras,
      energia: energiaParaBanco(caso.energia),
      decisao: caso.decisao,
      resultado: { edl: caso.edl, legenda: caso.legenda, titulo: caso.titulo, avisos: ["Você disse 3.956 e o roteiro diz 3.976: a legenda seguiu o que você falou."], tentativas: 1, problemas: [], verificadaEm: new Date().toISOString() },
      atualizadaEm: new Date(),
    })
    .where(eq(edicoes.id, edicaoId));
}

async function edicaoDoRoteiro(roteiroId: number) {
  const [e] = await db().select().from(edicoes).where(eq(edicoes.roteiroId, roteiroId));
  return e;
}

const semFila = { enfileirar: async () => undefined };

async function limpar(): Promise<void> {
  const ids = [marca, marcaDeFora];
  await db().delete(publicacoes).where(inArray(publicacoes.clienteId, ids));
  await db().delete(videosCliente).where(inArray(videosCliente.clienteId, ids));
  await db().delete(edicoes).where(inArray(edicoes.clienteId, ids));
  await db().delete(roteiros).where(inArray(roteiros.clienteId, ids));
  await db().delete(contasConectadas).where(inArray(contasConectadas.clienteId, ids));
  await rm(VOLUME, { recursive: true, force: true });
}

const APARELHOS = [
  { nome: "celular", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { nome: "computador", viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false },
] as const;

test.describe("Editar o meu vídeo, na tela do roteiro", () => {
  test.beforeAll(async () => {
    expect(VOLUME, "EDICAO_PASTA precisa vir do playwright.config.ts").not.toBe("");
    pasta = await mkdtemp(join(tmpdir(), "edicao-tela-e2e-"));
    caso = montarCasoSintetico(14);
    // O bruto é pequeno (360x640): o servidor o aceita (até 1080p) e o render o leva a 540p e a 1080p.
    await gerarVideoSintetico(join(pasta, "bruto.mp4"), caso.duracaoDoBrutoS, { largura: 360, altura: 640 });
    videoBruto = await readFile(join(pasta, "bruto.mp4"));

    const [nicho] = await db().select().from(nichos).limit(1);
    await criarPessoa(DONO, DONO_EMAIL, "Dona Edicao Tela E2E");
    await criarPessoa(OUTRO, OUTRO_EMAIL, "Outra Marca Tela E2E");
    const [a, b] = await db()
      .insert(clientes)
      .values([
        { nome: "[teste e2e] Marca que edita na tela", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" },
        { nome: "[teste e2e] Marca de fora da tela", nichoId: nicho.id, tipo: "negocio", alcance: "brasil" },
      ])
      .returning();
    marca = a.id;
    marcaDeFora = b.id;
    await db().insert(membrosMarca).values([
      { usuarioId: DONO, clienteId: marca, papel: "dono" },
      { usuarioId: OUTRO, clienteId: marcaDeFora, papel: "dono" },
    ]);
    await db().insert(briefings).values([
      { clienteId: marca, completo: true },
      { clienteId: marcaDeFora, completo: true },
    ]);
  });

  test.afterAll(async () => {
    await limpar();
    await rm(pasta, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    await limpar();
  });

  for (const aparelho of APARELHOS) {
    test.describe(`no ${aparelho.nome}`, () => {
      test.use({ viewport: aparelho.viewport, hasTouch: aparelho.hasTouch, isMobile: aparelho.isMobile });

      test("do vídeo enviado ao vídeo pronto: espera, prévia, pedir ajuste, aprovar, baixar o vídeo e a legenda", async ({ page }) => {
        const roteiroId = await novoRoteiro();
        await entrar(page, DONO_EMAIL);
        await abrirFolha(page, roteiroId);

        // A folha de começar: o que a pessoa precisa saber antes de gravar e enviar.
        const folha = page.locator("[data-parte='formulario']");
        await expect(folha).toContainText(t.semMusica);
        await expect(folha).toContainText(t.usadas(0));
        await expect(folha.getByRole("button", { name: t.enviar })).toBeDisabled();

        // O envio: o vídeo vai inteiro para o servidor e a edição começa a ser preparada.
        await folha.locator("input[type=file]").setInputFiles({ name: "meu-video.mp4", mimeType: "video/mp4", buffer: videoBruto });
        await expect(folha).toContainText("meu-video.mp4");
        await folha.getByRole("button", { name: t.enviar }).click();
        await expect(page.locator("[data-parte='preparando']")).toContainText("Estamos ouvindo o seu vídeo", { timeout: 30_000 });
        const enviada = await edicaoDoRoteiro(roteiroId);
        expect(enviada).toMatchObject({ estado: "guardado", clienteId: marca });
        expect(existsSync(caminhoNoVolume(enviada.caminhoBruto as string))).toBe(true);
        expect(statSync(caminhoNoVolume(enviada.caminhoBruto as string)).size).toBe(videoBruto.byteLength);

        // Na fila da prévia, com um vídeo de outra marca na frente: a posição e a espera aparecem.
        const outroRoteiro = await novoRoteiro(marcaDeFora);
        await db().insert(edicoes).values({ clienteId: marcaDeFora, roteiroId: outroRoteiro, estado: "verificado", tamanhoBytes: 1000, tipoDoArquivo: "video/mp4", atualizadaEm: new Date(Date.now() - 60_000) });
        await deixarVerificada(enviada.id);
        await expect(page.locator("[data-parte='fila-da-previa']")).toContainText(t.esperandoAVez(1, 2), { timeout: 15_000 });
        await expect(page.locator("[data-parte='fila-da-previa']")).toContainText(t.semMusica);

        // Montando a prévia: o andamento.
        await db().delete(edicoes).where(eq(edicoes.clienteId, marcaDeFora));
        await db().update(edicoes).set({ estado: "montando_previa", progressoDoRender: 40 }).where(eq(edicoes.id, enviada.id));
        await expect(page.locator("[data-parte='montando-previa']")).toContainText(t.montandoPrevia(40), { timeout: 15_000 });
        await expect(page.locator("progress")).toHaveAttribute("value", "40");

        // O render de verdade (a prévia 540p) e a tela passa a mostrar a prévia.
        await db().update(edicoes).set({ estado: "verificado", progressoDoRender: null, atualizadaEm: new Date() }).where(eq(edicoes.id, enviada.id));
        await rodarRenderizarEdicao(enviada.id, "previa", semFila);
        const previa = page.locator("[data-parte='previa-pronta']");
        await expect(previa).toBeVisible({ timeout: 15_000 });
        await expect(previa.locator("video[data-previa]")).toHaveAttribute("src", `/api/edicao/${enviada.id}/previa`);
        await expect(previa).toContainText(t.previaAjuda);
        await expect(previa).toContainText(t.avisosTitulo);
        await expect(previa).toContainText("Você disse 3.956");
        await expect(previa).toContainText(t.semMusica);
        // O arquivo da prévia chega com Range (o Safari do iPhone só toca vídeo assim) e é um MP4 de verdade.
        const pedaco = await page.request.get(`/api/edicao/${enviada.id}/previa`, { headers: { range: "bytes=0-1023" } });
        expect(pedaco.status()).toBe(206);
        expect(pedaco.headers()["content-range"]).toMatch(/^bytes 0-1023\/\d+$/);
        expect((await pedaco.body()).subarray(4, 8).toString("latin1")).toBe("ftyp");

        // Pedir ajuste: o motivo é obrigatório, vai para a próxima decisão e a edição volta a ser preparada.
        await previa.getByRole("button", { name: t.refazer }).click();
        const ajuste = page.locator("[data-parte='pedir-ajuste']");
        await expect(ajuste).toContainText(t.refazerRestantes(3));
        await expect(ajuste.getByRole("button", { name: t.refazerEnviar })).toBeDisabled();
        await ajuste.getByLabel(t.refazerRotulo).fill("Deixe a abertura mais curta e mantenha a parte do preço");
        await ajuste.getByRole("button", { name: t.refazerEnviar }).click();
        await expect(page.locator("[data-parte='preparando']")).toContainText(t.refazeu);
        const refeita = await edicaoDoRoteiro(roteiroId);
        expect(refeita).toMatchObject({ estado: "transcrito", refeitas: 1, pedidosDeAjuste: ["Deixe a abertura mais curta e mantenha a parte do preço"] });
        expect(existsSync(join(VOLUME, "previa", `ed-${enviada.id}.mp4`))).toBe(false);

        // A decisão nova (do worker) termina, a prévia sai de novo, e agora a pessoa aprova.
        await deixarVerificada(enviada.id);
        await rodarRenderizarEdicao(enviada.id, "previa", semFila);
        await expect(previa).toBeVisible({ timeout: 15_000 });
        await previa.getByRole("button", { name: t.aprovar }).click();
        await expect(page.locator("[data-parte='fila-do-final']")).toBeVisible({ timeout: 15_000 });
        expect((await edicaoDoRoteiro(roteiroId)).estado).toBe("aprovada");

        // O render do final 1080p, e a tela mostra o vídeo pronto com o vídeo e a legenda para baixar.
        await rodarRenderizarEdicao(enviada.id, "final", semFila);
        const pronta = page.locator("[data-parte='pronta']");
        await expect(pronta).toBeVisible({ timeout: 15_000 });
        await expect(pronta.locator("video[data-pronto]")).toHaveAttribute("src", `/api/edicao/${enviada.id}/pronto`);
        await expect(pronta).toContainText(t.semMusica);
        await expect(pronta).toContainText("Fica guardado aqui até");
        // Sem Instagram ligado nesta conta, o botão de publicar não aparece.
        await expect(pronta.getByRole("button", { name: t.publicar })).toHaveCount(0);
        const [baixou] = await Promise.all([page.waitForEvent("download"), pronta.locator("[data-baixar-video]").click()]);
        expect(baixou.suggestedFilename()).toBe("video-editado.mp4");
        const caminhoBaixado = join(pasta, "baixado.mp4");
        await baixou.saveAs(caminhoBaixado);
        const baixado = await readFile(caminhoBaixado);
        expect(baixado.subarray(4, 8).toString("latin1")).toBe("ftyp");
        expect(baixado.byteLength).toBeGreaterThan(10_000);
        const legenda = await page.request.get(`/api/edicao/${enviada.id}/legenda`);
        expect(legenda.status()).toBe(200);
        expect(legenda.headers()["content-disposition"]).toBe('attachment; filename="legenda.srt"');
        expect(await legenda.text()).toBe(caso.legenda.srt);

        // O bruto e a prévia já saíram do servidor; só o vídeo pronto fica.
        expect(existsSync(join(VOLUME, "bruto", `ed-${enviada.id}.video`))).toBe(false);
        expect(existsSync(join(VOLUME, "previa", `ed-${enviada.id}.mp4`))).toBe(false);
        expect(existsSync(join(VOLUME, "editado", `ed-${enviada.id}.mp4`))).toBe(true);

        // Recarregar a página volta direto ao vídeo pronto.
        await abrirFolha(page, roteiroId);
        await expect(page.locator("[data-parte='pronta']")).toBeVisible();
      });

      test("o vídeo recusado mostra a frase em língua de gente, e o formulário continua para tentar de novo", async ({ page }) => {
        const roteiroId = await novoRoteiro();
        await entrar(page, DONO_EMAIL);
        await abrirFolha(page, roteiroId);
        const folha = page.locator("[data-parte='formulario']");
        // Um arquivo que não é vídeo é recusado já no aparelho, sem nem abrir a edição.
        await folha.locator("input[type=file]").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("png") });
        await expect(folha.getByRole("alert")).toContainText(fraseDaEdicao("arquivo-tipo"));
        expect(await edicaoDoRoteiro(roteiroId)).toBeUndefined();
        // E um vídeo que o servidor recusa (sem som) volta com a frase certa e deixa tentar de novo.
        await writeFile(join(pasta, "mudo.mp4"), await semSom());
        await folha.locator("input[type=file]").setInputFiles(join(pasta, "mudo.mp4"));
        await folha.getByRole("button", { name: t.enviar }).click();
        await expect(folha.getByRole("alert")).toContainText(fraseDaEdicao("sem-som"), { timeout: 30_000 });
        await expect(folha.getByRole("button", { name: t.escolherVideo }).or(folha.getByText(t.trocarVideo))).toBeVisible();
        expect((await edicaoDoRoteiro(roteiroId)).estado).toBe("falhou");
      });
    });
  }

  test("uma edição que falhou mostra o motivo na folha e deixa enviar outro vídeo; a marca de fora nunca alcança a edição dos outros", async ({ page, browser, baseURL }) => {
    const roteiroId = await novoRoteiro();
    const [e] = await db().insert(edicoes).values({ clienteId: marca, roteiroId, estado: "falhou", motivo: fraseDaEdicao("nao-montou"), tamanhoBytes: 1000, tipoDoArquivo: "video/mp4" }).returning();
    await entrar(page, DONO_EMAIL);
    await abrirFolha(page, roteiroId);
    await expect(page.locator("[data-parte='motivo-da-falha']")).toContainText(fraseDaEdicao("nao-montou"));
    await expect(page.getByRole("button", { name: t.enviar })).toBeVisible();

    const contexto = await browser.newContext({ baseURL });
    const fora = await contexto.newPage();
    await entrar(fora, OUTRO_EMAIL);
    expect((await fora.request.get(`/api/edicao/${e.id}`)).status()).toBe(404);
    expect((await fora.request.get(`/api/edicao/${e.id}/previa`)).status()).toBe(404);
    expect((await fora.request.get(`/api/edicao/${e.id}/pronto`)).status()).toBe(404);
    expect((await fora.request.get(`/api/edicao/${e.id}/legenda`)).status()).toBe(404);
    // Nem a tela do roteiro de outra marca abre.
    await fora.goto(`/roteiros/${roteiroId}`);
    await expect(fora).not.toHaveURL(new RegExp(`/roteiros/${roteiroId}$`));
    await contexto.close();
  });

  test("Publicar no Instagram com o vídeo editado do servidor: a Meta simulada recebe o arquivo inteiro, sem a pessoa escolher nada", async ({ page }) => {
    meta = await iniciarMetaSimulada(Number(process.env.PLAYWRIGHT_META_PORTA ?? 4747));
    try {
      const roteiroId = await novoRoteiro();
      await entrar(page, DONO_EMAIL);
      await page.goto("/api/meta/conectar");
      await expect(page.getByTestId("seu-instagram")).toHaveAttribute("data-estado", "ligada");

      // Uma edição pronta, com o vídeo editado de verdade no volume (o render de verdade a partir do bruto sintético).
      const [e] = await db().insert(edicoes).values({ clienteId: marca, roteiroId, estado: "verificado", tamanhoBytes: videoBruto.byteLength, tipoDoArquivo: "video/mp4" }).returning();
      await writeBruto(e.id);
      await deixarVerificada(e.id);
      await rodarRenderizarEdicao(e.id, "previa", semFila);
      await db().update(edicoes).set({ estado: "aprovada", atualizadaEm: new Date() }).where(eq(edicoes.id, e.id));
      await rodarRenderizarEdicao(e.id, "final", semFila);
      const tamanhoFinal = statSync(join(VOLUME, "editado", `ed-${e.id}.mp4`)).size;

      await abrirFolha(page, roteiroId);
      await page.locator("[data-parte='pronta']").getByRole("button", { name: t.publicar }).click();
      const folhaDePublicar = page.locator("[data-parte='formulario']");
      await expect(folhaDePublicar).toContainText(CONTA_PADRAO.username);
      await expect(folhaDePublicar).toContainText("Vai sair o seu vídeo editado");
      await expect(folhaDePublicar.locator("input[type=file]")).toHaveCount(0);
      await folhaDePublicar.getByRole("button", { name: tp.publicar }).click();
      await expect(page.getByText(tp.publicada)).toBeVisible({ timeout: 60_000 });

      // A Meta baixou o MESMO arquivo que está no servidor (o tamanho bate byte a byte) e o roteiro virou postado.
      expect(meta.chamadas.find((x) => x.caminho === "video_url")).toMatchObject({ bytes: tamanhoFinal, parametros: { status: "200", tipo: "video/mp4" } });
      const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroId));
      expect(roteiro.status).toBe("postado");
      const [p] = await db().select().from(publicacoes).where(and(eq(publicacoes.clienteId, marca), eq(publicacoes.roteiroId, roteiroId)));
      expect(p).toMatchObject({ estado: "publicada", tamanhoBytes: tamanhoFinal, tipoDoArquivo: "video/mp4" });
      // O vídeo editado continua no servidor para baixar (7 dias): publicar não o apaga.
      expect(existsSync(join(VOLUME, "editado", `ed-${e.id}.mp4`))).toBe(true);
    } finally {
      await meta.fechar();
    }
  });
});

async function writeBruto(edicaoId: number): Promise<void> {
  const { mkdir, copyFile } = await import("node:fs/promises");
  await mkdir(join(VOLUME, "bruto"), { recursive: true });
  const relativo = `bruto/ed-${edicaoId}.video`;
  await copyFile(join(pasta, "bruto.mp4"), join(VOLUME, relativo));
  await db().update(edicoes).set({ caminhoBruto: relativo, brutoExpiraEm: new Date(Date.now() + 48 * 3_600_000) }).where(eq(edicoes.id, edicaoId));
}

/** Um vídeo sem faixa de áudio, para a recusa do servidor. */
async function semSom(): Promise<Buffer> {
  const { execFileSync } = await import("node:child_process");
  const saida = join(pasta, "mudo-gerado.mp4");
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=15", "-t", "5", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", saida]);
  return readFile(saida);
}
