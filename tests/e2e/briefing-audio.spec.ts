/**
 * "Responder falando" no briefing (P2, item 2): o gravador de verdade, com um dispositivo de
 * audio sintetico do Chromium (`playwright.config.ts`, `launchOptions`, so para este navegador de
 * teste) e a rota `/api/transcrever` interceptada (o `webServer.env` zera `GROQ_API_KEY`, para
 * nunca chamar a Groq de verdade); a organizacao da fala usa o provedor mock de sempre
 * (`AI_PROVIDER=mock`), entao `organizarFalaBriefingAction` roda de ponta a ponta sem chave
 * nenhuma. Mesmo padrao de fixture de `briefing.spec.ts` (um cliente novo, sem briefing, cai
 * direto no bloco 1 de `/comecar`).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, clientes, membrosMarca, nichos, preferenciasUsuario, user } from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
}

async function prepararCliente(id: string) {
  await db().delete(user).where(eq(user.id, id));
  const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

  await db().insert(user).values({ id, name: "[teste] Responder Falando", email: `${id}@exemplo.teste` });
  await db()
    .insert(account)
    .values({
      id: `${id}-credential`,
      issuer: "local:credential",
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(SENHA),
    });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: id, nome: "[teste] Marca Responder Falando", alcance: "brasil", nichoId: nicho.id })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
  await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
}

test.describe("responder o briefing falando (P2, item 2)", () => {
  test.use({ permissions: ["microphone"] });

  test("grava, a transcricao organizada entra no campo, e da para desfazer", async ({ page }) => {
    const id = "e2e-responder-falando";
    await prepararCliente(id);

    let chamadasDeTranscricao = 0;
    await page.route("**/api/transcrever", async (rota) => {
      chamadasDeTranscricao += 1;
      const transcricao =
        chamadasDeTranscricao === 1
          ? "Então assim, eu atendo bastante gente que liga perguntando, é, se a gente faz orcamento pelo whatsapp mesmo, e eu falo que sim"
          : "e também respondo sempre no mesmo dia";
      await rota.fulfill({ json: { transcricao } });
    });

    await entrar(page, `${id}@exemplo.teste`);
    await expect(page).toHaveURL(/\/comecar/);
    await expect(page.getByText("bloco 1 de 5")).toBeVisible();

    // Os doze campos ficam montados e escondidos por bloco (mesmo achado de `briefing.spec.ts`);
    // escopar pela pergunta P1 evita casar com o botao/dica das outras onze.
    const cartaoP1 = page.locator("#pergunta-p1");
    const campo = page.getByLabel("o que o seu negócio faz hoje");
    await expect(cartaoP1.getByText("Pode responder falando")).toBeVisible();

    await cartaoP1.getByRole("button", { name: "Responder falando" }).click();
    await expect(cartaoP1.getByRole("button", { name: "Parar" })).toBeVisible();
    // Um instante gravando de verdade (o dispositivo sintetico do Chromium produz audio continuo,
    // nunca silencio puro), para o blob nao sair vazio.
    await page.waitForTimeout(500);
    await cartaoP1.getByRole("button", { name: "Parar" }).click();

    // A tarefa organizarFalaBriefing (mock) tira "então assim", "é" e "né"; o resto da fala fica.
    await expect(campo).toHaveValue(/atendo bastante gente/i);
    await expect(campo).not.toHaveValue(/então assim/i);
    await expect(page.getByText("Resposta substituída pelo que você falou")).toBeVisible();

    // M4/P2b, item 0a: uma segunda gravação, com o campo já preenchido, soma numa linha nova em
    // vez de substituir (antes, a segunda sumia com a primeira).
    const primeiraResposta = await campo.inputValue();
    await cartaoP1.getByRole("button", { name: "Responder falando" }).click();
    await expect(cartaoP1.getByRole("button", { name: "Parar" })).toBeVisible();
    await page.waitForTimeout(500);
    await cartaoP1.getByRole("button", { name: "Parar" }).click();

    await expect(campo).toHaveValue(new RegExp(`${primeiraResposta}\\n.*respondo sempre no mesmo dia`));
    await expect(page.getByText("Acrescentamos o que você falou")).toBeVisible();

    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(campo).toHaveValue(primeiraResposta);
  });

  test("sem microfone (aparelho sem suporte), mostra o aviso e o campo continua utilizavel", async ({ page }) => {
    const id = "e2e-responder-falando-sem-mic";
    await prepararCliente(id);

    await entrar(page, `${id}@exemplo.teste`);
    await expect(page).toHaveURL(/\/comecar/);
    await expect(page.getByText("bloco 1 de 5")).toBeVisible();

    // Remove o MediaRecorder do navegador desta pagina, simulando um aparelho sem suporte
    // (mesmo efeito de `typeof MediaRecorder === "undefined"` em `useGravadorDeAudio`).
    await page.addInitScript(() => {
      // @ts-expect-error -- apagar de proposito, so nesta pagina de teste.
      delete window.MediaRecorder;
    });
    await page.reload();

    const cartaoP1 = page.locator("#pergunta-p1");
    await cartaoP1.getByRole("button", { name: "Responder falando" }).click();
    await expect(cartaoP1.getByText("Não conseguimos usar o microfone deste aparelho. Pode escrever direto.")).toBeVisible();

    const campo = page.getByLabel("o que o seu negócio faz hoje");
    await campo.fill("atendimento bom, escrito direto");
    await expect(campo).toHaveValue("atendimento bom, escrito direto");
  });

  test("a previa aparece enquanto grava, antes do texto definitivo (P2b, camada b por pedacos)", async ({ page }) => {
    const id = "e2e-previa-ao-vivo";
    await prepararCliente(id);

    // Sem o reconhecimento de fala do navegador, de proposito: a previa cai direto para a camada b
    // (o segundo MediaRecorder por pedacos), sem depender de rede externa nem do fabricante do navegador.
    await page.addInitScript(() => {
      // @ts-expect-error -- apagar de proposito, so nesta pagina de teste.
      delete window.SpeechRecognition;
      // @ts-expect-error -- apagar de proposito, so nesta pagina de teste.
      delete window.webkitSpeechRecognition;
    });

    let chamadas = 0;
    await page.route("**/api/transcrever", async (rota) => {
      chamadas += 1;
      const transcricao = chamadas === 1 ? "aqui vai aparecendo o que você está falando" : "então assim isso ficou sendo o texto definitivo depois de organizar";
      await rota.fulfill({ json: { transcricao } });
    });

    await entrar(page, `${id}@exemplo.teste`);
    await expect(page).toHaveURL(/\/comecar/);
    await expect(page.getByText("bloco 1 de 5")).toBeVisible();

    const cartaoP1 = page.locator("#pergunta-p1");
    const campo = page.getByLabel("o que o seu negócio faz hoje");

    await cartaoP1.getByRole("button", { name: "Responder falando" }).click();
    await expect(cartaoP1.getByRole("button", { name: "Parar" })).toBeVisible();

    // O primeiro pedaco de 5s se fecha sozinho e manda a previa; ela aparece ANTES de parar a
    // gravacao, e o campo continua vazio (a previa nunca vira a resposta por conta propria).
    await expect(cartaoP1.getByText("aqui vai aparecendo o que você está falando")).toBeVisible({ timeout: 8_000 });
    await expect(campo).toHaveValue("");

    await cartaoP1.getByRole("button", { name: "Parar" }).click();

    // O texto definitivo (organizado, sem a muleta "então assim") troca a previa.
    await expect(campo).toHaveValue(/isso ficou sendo o texto definitivo depois de organizar/i);
    await expect(campo).not.toHaveValue(/então assim/i);
    await expect(campo).not.toHaveValue(/aqui vai aparecendo/i);
  });
});
