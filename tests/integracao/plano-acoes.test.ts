/**
 * As Server Actions de `hoje/plano/acoes.ts` (V9b): a sessão de verdade e o
 * isolamento da marca citada ("Falar de", item 4 da V9a, reaproveitado
 * aqui). `tests/integracao/plano.test.ts` já cobre `servicos/plano.ts` a
 * fundo; este arquivo cobre só o que só existe na Server Action.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado } from "@/servicos/clientes";
import { ErroRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";
import { aceitarPlanoAction, criarPlanoAction, lerAgendaAction, pularPlanoAction } from "../../src/app/(painel)/(completo)/hoje/plano/acoes";

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
let marcaB: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "plano-acoes-teste", nome: "Plano acoes teste" }).returning();

  await db()
    .insert(user)
    .values([
      { id: "plano-a", name: "[teste] Plano A", email: "a@plano-acoes.teste" },
      { id: "plano-b", name: "[teste] Plano B", email: "b@plano-acoes.teste" },
    ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "plano-a", nome: "[teste] Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "plano-b", nome: "[teste] Marca B", nichoId: nicho.id }).returning();
  await db()
    .insert(membrosMarca)
    .values([
      { usuarioId: "plano-a", clienteId: a.id, papel: "dono" },
      { usuarioId: "plano-b", clienteId: b.id, papel: "dono" },
    ]);
  await db().insert(briefings).values([
    { clienteId: a.id, completo: true, perfil: PERFIL },
    { clienteId: b.id, completo: true, perfil: PERFIL },
  ]);

  marcaA = { id: a.id, usuarioId: a.usuarioId };
  marcaB = { id: b.id, usuarioId: b.usuarioId };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("lerAgendaAction e criarPlanoAction", () => {
  it("sem sessao, recusam", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(lerAgendaAction("segunda: feira")).rejects.toThrow(ErroAcessoNegado);
    await expect(criarPlanoAction([{ data: "2026-09-23", lugar: "x", compromissos: ["y"] }])).rejects.toThrow(
      ErroAcessoNegado,
    );
  });

  it("com sessao, criarPlanoAction cria na marca ativa da sessao", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const itens = await criarPlanoAction([{ data: "2026-09-23", lugar: "feira", compromissos: ["fornecedor novo"] }]);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((item) => item.estado === "sugerido")).toBe(true);
  });
});

describe("aceitarPlanoAction e pularPlanoAction", () => {
  it("com marcaId de uma marca de que a pessoa nao e membro, recusa antes de gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const [item] = await criarPlanoAction([{ data: "2026-09-24", lugar: "feira", compromissos: ["fornecedor novo"] }]);

    await expect(
      aceitarPlanoAction(item.id, {
        onde: "na feira",
        oQueEstaAcontecendo: "fornecedor novo",
        oQueDaParaMostrar: "as amostras",
        objetivo: "engajamento",
        marcaId: marcaB.id,
      }),
    ).rejects.toThrow(ErroAcessoNegado);

    const [linha] = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));
    expect(linha).toBeUndefined();
  });

  it("com os tres campos preenchidos, aceita e devolve o id do roteiro", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const [item] = await criarPlanoAction([{ data: "2026-09-25", lugar: "fabrica", compromissos: ["visita ao fornecedor"] }]);

    const { id } = await aceitarPlanoAction(item.id, {
      onde: "na fabrica",
      oQueEstaAcontecendo: "visita ao fornecedor",
      oQueDaParaMostrar: "a linha de producao",
      objetivo: "engajamento",
    });

    expect(typeof id).toBe("number");
  });

  it("campo vazio: erro nomeado, sem gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const [item] = await criarPlanoAction([{ data: "2026-09-26", lugar: "hotel", compromissos: ["revendo amostras"] }]);

    await expect(
      aceitarPlanoAction(item.id, {
        onde: "  ",
        oQueEstaAcontecendo: "revendo amostras",
        oQueDaParaMostrar: "as amostras na cama",
        objetivo: "engajamento",
      }),
    ).rejects.toThrow(ErroRoteiro);
  });

  it("pularPlanoAction e isolado pela sessao", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const [item] = await criarPlanoAction([{ data: "2026-09-27", lugar: "reuniao", compromissos: ["negociar preco"] }]);

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    const { ErroPlano } = await import("@/servicos/plano");
    await expect(pularPlanoAction(item.id)).rejects.toThrow(ErroPlano);

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    await expect(pularPlanoAction(item.id)).resolves.toBeUndefined();
  });
});
