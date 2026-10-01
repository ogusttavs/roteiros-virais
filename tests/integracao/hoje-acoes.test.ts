/**
 * As Server Actions de `hoje/acoes.ts` (V12, item 3a): a sessao de verdade e
 * o isolamento por marca, mesmo padrao de `plano-acoes.test.ts`. O que
 * `salvarRedePrincipal` faz por dentro ja tem teste proprio em
 * `clientes-rede-principal.test.ts`; aqui e so a Server Action.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { clientes, membrosMarca, roteiros, user } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";
import { roteiroRecenteDesdeAction, salvarRedePrincipalAction } from "../../src/app/(painel)/(completo)/hoje/acoes";

const CONTEUDO_ROTEIRO_MINIMO = {
  titulo: "titulo",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

async function criarRoteiro(clienteId: number, tema: string, criadoEm: Date) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: "2026-01-01",
      tema,
      origem: "sugerido",
      objetivo: "alcance",
      conteudo: CONTEUDO_ROTEIRO_MINIMO,
      status: "gerado",
      criadoEm,
    })
    .returning();
  return roteiro;
}

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());
  await db()
    .insert(user)
    .values([
      { id: "hoje-acoes-a", name: "[teste] Hoje acoes A", email: "a@hoje-acoes.teste" },
      { id: "hoje-acoes-b", name: "[teste] Hoje acoes B", email: "b@hoje-acoes.teste" },
    ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "hoje-acoes-a", nome: "[teste] Marca A" }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "hoje-acoes-b", nome: "[teste] Marca B" }).returning();
  await db()
    .insert(membrosMarca)
    .values([
      { usuarioId: "hoje-acoes-a", clienteId: a.id, papel: "dono" },
      { usuarioId: "hoje-acoes-b", clienteId: b.id, papel: "dono" },
    ]);
  marcaA = { id: a.id, usuarioId: a.usuarioId! };
  marcaB = { id: b.id, usuarioId: b.usuarioId! };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("salvarRedePrincipalAction", () => {
  it("sem sessao, recusa", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(salvarRedePrincipalAction("instagram")).rejects.toThrow(ErroAcessoNegado);
  });

  it("grava na marca ativa da sessao, isolado da outra marca", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    await salvarRedePrincipalAction("tiktok");

    const [linhaA] = await db().select().from(clientes).where(eq(clientes.id, marcaA.id));
    expect(linhaA.redePrincipal).toBe("tiktok");

    const [linhaB] = await db().select().from(clientes).where(eq(clientes.id, marcaB.id));
    expect(linhaB.redePrincipal).toBeNull();
  });
});

/**
 * R1, item 0c: a base da recuperação da tela de espera quando a conexão parece ter caído, mas o
 * servidor pode ter terminado (geração não depende da aba continuar aberta).
 */
describe("roteiroRecenteDesdeAction", () => {
  // Cada teste insere o seu proprio roteiro com `criadoEm` controlado; sem isolar, o roteiro de
  // um teste anterior (ainda dentro da margem de relogio) poderia ser o "mais recente" errado.
  beforeEach(async () => {
    await db().delete(roteiros).where(eq(roteiros.clienteId, marcaA.id));
    await db().delete(roteiros).where(eq(roteiros.clienteId, marcaB.id));
  });

  it("sem sessao, recusa", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(roteiroRecenteDesdeAction(Date.now())).rejects.toThrow(ErroAcessoNegado);
  });

  it("sem roteiro novo desde o inicio da espera, devolve nulo", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const desdeMs = Date.now();
    const achado = await roteiroRecenteDesdeAction(desdeMs);
    expect(achado).toBeNull();
  });

  it("com um roteiro criado depois do inicio da espera, acha e devolve o id, isolado da outra marca", async () => {
    const desdeMs = Date.now();
    const roteiro = await criarRoteiro(marcaA.id, "tema criado durante a espera", new Date(desdeMs + 2000));

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const achadoDeA = await roteiroRecenteDesdeAction(desdeMs);
    expect(achadoDeA).toEqual({ id: roteiro.id });

    // Isolamento: a mesma busca na sessao de B nunca acha o roteiro de A.
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    const achadoDeB = await roteiroRecenteDesdeAction(desdeMs);
    expect(achadoDeB).toBeNull();
  });

  it("um roteiro criado pouco antes do inicio da espera ainda conta (margem do relogio)", async () => {
    const desdeMs = Date.now();
    const roteiro = await criarRoteiro(marcaA.id, "tema na margem do relogio", new Date(desdeMs - 5000));

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const achado = await roteiroRecenteDesdeAction(desdeMs);
    expect(achado).toEqual({ id: roteiro.id });
  });

  it("um roteiro de muito antes do inicio da espera (fora da margem) nao conta", async () => {
    const desdeMs = Date.now();
    await criarRoteiro(marcaA.id, "tema de muito antes", new Date(desdeMs - 60_000));

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const achado = await roteiroRecenteDesdeAction(desdeMs);
    expect(achado).toBeNull();
  });
});
