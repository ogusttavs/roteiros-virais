/**
 * A1, "falar em todo campo" (pedido do Gustavo em 01/10, 21:50, `PROXIMO.md`): prova de dois dos
 * campos que ganharam o `CampoComFala` (o motivo de reprovar e o recado do vídeo), com a mesma
 * técnica de `briefing-audio.spec.ts` (dispositivo de áudio sintético do Chromium, rota
 * `/api/transcrever` interceptada). Aqui a transcrição entra exatamente como veio, sem organizar
 * (ao contrário do briefing): não há "Organizando", e o texto não muda uma vírgula.
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
  temasDia,
  user,
  type ConteudoRoteiro,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";

async function entrar(page: import("@playwright/test").Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("A1, falar em todo campo", () => {
  test.use({ permissions: ["microphone"] });

  test("reprovar por fala: o motivo entra no campo exatamente como foi dito, sem organizar", async ({ page }) => {
    const id = "e2e-reprovar-por-fala";
    await db().delete(user).where(eq(user.id, id));
    const [nicho] = await db().select().from(nichos).where(eq(nichos.slug, "dentistas"));
    await db().insert(user).values({ id, name: "[teste] Reprovar por fala", email: `${id}@exemplo.teste` });
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
      .values({ usuarioId: id, nome: "[teste] Marca Reprovar por fala", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
    await db().insert(briefings).values({
      clienteId: cliente.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "clareamento dental",
          preco: "sessao a partir de 350 reais",
          clienteIdeal: "quer sorriso mais branco para uma ocasiao",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "clinica odontologica",
        referencias: [],
      },
    });

    const conteudo: ConteudoRoteiro = {
      titulo: "teste de reprovar por fala",
      duracaoS: 30,
      gancho: "gancho de teste",
      corpo: "corpo de teste",
      fechamento: "fechamento de teste",
      chamadaFinal: "chamada final de teste",
      cartoes: null,
      porQueAssim: [],
      cenas: [],
      ondeGravar: "no consultorio",
      edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
      evidencias: [],
      semEvidencia: true,
      forcaEvidencia: null,
    };
    const [roteiro] = await db()
      .insert(roteiros)
      .values({ clienteId: cliente.id, data: hojeISO(), tema: conteudo.titulo, origem: "livre", objetivo: "conversao", conteudo })
      .returning();

    await page.route("**/api/transcrever", async (rota) => {
      await rota.fulfill({ json: { transcricao: "o gancho comecava com pergunta e isso ja tinha aparecido antes" } });
    });

    await entrar(page, `${id}@exemplo.teste`);
    await page.goto(`/roteiros/${roteiro.id}`);

    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Reprovar" }).click();

    const folhaReprovar = page.getByRole("dialog", { name: "O que não ficou bom?" });
    await expect(folhaReprovar).toBeVisible();
    await folhaReprovar.getByRole("button", { name: "Gancho fraco", exact: true }).click();

    const campo = folhaReprovar.getByLabel("Se quiser, diga com as suas palavras");
    await expect(campo).toHaveValue("");
    await folhaReprovar.getByRole("button", { name: "Falar", exact: true }).click();
    await expect(folhaReprovar.getByRole("button", { name: "Parar", exact: true })).toBeVisible();
    // Um instante gravando de verdade (o dispositivo sintetico do Chromium produz audio continuo).
    await page.waitForTimeout(500);
    await folhaReprovar.getByRole("button", { name: "Parar", exact: true }).click();

    // Nunca "Organizando": aqui a fala entra como foi dita, sem reescrita de IA (diferente do briefing).
    await expect(campo).toHaveValue("o gancho comecava com pergunta e isso ja tinha aparecido antes");
    await expect(folhaReprovar.getByText("Texto substituído pelo que você falou")).toBeVisible();
  });

  test("recado do vídeo por fala: 'o que este vídeo precisa comunicar' aceita ditar", async ({ page }) => {
    const id = "e2e-recado-video-por-fala";
    await db().delete(user).where(eq(user.id, id));
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "e2e-recado-video-por-fala", nome: "[teste] Recado por fala" })
      .returning();
    await db().insert(user).values({ id, name: "[teste] Recado por fala", email: `${id}@exemplo.teste` });
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
      .values({ usuarioId: id, nome: "[teste] Marca Recado por fala", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: cliente.id, papel: "dono" });
    await db().insert(preferenciasUsuario).values({ usuarioId: id, aceitouTermosEm: new Date() });
    await db().insert(briefings).values({
      clienteId: cliente.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "clareamento dental",
          preco: "sessao a partir de 350 reais",
          clienteIdeal: "quer sorriso mais branco para uma ocasiao",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "clinica odontologica",
        referencias: [],
      },
    });
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste recado por fala", descricao: "descricao", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });

    await page.route("**/api/transcrever", async (rota) => {
      await rota.fulfill({ json: { transcricao: "avisar que o horario de atendimento mudou essa semana" } });
    });

    await entrar(page, `${id}@exemplo.teste`);
    await page.goto("/criar/objetivo?tema=0");

    const campo = page.getByLabel(/O que este vídeo precisa comunicar/);
    await expect(campo).toHaveValue("");
    await page.getByRole("button", { name: "Falar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Parar", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Parar", exact: true }).click();

    await expect(campo).toHaveValue("avisar que o horario de atendimento mudou essa semana");
  });
});
