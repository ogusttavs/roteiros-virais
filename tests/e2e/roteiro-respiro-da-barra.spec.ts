/**
 * Achado do Gustavo em produção (22/10/2026, iPad na horizontal): na tela do roteiro, com um bloco aberto e os porquês abertos, a barra fixa de baixo (Modo gravação, Já gravei, Reprovar,
 * baixar) ficava por cima do cartão "O que faz / Com base em / Ver o vídeo", e o texto era cortado atrás dela. Aqui, no Chromium: com "Ver os porquês" ligado e a página rolada até o fim, o
 * último elemento do conteúdo termina acima do topo da barra, em quatro tamanhos de tela e nos dois temas. Com `CAPTURAS_ROTEIRO_BARRA=<pasta>` o mesmo teste também salva a captura de cada caso.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, user, videos, type ConteudoRoteiro } from "../../src/db/schema";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-respiro-barra@exemplo.teste";
const ID_USUARIO = "e2e-respiro-barra";
const TEMA = "roteiro com porques abertos e a barra de baixo";
const CAPTURAS = process.env.CAPTURAS_ROTEIRO_BARRA;

const TAMANHOS = [
  { nome: "390", largura: 390, altura: 844 },
  { nome: "ipad-em-pe-834x1194", largura: 834, altura: 1194 },
  { nome: "ipad-deitado-1194x834", largura: 1194, altura: 834 },
  { nome: "1280", largura: 1280, altura: 800 },
] as const;

let roteiroId: number;

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("o fim do roteiro não fica atrás da barra de ações", () => {
  test.beforeAll(async () => {
    const [existente] = await db().select({ id: user.id }).from(user).where(eq(user.id, ID_USUARIO));
    let marcaId: number;
    if (existente) {
      const [marca] = await db().select({ id: clientes.id }).from(clientes).where(eq(clientes.usuarioId, ID_USUARIO));
      marcaId = marca.id;
    } else {
      const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));
      await db().insert(user).values({ id: ID_USUARIO, name: "[teste] Respiro da barra", email: EMAIL });
      await db()
        .insert(account)
        .values({ id: `${ID_USUARIO}-credential`, issuer: "local:credential", accountId: ID_USUARIO, providerId: "credential", userId: ID_USUARIO, password: await hashPassword(SENHA) });
      const [marca] = await db().insert(clientes).values({ usuarioId: ID_USUARIO, nome: "[teste] Respiro da barra", nichoId: nicho.id }).returning();
      await db().insert(membrosMarca).values({ usuarioId: ID_USUARIO, clienteId: marca.id, papel: "dono" });
      await db().insert(preferenciasUsuario).values({ usuarioId: ID_USUARIO, aceitouTermosEm: new Date() });
      await db().insert(briefings).values({ clienteId: marca.id, completo: true });
      marcaId = marca.id;
    }

    const [jaExiste] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.tema, TEMA));
    if (jaExiste) {
      roteiroId = jaExiste.id;
      return;
    }
    const [video] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-respiro-barra",
        url: "https://exemplo.invalido/e2e-respiro-barra",
        titulo: "o produto que tira qualquer mancha do estofado",
        foraDaCurva: "6",
        publicadoEm: new Date(),
        analise: { assunto: "mancha em estofado", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", formato: "fala_para_camera", porQueFuncionou: "mostra o produto agindo antes de explicar" } as never,
      })
      .returning();
    const frase = "Quase sempre sobra produto fundo no tecido, e é por isso que a mancha volta depois de uns dias. Passe água morna e depois o tira-mancha, sem esfregar. ";
    const conteudo: ConteudoRoteiro = {
      titulo: "A mancha que volta",
      duracaoS: 40,
      gancho: "A mancha voltou depois da limpeza e ninguém te conta o porquê.",
      corpo: frase.repeat(4),
      fechamento: "Em dois minutos o banco fica limpo de novo.",
      chamadaFinal: "Chame no WhatsApp e peça o kit por R$ 89.",
      cartoes: null,
      porQueAssim: [
        { regra: "Gancho com o problema", motivo: "A pessoa se reconhece na primeira frase." },
        { regra: "Prova na tela", motivo: "Mostrar o antes e o depois vale mais que explicar." },
      ],
      porQueDosBlocos: [
        { bloco: "gancho", regras: ["R-COPY-05"], video: { videoId: video.id, segundo: 12 }, para: "fiquem" },
        { bloco: "corpo", regras: ["R-COPY-13", "R-COPY-12"], video: { videoId: video.id, segundo: 31 }, para: "confiem" },
        { bloco: "fechamento", regras: ["R-COPY-12"], para: "guardem" },
        { bloco: "chamada", regras: ["R-COPY-25"], video: { videoId: video.id, segundo: 55 }, para: "chamem" },
        { bloco: "tela:0", regras: ["R-COPY-12"], video: { videoId: video.id, segundo: 5 } },
        { bloco: "tela:1", regras: ["R-COPY-12"], video: { videoId: video.id, segundo: 18 } },
        { bloco: "tela:2", regras: ["R-COPY-12"], video: { videoId: video.id, segundo: 40 } },
      ],
      cenas: [{ momento: "0 a 3 s", oQueFazer: "mostrar a mancha de perto" }],
      ondeGravar: "no seu carro",
      edicao: {
        textoNaTela: [
          { quando: "0 a 2 s", oQue: "a mancha voltou?", onde: "no topo" },
          { quando: "3 a 8 s", oQue: "o segredo está no enxágue", onde: "no meio" },
          { quando: "30 a 35 s", oQue: "kit por R$ 89", onde: "embaixo" },
        ],
        ritmoDeCorte: "rápido, um corte a cada dois segundos",
        recursos: ["close da mancha", "antes e depois lado a lado", "zoom no tecido"],
        audio: "uma música calma de fundo",
        referencia: { videoId: video.id, segundo: 12, oQueOlhar: "como ele mostra a mancha antes de explicar" },
      },
      evidencias: [video.id],
      semEvidencia: false,
      forcaEvidencia: "forte",
    };
    const [roteiro] = await db()
      .insert(roteiros)
      .values({ clienteId: marcaId, data: "2026-10-10", tema: TEMA, origem: "sugerido", objetivo: "conversao", formato: "reels", estilo: "falado", referenciaVideoId: video.id, conteudo })
      .returning({ id: roteiros.id });
    roteiroId = roteiro.id;
  });

  for (const tamanho of TAMANHOS) {
    for (const tema of ["light", "dark"] as const) {
      test(`${tamanho.nome} no tema ${tema === "light" ? "claro" : "escuro"}: com os porquês abertos e a página no fim, o último elemento termina acima da barra`, async ({ page }) => {
        await page.setViewportSize({ width: tamanho.largura, height: tamanho.altura });
        await page.emulateMedia({ colorScheme: tema });
        await entrar(page);
        await page.goto(`/roteiros/${roteiroId}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        await page.getByRole("button", { name: "Ver os porquês" }).click();
        await expect(page.getByText("O que faz:").first()).toBeVisible();

        // Do tablet deitado para cima o cartão "Como editar" gruda ao lado: enquanto ele estiver colado, nenhum pedaço dele pode ficar atrás da barra, e o que não cabe tem de rolar dentro dele.
        const lado = page.locator('[class*="ladoGrudado"]').first();
        if (tamanho.largura >= 1024) {
          await expect(lado).toBeVisible();
          const topoDaBarraSemRolar = (await page.locator("[data-barra-acoes-propria]").first().boundingBox())!.y;
          let conferidoColado = 0;
          for (const y of [300, 600, 900, 1200]) {
            await page.evaluate((alvo) => window.scrollTo(0, alvo), y);
            await page.waitForTimeout(150);
            const caixa = (await lado.boundingBox())!;
            if (caixa.y > 120) continue; // ainda não colou: sobe com a página, como sempre
            conferidoColado += 1;
            expect(caixa.y + caixa.height, `rolagem ${y}: o cartão colado do lado termina acima da barra`).toBeLessThanOrEqual(topoDaBarraSemRolar + 0.5);
          }
          expect(conferidoColado, "o cartão colou em ao menos uma das rolagens").toBeGreaterThan(0);
          // O que não cabe rola dentro do cartão: o último filho chega acima da barra.
          await page.evaluate(() => window.scrollTo(0, 900));
          await page.waitForTimeout(150);
          const nomeDaCaptura = `${tamanho.nome}-${tema === "light" ? "claro" : "escuro"}`;
          if (CAPTURAS) {
            mkdirSync(CAPTURAS, { recursive: true });
            await page.screenshot({ path: join(CAPTURAS, `${nomeDaCaptura}-meio-cartao-colado.png`) });
          }
          await lado.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          await page.waitForTimeout(150);
          if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, `${nomeDaCaptura}-meio-cartao-no-fim.png`) });
          const ultimo = await lado.evaluate((el) => {
            const filhos = Array.from(el.querySelectorAll("*")).filter((f) => f.getBoundingClientRect().height > 0);
            return Math.max(...filhos.map((f) => f.getBoundingClientRect().bottom));
          });
          expect(ultimo, "no fim da rolagem do cartão, o último texto fica acima da barra").toBeLessThanOrEqual(topoDaBarraSemRolar + 0.5);
        }

        // Rola em passos, como o dedo, até não haver mais página.
        for (let i = 0; i < 60; i += 1) {
          await page.mouse.wheel(0, 500);
          await page.waitForTimeout(30);
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(400);

        const barra = page.locator("[data-barra-acoes-propria]").first();
        await expect(barra).toBeVisible();
        const topoDaBarra = (await barra.boundingBox())!.y;

        // O último elemento do conteúdo: o que mais desce entre tudo que está dentro do miolo e não é fixo.
        const fimDoConteudo = await page.evaluate(() => {
          const miolo = document.querySelector('[class*="miolo"]');
          if (!miolo) return null;
          let maior = 0;
          let quem = "";
          for (const el of Array.from(miolo.querySelectorAll("*"))) {
            const estilo = getComputedStyle(el);
            if (estilo.position === "fixed" || estilo.display === "none" || estilo.visibility === "hidden") continue;
            const caixa = el.getBoundingClientRect();
            if (caixa.height === 0 || caixa.width === 0) continue;
            if (caixa.bottom > maior) {
              maior = caixa.bottom;
              quem = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}: ${(el.textContent ?? "").trim().slice(0, 40)}`;
            }
          }
          return { fundo: maior, quem };
        });
        expect(fimDoConteudo, "o miolo do roteiro existe").not.toBeNull();

        if (CAPTURAS) {
          mkdirSync(CAPTURAS, { recursive: true });
          await page.screenshot({ path: join(CAPTURAS, `${tamanho.nome}-${tema === "light" ? "claro" : "escuro"}.png`) });
        }

        expect(fimDoConteudo!.fundo, `o fim do conteúdo (${fimDoConteudo!.quem}) deve ficar acima da barra`).toBeLessThanOrEqual(topoDaBarra + 0.5);
      });
    }
  }
});
