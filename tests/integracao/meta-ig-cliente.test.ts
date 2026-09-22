/**
 * `resolverMetaIgId` (V8, item 1) contra o Postgres real e a rede mockada.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      coleta: { ...original.config.coleta, metaAtivo: true, metaIgId: "x", metaToken: "EAAtoken-de-teste" },
    },
  };
});

import { db, getPool } from "@/db";
import { clientes, user } from "@/db/schema";
import { resolverMetaIgId } from "@/servicos/meta-ig-cliente";

import { resetarSchema } from "../../scripts/resetar-schema";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function paginasComInstagram() {
  return respostaJson({
    data: [
      { id: "515845284934381", name: "Velura", instagram_business_account: { id: "17841463597140638", username: "veluracosmetics" } },
      { id: "999", name: "Overtake Pro", instagram_business_account: { id: "111", username: "overtakepro" } },
    ],
  });
}

let clienteId: number;

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values({ id: "meta-ig-teste", name: "[teste] meta ig", email: "meta-ig-teste@exemplo.teste" });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  mockFetch.mockReset();
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: "meta-ig-teste", nome: "[teste] meta ig", perfis: { instagram: "veluracosmetics", tiktok: null, youtube: null } })
    .returning();
  clienteId = cliente.id;
});

afterEach(async () => {
  await db().delete(clientes).where(eq(clientes.id, clienteId));
});

describe("resolverMetaIgId", () => {
  it("acha a pagina pelo username (normalizado) e grava meta_ig_id", async () => {
    mockFetch.mockImplementation(async () => paginasComInstagram());

    const id = await resolverMetaIgId(clienteId);

    expect(id).toBe("17841463597140638");
    const [depois] = await db().select({ metaIgId: clientes.metaIgId }).from(clientes).where(eq(clientes.id, clienteId));
    expect(depois.metaIgId).toBe("17841463597140638");
  });

  it("bate mesmo com @ e espacos no handle salvo, e com caixa diferente", async () => {
    await db().update(clientes).set({ perfis: { instagram: " @VeluraCosmetics ", tiktok: null, youtube: null } }).where(eq(clientes.id, clienteId));
    mockFetch.mockImplementation(async () => paginasComInstagram());

    expect(await resolverMetaIgId(clienteId)).toBe("17841463597140638");
  });

  it("ja resolvido: devolve o que esta salvo, sem chamar a rede", async () => {
    await db().update(clientes).set({ metaIgId: "ja-resolvido" }).where(eq(clientes.id, clienteId));

    expect(await resolverMetaIgId(clienteId)).toBe("ja-resolvido");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sem instagram no perfil: null, sem chamar a rede", async () => {
    await db().update(clientes).set({ perfis: { instagram: null, tiktok: null, youtube: null } }).where(eq(clientes.id, clienteId));

    expect(await resolverMetaIgId(clienteId)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sem correspondencia entre o handle e nenhuma Pagina: null, e nao grava nada", async () => {
    await db().update(clientes).set({ perfis: { instagram: "conta-que-nao-esta-no-portfolio", tiktok: null, youtube: null } }).where(eq(clientes.id, clienteId));
    mockFetch.mockImplementation(async () => paginasComInstagram());

    expect(await resolverMetaIgId(clienteId)).toBeNull();
    const [depois] = await db().select({ metaIgId: clientes.metaIgId }).from(clientes).where(eq(clientes.id, clienteId));
    expect(depois.metaIgId).toBeNull();
  });

  it("erro de rede na chamada: null, sem lancar", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await resolverMetaIgId(clienteId)).toBeNull();
  });

  /**
   * Achado da revisao da V8: erro de token ou de limite afeta TODAS as contas, nao so esta, entao
   * precisa RELANCAR (nao virar `null` como "sem correspondencia") para o job da curva saber que deve
   * parar de tentar a Meta pelo resto da rodada, em vez de repetir o mesmo erro a cada cliente sem
   * `meta_ig_id` ainda resolvido.
   */
  it("erro de token ou de limite: relanca, nao devolve null", async () => {
    mockFetch.mockResolvedValue(respostaJson({ error: { message: "Error validating access token", code: 190 } }));
    await expect(resolverMetaIgId(clienteId)).rejects.toMatchObject({ codigo: 190 });
  });

  it("cliente que nao existe: null", async () => {
    expect(await resolverMetaIgId(-1)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
