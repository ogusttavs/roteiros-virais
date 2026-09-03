/**
 * Isolamento no nivel de rota (plano de execucao, etapa 5, revisao da parte
 * 1, item 8 do PROXIMO.md): as Server Actions de /comecar e /briefing nunca
 * recebem um clienteId de fora, so derivam o cliente da sessao
 * (clienteDaSessaoAtual). Este teste mocka a sessao para duas contas
 * diferentes e confere que uma nunca le nem grava o briefing da outra, e que
 * sem sessao a acao recusa.
 *
 * tests/integracao/isolamento.test.ts ja cobre isso no nivel de servico
 * (garantirClientePermitido); este cobre a Server Action, que e a rota de
 * verdade que a tela chama.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { clientes, nichos, user } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { garantirBriefing } from "@/servicos/briefing";

import { resetarSchema } from "../../scripts/resetar-schema";
import { avaliarRespostaAction as avaliarBriefingAction } from "../../src/app/(painel)/(completo)/briefing/acoes";
import {
  avaliarRespostaAction as avaliarComecarAction,
  salvarRascunhoAction as salvarRascunhoComecarAction,
} from "../../src/app/comecar/acoes";

let clienteA: { id: number; usuarioId: string };
let clienteB: { id: number; usuarioId: string };

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "isolamento-rotas-teste", nome: "Isolamento rotas teste" })
    .returning();

  await db()
    .insert(user)
    .values([
      { id: "rota-a", name: "[teste] Rota A", email: "a@isolamento-rotas.teste" },
      { id: "rota-b", name: "[teste] Rota B", email: "b@isolamento-rotas.teste" },
    ]);

  const [a] = await db()
    .insert(clientes)
    .values({ usuarioId: "rota-a", nome: "[teste] Rota A", nichoId: nicho.id })
    .returning();
  const [b] = await db()
    .insert(clientes)
    .values({ usuarioId: "rota-b", nome: "[teste] Rota B", nichoId: nicho.id })
    .returning();

  clienteA = { id: a.id, usuarioId: a.usuarioId };
  clienteB = { id: b.id, usuarioId: b.usuarioId };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("isolamento das Server Actions de /comecar", () => {
  it("a sessao de A so afeta o briefing de A, nunca o de B", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(clienteA.usuarioId));

    await avaliarComecarAction("p1", "resposta da sessao A para p1");

    const briefingA = await garantirBriefing(clienteA.id);
    const briefingB = await garantirBriefing(clienteB.id);
    expect(briefingA.respostas.p1).toBe("resposta da sessao A para p1");
    expect(briefingB.respostas.p1).toBeUndefined();
  });

  it("a sessao de B so afeta o briefing de B, nunca o de A", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(clienteB.usuarioId));

    await salvarRascunhoComecarAction("p2", "rascunho da sessao B para p2");

    const briefingA = await garantirBriefing(clienteA.id);
    const briefingB = await garantirBriefing(clienteB.id);
    expect(briefingB.respostas.p2).toBe("rascunho da sessao B para p2");
    expect(briefingA.respostas.p2).toBeUndefined();
  });

  it("sem sessao, a acao recusa em vez de gravar em algum cliente", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(avaliarComecarAction("p3", "sem sessao")).rejects.toThrow();
  });
});

describe("isolamento das Server Actions de /briefing", () => {
  it("editar uma resposta so muda o briefing da sessao atual", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(clienteA.usuarioId));
    await avaliarBriefingAction("p4", "edicao da sessao A para p4");

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(clienteB.usuarioId));
    await avaliarBriefingAction("p4", "edicao da sessao B para p4");

    const briefingA = await garantirBriefing(clienteA.id);
    const briefingB = await garantirBriefing(clienteB.id);
    expect(briefingA.respostas.p4).toBe("edicao da sessao A para p4");
    expect(briefingB.respostas.p4).toBe("edicao da sessao B para p4");
  });
});
