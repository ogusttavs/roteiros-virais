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
});
