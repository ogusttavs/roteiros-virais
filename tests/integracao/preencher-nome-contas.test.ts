/**
 * `scripts/preencher-nome-contas.ts` contra o Postgres real, com a rede
 * mockada (etapa "acabamento visual 2"): contas do YouTube sem `nome`
 * recebem o `channelTitle` via `channels.list` em lote, e o gasto entra em
 * `consumo_api`. Mesmo padrao de mock de `tests/integracao/coleta-youtube.test.ts`.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { hojeISO } from "@/lib/config";

import { preencherNomeContas } from "../../scripts/preencher-nome-contas";
import { resetarSchema } from "../../scripts/resetar-schema";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "preencher-nome-teste", nome: "Preencher nome teste", termos: ["dentista"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(async () => {
  await db().delete(contas);
  await db().delete(consumoApi);
});

describe("preencherNomeContas", () => {
  it("preenche o nome das contas do youtube sem nome e registra o consumo", async () => {
    await db()
      .insert(contas)
      .values([
        { plataforma: "youtube", handle: "UCsemnome0000000001", nome: null, nichoId },
        { plataforma: "youtube", handle: "UCsemnome0000000002", nome: null, nichoId },
        { plataforma: "tiktok", handle: "ja-tem-nome", nome: "Ja tem nome", nichoId },
      ]);

    mockFetch.mockImplementation(async () =>
      respostaJson({
        items: [
          { id: "UCsemnome0000000001", snippet: { title: "[exemplo] Canal Um" } },
          { id: "UCsemnome0000000002", snippet: { title: "[exemplo] Canal Dois" } },
        ],
      }),
    );

    const resultado = await preencherNomeContas();

    expect(resultado).toEqual({
      contasSemNome: 2,
      contasAtualizadas: 2,
      canaisNaoEncontrados: 0,
      unidadesGastas: 1,
    });

    const linhas = await db().select().from(contas).where(eq(contas.plataforma, "youtube"));
    expect(linhas.map((l) => l.nome).sort()).toEqual(["[exemplo] Canal Dois", "[exemplo] Canal Um"]);

    const [consumo] = await db()
      .select()
      .from(consumoApi)
      .where(eq(consumoApi.data, hojeISO()));
    expect(consumo.unidades).toBe(1);
  });

  it("conta como nao encontrado quando o canal sumiu da API, sem quebrar o lote", async () => {
    await db().insert(contas).values({ plataforma: "youtube", handle: "UCsumiu000000000000", nome: null, nichoId });

    mockFetch.mockImplementation(async () => respostaJson({}));

    const resultado = await preencherNomeContas();

    expect(resultado.contasAtualizadas).toBe(0);
    expect(resultado.canaisNaoEncontrados).toBe(1);
  });
});
