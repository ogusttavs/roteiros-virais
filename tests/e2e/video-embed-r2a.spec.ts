/**
 * R2a, a prévia do vídeo dentro do aplicativo (pedido do Gustavo em 01/10, 22:50): "O visualizador
 * dos vídeos está muito ruim. Eu clico para ver o vídeo, ele vai para o aplicativo, não dá para
 * saber o que está acontecendo. Só quero dar play e conseguir ver uma prévia do vídeo." O "De onde
 * veio" do roteiro ganha o mesmo `VideoEmbed` que a folha "Por que esse funcionou" de Referências
 * já tinha, numa miniatura compacta (`compacto`, 9rem). Vídeo real do YouTube ("Me at the zoo", o
 * primeiro do site, estável e sempre no ar, mesma escolha de `referencias.spec.ts`) para confirmar
 * o iframe de verdade, com o segundo inicial da referência.
 *
 * O Instagram não tem e2e de embed de verdade aqui (a prova com vídeo real da R2a, fora desta
 * suíte, achou que o Instagram nunca manda o aviso de redimensionar para um domínio que ele não
 * reconhece, nem com o `embed.js` oficial): o teste abaixo confirma a queda no link depois do
 * tempo limite, sem precisar de rede nenhuma de verdade (o `VideoEmbed` nunca chega a montar o
 * iframe do Instagram, então o teste não depende do instagram.com responder).
 */
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  roteiros,
  user,
  videos,
  type ConteudoRoteiro,
} from "../../src/db/schema";

const SENHA = "ExemploSenha123";

async function entrar(page: import("@playwright/test").Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

function analiseExemplo(assunto: string) {
  return {
    assunto,
    gancho: "gancho",
    estrutura: "estrutura",
    fechamento: "fechamento",
    chamadaFinal: "chamada",
    formato: "fala_para_camera" as const,
    porQueFuncionou: "x",
  };
}

test.describe("R2a, a prévia do vídeo dentro do aplicativo", () => {
  test("De onde veio, no roteiro, toca o vídeo de referência de verdade (YouTube)", async ({ page }) => {
    const id = "e2e-r2a-roteiro";
    await db().delete(user).where(eq(user.id, id));
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "limpeza-e-organizacao-da-casa"));

    await db().insert(user).values({ id, name: "[teste] R2a roteiro", email: `${id}@exemplo.teste` });
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
      .values({ usuarioId: id, nome: "[teste] R2a roteiro", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });

    const [video] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "e2e-r2a-video",
        // Vídeo real do YouTube ("Me at the zoo"), mesma escolha de referencias.spec.ts: confirma
        // o iframe de verdade, não só a transformação da URL.
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        nichoId: nicho.id,
        titulo: "video de referencia da R2a",
        foraDaCurva: "5",
        publicadoEm: new Date(),
        analise: analiseExemplo("teste r2a") as never,
      })
      .returning();

    const conteudo: ConteudoRoteiro = {
      titulo: "roteiro com referencia de verdade",
      duracaoS: 30,
      gancho: "gancho de teste",
      corpo: "corpo de teste",
      fechamento: "fechamento de teste",
      chamadaFinal: "chamada final de teste",
      cartoes: null,
      porQueAssim: [],
      cenas: [],
      ondeGravar: "na sala",
      edicao: {
        textoNaTela: [],
        ritmoDeCorte: "moderado",
        recursos: [],
        audio: null,
        referencia: { videoId: video.id, segundo: 4, oQueOlhar: "o gancho" },
      },
      evidencias: [video.id],
      semEvidencia: false,
      forcaEvidencia: "media",
    };
    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: "2026-01-01",
        tema: conteudo.titulo,
        origem: "sugerido",
        objetivo: "conversao",
        conteudo,
        // A folha "De onde veio" lê o vídeo por esta coluna (page.tsx), não pelo
        // `conteudo.edicao.referencia.videoId` sozinho.
        referenciaVideoId: video.id,
      })
      .returning();

    await entrar(page, `${id}@exemplo.teste`);
    await page.goto(`/roteiros/${roteiro.id}`);

    const secao = page.locator("section", { hasText: "Referência" });
    await expect(secao.getByText("O trecho que interessa começa em 0:04")).toBeVisible();
    await expect(secao.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/jNQXAC9IVRw\?start=4/, {
      timeout: 10_000,
    });
  });

  test("Instagram sem embed cai no reserva (moldura escurecida, motivo e botão) depois do tempo limite", async ({ page }) => {
    test.setTimeout(20_000);
    const id = "e2e-r2a-instagram";
    await db().delete(user).where(eq(user.id, id));
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));

    await db().insert(user).values({ id, name: "[teste] R2a instagram", email: `${id}@exemplo.teste` });
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
      .values({ usuarioId: id, nome: "[teste] R2a instagram", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true });

    await db()
      .insert(videos)
      .values({
        plataforma: "instagram",
        idExterno: "e2e-r2a-instagram-video",
        // URL real do Instagram (o formato /p/<codigo>/, não o vídeo em si): o `VideoEmbed` nunca
        // chega a chamar a rede para o Instagram (achado da prova com vídeo real da R2a, fora
        // desta suíte), então o teste não depende do instagram.com responder; precisa só do
        // domínio certo para `urlEmbedInstagram` reconhecer e entrar no caminho do tempo limite.
        url: "https://www.instagram.com/p/e2e-r2a-instagram/",
        nichoId: nicho.id,
        titulo: "video sem embed de verdade",
        views: 60000,
        foraDaCurva: "20.0",
        // Sem idioma, a cota de 70/30 do Brasil (M5a, achado 2: Referências continua com ela)
        // descarta o único vídeo do pool por não saber classificar.
        idioma: "pt",
        publicadoEm: new Date(),
        analise: analiseExemplo("teste r2a instagram") as never,
      });

    await entrar(page, `${id}@exemplo.teste`);
    await page.goto("/referencias");

    const cartao = page.locator("article", { hasText: "video sem embed de verdade" });
    await cartao.getByRole("button", { name: "Ver detalhes" }).click();

    const folha = page.getByRole("dialog", { name: "Por que esse funcionou" });
    await expect(folha).toBeVisible();
    await expect(folha.getByText("O Instagram não deixa mostrar este vídeo aqui.")).toBeVisible({ timeout: 10_000 });
    await expect(folha.getByRole("link", { name: "Abrir no Instagram" })).toBeVisible();
    // A folha continua com o próprio "Abrir na plataforma" no rodapé, sem relação com o reserva
    // de dentro do VideoEmbed (é outro botão, sempre presente).
    await expect(folha.getByRole("link", { name: "Abrir na plataforma" })).toBeVisible();
  });
});
