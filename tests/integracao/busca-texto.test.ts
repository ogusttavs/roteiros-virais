/**
 * `videos.busca` (etapa 8, criterio de aceite): a coluna gerada ja incluia
 * `transcricao` e `analise ->> 'assunto'` desde a etapa 2 (conferido no
 * schema, PROXIMO.md desta etapa pedia so para confirmar), mas nunca
 * tinha teste proprio buscando por esses dois campos especificamente.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { nichos, videos } from "@/db/schema";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "busca-teste", nome: "Busca teste", termos: [] })
    .returning();
  nichoId = nicho.id;

  await db()
    .insert(videos)
    .values([
      {
        plataforma: "youtube",
        idExterno: "busca-por-transcricao",
        url: "https://exemplo.invalido/busca-por-transcricao",
        nichoId,
        titulo: "video sem relacao no titulo",
        transcricao: "aqui eu falo sobre clareamento dental de um jeito simples",
      },
      {
        plataforma: "youtube",
        idExterno: "busca-por-assunto",
        url: "https://exemplo.invalido/busca-por-assunto",
        nichoId,
        titulo: "outro video qualquer",
        analise: {
          assunto: "clareamento",
          gancho: "x",
          estrutura: "x",
          fechamento: "x",
          chamadaFinal: "x",
          formato: "outro",
          porQueFuncionou: "x",
        },
      },
      {
        plataforma: "youtube",
        idExterno: "sem-relacao",
        url: "https://exemplo.invalido/sem-relacao",
        nichoId,
        titulo: "video de organizacao da casa",
      },
    ]);
});

afterAll(async () => {
  await getPool().end();
});

describe("videos.busca", () => {
  it("acha video pela transcricao e pelo assunto da analise, sem achar o que nao tem relacao", async () => {
    const linhas = await db().execute<{ id_externo: string }>(
      sql`SELECT id_externo FROM videos WHERE nicho_id = ${nichoId} AND busca @@ plainto_tsquery('portuguese', 'clareamento') ORDER BY id_externo`,
    );

    const idsExternos = linhas.rows.map((l) => l.id_externo).sort();
    expect(idsExternos).toEqual(["busca-por-assunto", "busca-por-transcricao"]);
  });
});
