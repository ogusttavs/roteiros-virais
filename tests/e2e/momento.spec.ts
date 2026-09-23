/**
 * "Gravar agora" (V9a, item 1, 3 e 5): o caminho por texto, de ponta a
 * ponta, entrando pelo Hoje e (num teste leve) pelo Tema livre. O caminho
 * por áudio não tem e2e (definição de pronto da V9a): `MediaRecorder`
 * pede microfone de verdade, o `PROXIMO.md` só pede o teste de integração
 * da rota, já em `tests/integracao/momento-transcrever-route.test.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { db } from "../../src/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  temasDia,
  user,
  type TemaDoDia,
} from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";

const SENHA = "ExemploSenha123";
const EMAIL = "e2e-momento@exemplo.teste";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

test.describe("gravar agora, o caminho por texto", () => {
  test.beforeAll(async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "e2e-momento", nome: "[teste] Momento" }).returning();

    await db().insert(user).values({ id: "e2e-momento", name: "[teste] Momento", email: EMAIL });
    await db()
      .insert(account)
      .values({
        id: "e2e-momento-credential",
        issuer: "local:credential",
        accountId: "e2e-momento",
        providerId: "credential",
        userId: "e2e-momento",
        password: await hashPassword(SENHA),
      });
    await db().insert(preferenciasUsuario).values({ usuarioId: "e2e-momento", aceitouTermosEm: new Date() });

    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId: "e2e-momento", nome: "[teste] Momento", nichoId: nicho.id })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: "e2e-momento", clienteId: marca.id, papel: "dono" });
    await db().insert(briefings).values({
      clienteId: marca.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "lavagem de estofados",
          preco: "sofa de 3 lugares por R$ 180",
          clienteIdeal: "mora em apartamento",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "lava estofados em domicilio",
        referencias: [],
      },
    });

    // O botao "Gravar agora" fica abaixo dos tres temas (item 3 do PROXIMO.md): sem uma
    // linha em temas_dia para hoje, /hoje cai no estado "sem_tema", que nao usa HojeTela.
    const temas: TemaDoDia[] = [
      { titulo: "tema de teste 1", descricao: "descricao 1", porQue: "esta subindo", evidencias: [], puxaPara: "conversao" },
      { titulo: "tema de teste 2", descricao: "descricao 2", porQue: "esta subindo", evidencias: [], puxaPara: "engajamento" },
      { titulo: "tema de teste 3", descricao: "descricao 3", porQue: "esta subindo", evidencias: [], puxaPara: "alcance" },
    ];
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  });

  test("pelo Hoje: preenche os tres campos, escolhe o objetivo, e o roteiro sai com origem momento", async ({ page }) => {
    await entrar(page);
    await page.goto("/hoje");

    await page.getByRole("button", { name: "Gravar agora" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await expect(folha).toBeVisible();

    await folha.getByLabel("Onde você está").fill("no aeroporto, cinco da manha");
    await folha
      .getByLabel("O que está acontecendo")
      .fill("esperando o embarque para a feira de fornecedores");
    await folha.getByLabel("O que dá para mostrar").fill("a fila do check-in e a mala de amostras");
    await folha.getByRole("radio", { name: "Gente me chamar para comprar" }).click();

    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();
    await expect(page).toHaveURL(/\/roteiros\/\d+/);

    // "De onde veio" mostra que este roteiro veio do momento, nao de um video do banco (item 1).
    await expect(page.getByText("Este roteiro veio do momento que você descreveu")).toBeVisible();
  });

  test("campo vazio: nao envia e mostra o aviso", async ({ page }) => {
    await entrar(page);
    await page.goto("/hoje");

    await page.getByRole("button", { name: "Gravar agora" }).click();
    const folha = page.getByRole("dialog", { name: "Gravar agora" });
    await folha.getByRole("button", { name: "Escrever o roteiro" }).click();

    await expect(folha.getByText("conte onde você está, o que está acontecendo e o que dá para mostrar")).toBeVisible();
    await expect(folha).toBeVisible();
  });

  test("pelo Tema livre: 'Estou num momento' abre a mesma folha", async ({ page }) => {
    await entrar(page);
    await page.goto("/hoje/tema-livre");

    await page.getByRole("button", { name: "Estou num momento" }).click();
    await expect(page.getByRole("dialog", { name: "Gravar agora" })).toBeVisible();
  });
});
