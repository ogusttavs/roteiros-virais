/**
 * `gerarRoteiroMomentoAction` (V9a, item 1 e item 4): a Server Action de
 * verdade que a folha "Gravar agora" chama, contra o Postgres real e a
 * sessão mockada (mesmo padrão de `isolamento-rotas-briefing.test.ts`, o
 * contraponto no nível de rota de `tests/integracao/roteiro.test.ts`, que
 * já cobre `gerarRoteiro` no nível de serviço).
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
import { gerarRoteiroMomentoAction } from "../../src/app/(painel)/(completo)/hoje/momento/acoes";

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

const MOMENTO = {
  onde: "no aeroporto",
  oQueEstaAcontecendo: "esperando o embarque para a feira de fornecedores",
  oQueDaParaMostrar: "a fila do check-in e a mala de amostras",
};

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db().insert(nichos).values({ slug: "momento-acoes-teste", nome: "Momento acoes teste" }).returning();

  await db()
    .insert(user)
    .values([
      { id: "momento-a", name: "[teste] Momento A", email: "a@momento-acoes.teste" },
      { id: "momento-b", name: "[teste] Momento B", email: "b@momento-acoes.teste" },
    ]);

  const [a] = await db().insert(clientes).values({ usuarioId: "momento-a", nome: "[teste] Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "momento-b", nome: "[teste] Marca B", nichoId: nicho.id }).returning();

  await db()
    .insert(membrosMarca)
    .values([
      { usuarioId: "momento-a", clienteId: a.id, papel: "dono" },
      { usuarioId: "momento-b", clienteId: b.id, papel: "dono" },
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

describe("gerarRoteiroMomentoAction", () => {
  it("com a sessao de A, gera o roteiro na marca de A, com origem momento", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    const { id } = await gerarRoteiroMomentoAction({ ...MOMENTO, objetivo: "engajamento" });

    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(roteiro.clienteId).toBe(marcaA.id);
    expect(roteiro.origem).toBe("momento");
    expect(roteiro.momento).toEqual(MOMENTO);
  });

  /** Isolamento (item 4): marcaId de que a pessoa nao e membro nunca gasta uma geracao. */
  it("com marcaId de uma marca de que a pessoa nao e membro, recusa antes de gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));

    await expect(
      gerarRoteiroMomentoAction({ ...MOMENTO, objetivo: "engajamento", marcaId: marcaB.id }),
    ).rejects.toThrow(ErroAcessoNegado);

    const depois = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));
    expect(depois.length).toBe(antes.length);
  });

  it("com marcaId da propria marca ativa (sempre membro dela), gera normalmente", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));

    const { id } = await gerarRoteiroMomentoAction({ ...MOMENTO, objetivo: "alcance", marcaId: marcaB.id });

    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(roteiro.momento?.marcaId).toBe(marcaB.id);
  });

  it("sem sessao, recusa em vez de gerar em algum cliente", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(gerarRoteiroMomentoAction({ ...MOMENTO, objetivo: "engajamento" })).rejects.toThrow(ErroAcessoNegado);
  });

  it("com um dos tres campos vazio, erro nomeado, sem gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    await expect(
      gerarRoteiroMomentoAction({ ...MOMENTO, oQueDaParaMostrar: "   ", objetivo: "engajamento" }),
    ).rejects.toThrow(ErroRoteiro);
  });

  // V9d, item 2: `formato` chega como texto livre do navegador; um valor fora de "reels"/"story"
  // precisa ser recusado antes de gerar, nunca chegar ao banco.
  it("com formato invalido, erro nomeado, sem gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));

    await expect(
      gerarRoteiroMomentoAction({ ...MOMENTO, objetivo: "engajamento", formato: "carrossel" }),
    ).rejects.toThrow(ErroRoteiro);

    const depois = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));
    expect(depois.length).toBe(antes.length);
  });
});
