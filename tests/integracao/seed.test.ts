/**
 * Migra do zero, roda o seed, confere contagens e a unicidade de
 * (plataforma, id_externo) (etapa 2, criterio de aceite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { videos } from "@/db/schema";

import { resetarSchema } from "../../scripts/resetar-schema";
import { semear } from "../../scripts/semear";

let resumo: Awaited<ReturnType<typeof semear>>;

beforeAll(async () => {
  await resetarSchema(db());
  resumo = await semear(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("seed", () => {
  it("cria as contagens esperadas", () => {
    expect(resumo).toEqual({ nichos: 2, contas: 8, clientes: 2, videos: 60 });
  });

  it("marca todo video de seed com origem seed e titulo comecando com [exemplo]", async () => {
    const todos = await db().select().from(videos);
    expect(todos.length).toBe(60);
    for (const v of todos) {
      expect(v.origem).toBe("seed");
      expect(v.titulo?.startsWith("[exemplo]")).toBe(true);
    }
  });

  it("reprova video duplicado na mesma plataforma e id_externo", async () => {
    const [existente] = await db().select().from(videos).limit(1);

    await expect(
      db().insert(videos).values({
        plataforma: existente.plataforma,
        idExterno: existente.idExterno,
        url: existente.url,
        nichoId: existente.nichoId,
        origem: "seed",
      }),
    ).rejects.toThrow();
  });
});
