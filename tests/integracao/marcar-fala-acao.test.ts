/**
 * `marcarFalaAction` (E41, parte 2a): a Server Action de verdade que a tela do roteiro e o modo gravação chamam, contra o Postgres real e a sessão mockada (mesmo padrão de
 * `objetivo-acoes.test.ts`): o dono marca, a marca de outra pessoa é "não achei", Story não tem fala, o "ver como" não escreve e a falha da IA chega como frase.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));
vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return { ...original, recusaDoVerComo: vi.fn(original.recusaDoVerComo) };
});

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, type ConteudoRoteiro, type PerfilCompilado } from "@/db/schema";
import * as cliente from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import { sessaoAtual } from "@/lib/sessao";
import { recusaDoVerComo } from "@/lib/ver-como";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { resetarSchema } from "../../scripts/resetar-schema";
import { marcarFalaAction } from "../../src/app/(painel)/(completo)/roteiros/[id]/acoes";

const PERFIL: PerfilCompilado = {
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
};

const CONTEUDO: ConteudoRoteiro = {
  titulo: "O sofá que volta ao normal",
  duracaoS: 30,
  gancho: "O sofá parecia perdido depois do vinho.",
  corpo: "Passe um pano úmido e depois o produto, sem esfregar.",
  fechamento: "Em cinco minutos a mancha sai.",
  chamadaFinal: "Chame no WhatsApp.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "na sua sala",
  edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

async function criarRoteiro(clienteId: number, formato: "reels" | "story" = "reels"): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId, data: "2026-10-10", tema: "mancha de vinho", origem: "livre", objetivo: "conversao", formato, conteudo: CONTEUDO })
    .returning({ id: roteiros.id });
  return linha.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "marcar-fala-acao", nome: "Marcar fala ação" }).returning();
  const marcas: { id: number; usuarioId: string }[] = [];
  for (const sufixo of ["a", "b"]) {
    await db().insert(user).values({ id: `mfa-${sufixo}`, name: `Marca ${sufixo}`, email: `${sufixo}@marcar-fala-acao.teste` });
    const [c] = await db().insert(clientes).values({ usuarioId: `mfa-${sufixo}`, nome: `[teste] Marca ${sufixo}`, nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: `mfa-${sufixo}`, clienteId: c.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: c.id, completo: true, perfil: PERFIL });
    marcas.push({ id: c.id, usuarioId: c.usuarioId! });
  }
  [marcaA, marcaB] = marcas;
}, 30_000);

beforeEach(async () => {
  await db().delete(roteiros);
  vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
  vi.mocked(cliente.gerarEstruturado).mockClear();
  vi.mocked(recusaDoVerComo).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("marcarFalaAction", () => {
  it("o dono marca a fala do roteiro dele", async () => {
    const id = await criarRoteiro(marcaA.id);
    const r = await marcarFalaAction(id);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dado.novas).toBe(true);
    expect(r.dado.motivo).toBeNull();
    expect(r.dado.marcas?.blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "fechamento", "chamadaFinal"]);
    const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
    expect(linha.marcas?.blocos).toHaveLength(4);
  });

  it("o roteiro de outra marca é 'não achei' e não gasta IA", async () => {
    const id = await criarRoteiro(marcaB.id);
    expect(await marcarFalaAction(id)).toEqual({ ok: false, erro: textosMarcasDeFala.erros.naoEncontrado });
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
    expect(linha.marcas).toBeNull();
  });

  it("um id que não existe, ou que não é um inteiro positivo, é 'não achei'", async () => {
    for (const id of [987654, 0, -3, 1.5, Number.NaN, 3_000_000_000]) {
      expect(await marcarFalaAction(id)).toEqual({ ok: false, erro: textosMarcasDeFala.erros.naoEncontrado });
    }
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("Story volta com o motivo, sem marcas e sem IA", async () => {
    const id = await criarRoteiro(marcaA.id, "story");
    expect(await marcarFalaAction(id)).toEqual({ ok: true, dado: { marcas: null, motivo: "story", novas: false } });
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("no 'ver como' a ação não escreve nada", async () => {
    const id = await criarRoteiro(marcaA.id);
    vi.mocked(recusaDoVerComo).mockResolvedValueOnce("Você está vendo a conta de outra pessoa: nada se grava.");
    expect(await marcarFalaAction(id)).toEqual({ ok: false, erro: "Você está vendo a conta de outra pessoa: nada se grava." });
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
    expect(linha.marcas).toBeNull();
  });

  it("a falha da IA chega como frase, e o roteiro continua sem marcas para a próxima tentativa", async () => {
    const id = await criarRoteiro(marcaA.id);
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async () => {
      throw new ErroIA("erro da API (402): saldo insuficiente.");
    });
    const r = await marcarFalaAction(id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBeTruthy();
    expect(r.erro).not.toContain("402");
    const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
    expect(linha.marcas).toBeNull();
  });
});
