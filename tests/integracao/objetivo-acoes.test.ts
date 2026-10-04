/**
 * `gerarRoteiroAction` (etapa 11; V9c, item 1: `formato` do controle segmentado): a Server Action
 * de verdade que `/criar/objetivo` chama, contra o Postgres real e a sessão mockada (mesmo padrão de
 * `momento-acoes.test.ts` e `plano-acoes.test.ts`).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";

import { resetarSchema } from "../../scripts/resetar-schema";
import { gerarRoteiroAction } from "../../src/app/(painel)/(completo)/criar/objetivo/acoes";

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

/** E49 PR 1: as cinco fichas decidem o objetivo que se grava, valem só no Reels, e a reescrita mantém a ficha. */
describe("gerarRoteiroAction com ficha", () => {
  let contador = 0;
  // Cada geração numa marca nova: o mock do tipo de abertura não acompanha muitos roteiros seguidos da mesma marca.
  async function marcaNova(): Promise<string> {
    const id = `objetivo-ficha-${++contador}`;
    const [nicho] = await db().select().from(nichos).limit(1);
    await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@objetivo-acoes.teste` });
    const [m] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: m.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: m.id, completo: true, perfil: PERFIL });
    return id;
  }
  async function gerar(ficha: string | undefined, formato = "reels", objetivo: "alcance" | "engajamento" | "conversao" = "alcance") {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(await marcaNova()));
    const r = await gerarRoteiroAction({ origem: "livre", textoTema: `tema numero ${++contador} da ficha ${ficha ?? "sem"} ${formato}` }, objetivo, formato, undefined, undefined, undefined, undefined, undefined, undefined, ficha);
    if (!r.ok) throw new Error(r.erro);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, r.dado.id));
    return roteiro;
  }

  it("a ficha vira o objetivo que se grava (guardem conta em lembrarem de você, mesmo se a tela mandou outro)", async () => {
    const r = await gerar("guardem", "reels", "alcance");
    expect(r.ficha).toBe("guardem");
    expect(r.objetivo).toBe("engajamento");
    // O mock devolve passo a passo para esta ficha, e o verificador local aprova.
    expect(r.conteudo.corpo).toContain("Passo 1");
  });

  it("cada ficha conta no objetivo certo", async () => {
    expect((await gerar("veja")).objetivo).toBe("alcance");
    expect((await gerar("mandem")).objetivo).toBe("alcance");
    expect((await gerar("comentem")).objetivo).toBe("engajamento");
    expect((await gerar("me_chamem")).objetivo).toBe("conversao");
  });

  it("no Story a ficha é ignorada: o Story não pergunta", async () => {
    const r = await gerar("me_chamem", "story", "engajamento");
    expect(r.formato).toBe("story");
    expect(r.ficha).toBeNull();
    expect(r.objetivo).toBe("engajamento");
  });

  it("ficha que não é uma das cinco vale como ausente, sem derrubar o roteiro", async () => {
    const r = await gerar("salvamento", "reels", "conversao");
    expect(r.ficha).toBeNull();
    expect(r.objetivo).toBe("conversao");
  });

  it("reprovar e reescrever mantém a ficha da versão anterior", async () => {
    const { reprovarERescrever } = await import("@/servicos/roteiro");
    const original = await gerar("comentem");
    const nova = await reprovarERescrever(original.id, ["muito_longo"]);
    expect(nova.ficha).toBe("comentem");
    expect(nova.objetivo).toBe("engajamento");
  });
});
