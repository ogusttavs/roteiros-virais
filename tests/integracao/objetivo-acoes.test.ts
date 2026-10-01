/**
 * `gerarRoteiroAction` (etapa 11; V9c, item 1: `formato` do controle segmentado): a Server Action
 * de verdade que `/hoje/objetivo` chama, contra o Postgres real e a sessão mockada (mesmo padrão de
 * `momento-acoes.test.ts` e `plano-acoes.test.ts`).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";

import { resetarSchema } from "../../scripts/resetar-schema";
import { gerarRoteiroAction } from "../../src/app/(painel)/(completo)/hoje/objetivo/acoes";

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

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

let marcaA: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "objetivo-acoes-teste", nome: "Objetivo acoes teste" })
    .returning();

  await db().insert(user).values({ id: "objetivo-a", name: "[teste] Objetivo A", email: "a@objetivo-acoes.teste" });
  const [a] = await db()
    .insert(clientes)
    .values({ usuarioId: "objetivo-a", nome: "[teste] Marca A", nichoId: nicho.id })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: "objetivo-a", clienteId: a.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: a.id, completo: true, perfil: PERFIL });

  marcaA = { id: a.id, usuarioId: a.usuarioId! };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("gerarRoteiroAction", () => {
  it("com formato valido, gera o roteiro nesse formato", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    const resultado = await gerarRoteiroAction(
      { origem: "livre", textoTema: "mancha de vinho no sofa" },
      "conversao",
      "story",
    );

    if (!resultado.ok) throw new Error(resultado.erro);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, resultado.dado.id));
    expect(roteiro.formato).toBe("story");
  });

  it("sem formato, gera reels (o padrao)", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    const resultado = await gerarRoteiroAction({ origem: "livre", textoTema: "cheiro de bicho no sofa" }, "alcance");

    if (!resultado.ok) throw new Error(resultado.erro);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, resultado.dado.id));
    expect(roteiro.formato).toBe("reels");
  });

  /**
   * V9d, item 2: `formato` chega como texto livre do navegador; um valor fora de "reels"/"story"
   * precisa ser recusado antes de gerar, nunca chegar ao banco. R1, item 0c: o erro chega como
   * resultado (`ok: false`), nao lancado, para a tela mostrar o texto exato em producao.
   */
  it("com formato invalido, erro como resultado, sem gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));

    const resultado = await gerarRoteiroAction(
      { origem: "livre", textoTema: "produto novo" },
      "engajamento",
      "carrossel",
    );

    expect(resultado).toEqual({ ok: false, erro: "formato de roteiro invalido." });
    const depois = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));
    expect(depois.length).toBe(antes.length);
  });
});
