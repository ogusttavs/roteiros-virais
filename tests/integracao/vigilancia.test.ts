/**
 * `vigilancia` (etapa 7, escopo 5.3): ranking por nicho e plataforma, minimo
 * de 8 videos nao-seed nos ultimos 90 dias, top `vigilanciaPorNicho` marcado
 * `vigiada = true`, e conta de seed nunca entra (mesmo em desenvolvimento).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";

import { resetarSchema } from "../../scripts/resetar-schema";
import { rodarPontuar } from "../../src/jobs/pontuar";
import { rodarVigilancia } from "../../src/jobs/vigilancia";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;

async function criarConta(handle: string, taxa: number | null): Promise<number> {
  const [c] = await db()
    .insert(contas)
    .values({ plataforma: "tiktok", handle, nichoId, taxaForaDaCurva: taxa === null ? undefined : String(taxa) })
    .returning({ id: contas.id });
  return c.id;
}

async function criarVideos(contaId: number, quantidade: number, origem: "coleta" | "seed" = "coleta") {
  for (let i = 0; i < quantidade; i += 1) {
    await db()
      .insert(videos)
      .values({
        plataforma: "tiktok",
        idExterno: `${contaId}-v${i}`,
        url: `https://exemplo.invalido/${contaId}-v${i}`,
        contaId,
        nichoId,
        publicadoEm: diasAtras(10),
        origem,
      });
  }
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "vigilancia-teste", nome: "Vigilancia teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("rodarVigilancia", () => {
  it("marca so o top N por nicho+plataforma entre quem tem 8+ videos, exclui seed e reseta quem caiu", async () => {
    // Sete contas com taxa decrescente, todas com 8 videos (qualificam pela contagem).
    const contasRanking: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const id = await criarConta(`rank-${i}`, 0.9 - i * 0.1);
      await criarVideos(id, 8);
      contasRanking.push(id);
    }

    // Conta com so 7 videos (abaixo do minimo de 8): nao entra, mesmo com taxa alta.
    const poucosVideos = await criarConta("poucos-videos", 0.99);
    await criarVideos(poucosVideos, 7);

    // Conta de seed: 8+ videos, todos origem=seed, taxa altissima. Nunca deve entrar.
    const contaSeed = await criarConta("conta-seed", 0.99);
    await criarVideos(contaSeed, 8, "seed");

    // Conta que estava vigiada de uma rodada anterior mas agora nao qualifica mais
    // (poucos videos): deve ser resetada para false.
    const caiuDoRanking = await criarConta("caiu-do-ranking", 0.5);
    await criarVideos(caiuDoRanking, 3);
    await db().update(contas).set({ vigiada: true }).where(eq(contas.id, caiuDoRanking));

    const resumo = await rodarVigilancia();
    expect(resumo.contasAvaliadas).toBeGreaterThan(0);

    async function vigiada(id: number): Promise<boolean> {
      const [c] = await db().select({ vigiada: contas.vigiada }).from(contas).where(eq(contas.id, id));
      return c.vigiada;
    }

    // Como o teste roda com o valor de producao de config.regras.vigilanciaPorNicho
    // (50), as 7 contas do ranking cabem todas dentro do limite -- o teste confere a
    // ORDEM/participacao, nao o corte em si (o corte em N e so um LIMIT/row_number,
    // ja coberto pela query em si; testar um corte exato exigiria criar mais de 50
    // contas, caro demais para um teste de integracao).
    for (const id of contasRanking) {
      expect(await vigiada(id)).toBe(true);
    }
    expect(await vigiada(poucosVideos)).toBe(false);
    expect(await vigiada(contaSeed)).toBe(false);
    expect(await vigiada(caiuDoRanking)).toBe(false);
  }, 30_000);

  /**
   * E6 parte 3, item 6: a regra de selecao nao muda (o teste acima ja cobre
   * a query em si, com taxa manual); o que faltava provar e que, quando
   * `pontuar` de verdade calcula a mediana e a taxa fora da curva de varias
   * contas (nao so uma, achado do Gustavo em 07/09: "hoje so uma conta e
   * vigiada em todo o banco"), a vigilancia seleciona todas que qualificam,
   * nao trava numa so.
   */
  it("com pontuar de verdade calculando a taxa, a vigilancia seleciona varias contas, nao so uma", async () => {
    const [nichoPontuar] = await db()
      .insert(nichos)
      .values({ slug: "vigilancia-pontuar-teste", nome: "Vigilancia com pontuar teste", termos: [] })
      .returning();

    const idsComBase: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const [conta] = await db()
        .insert(contas)
        .values({ plataforma: "tiktok", handle: `vigilancia-base-${i}`, nichoId: nichoPontuar.id })
        .returning({ id: contas.id });
      for (let v = 0; v < 8; v += 1) {
        await db()
          .insert(videos)
          .values({
            plataforma: "tiktok",
            idExterno: `vigilancia-base-${i}-v${v}`,
            url: `https://exemplo.invalido/vigilancia-base-${i}-v${v}`,
            contaId: conta.id,
            nichoId: nichoPontuar.id,
            views: 1000 + v * 500 + i * 3000,
            publicadoEm: diasAtras(10),
          });
      }
      idsComBase.push(conta.id);
    }

    await rodarPontuar();
    await rodarVigilancia();

    let vigiadas = 0;
    for (const id of idsComBase) {
      const [c] = await db()
        .select({ vigiada: contas.vigiada, taxaForaDaCurva: contas.taxaForaDaCurva })
        .from(contas)
        .where(eq(contas.id, id));
      // Cada conta tem mediana propria (8 videos >= MINIMO_VIDEOS_MEDIANA) e,
      // com isso, taxa_fora_da_curva deixa de ser nula.
      expect(c.taxaForaDaCurva).not.toBeNull();
      if (c.vigiada) vigiadas += 1;
    }
    // O achado de producao era "so uma conta vigiada em todo o banco"; aqui,
    // as quatro qualificam (8 videos cada, bem dentro do limite de 50 por nicho).
    expect(vigiadas).toBe(4);

    await db().delete(videos).where(eq(videos.nichoId, nichoPontuar.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoPontuar.id));
    await db().delete(nichos).where(eq(nichos.id, nichoPontuar.id));
  }, 30_000);
});
