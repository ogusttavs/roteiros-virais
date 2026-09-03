/**
 * `nichoPorSlug` e `listarContasVigiadas` (etapa 7): a base de
 * `/admin/nichos/[slug]`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos } from "@/db/schema";
import { listarContasVigiadas, nichoPorSlug } from "@/servicos/admin-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "admin-pontuacao-teste", nome: "Admin pontuacao teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("nichoPorSlug", () => {
  it("acha o nicho pelo slug e devolve nulo quando nao existe", async () => {
    const achado = await nichoPorSlug("admin-pontuacao-teste");
    expect(achado?.id).toBe(nichoId);
    expect(await nichoPorSlug("slug-que-nao-existe")).toBeNull();
  });
});

describe("listarContasVigiadas", () => {
  it("so traz conta vigiada do nicho pedido, ordenada por taxa desc", async () => {
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "vig-alta", nichoId, vigiada: true, taxaForaDaCurva: "0.8" });
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "vig-baixa", nichoId, vigiada: true, taxaForaDaCurva: "0.2" });
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "nao-vigiada", nichoId, vigiada: false, taxaForaDaCurva: "0.99" });

    const outroNicho = await db()
      .insert(nichos)
      .values({ slug: "admin-pontuacao-teste-2", nome: "Outro", termos: [] })
      .returning();
    await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "outro-nicho", nichoId: outroNicho[0].id, vigiada: true, taxaForaDaCurva: "1" });

    const resultado = await listarContasVigiadas(nichoId);
    expect(resultado.map((c) => c.handle)).toEqual(["vig-alta", "vig-baixa"]);
    expect(resultado[0].taxaForaDaCurva).toBeCloseTo(0.8, 3);
  });
});
