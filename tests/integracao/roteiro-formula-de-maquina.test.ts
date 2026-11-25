/**
 * Onda 1 de texto (25/11/2026), contra o Postgres real e a IA simulada: a fórmula de texto de máquina (`R-COPY-26`) e o teste "serve para qualquer ramo?"
 * (`R-COPY-27`, no verificador de texto) devolvem o roteiro para o modelo refazer uma vez, com o motivo; na segunda tentativa a fórmula vira só aviso e
 * o cliente nunca fica sem roteiro por causa de um enfeite.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, roteiros, user } from "@/db/schema";
import * as verificador from "@/ia/verificador";
import { gerarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

let clienteId: number;
const TEMA = "como tirar mancha de vinho do sofá";

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "formula-maquina", nome: "Limpeza de estofados", termos: ["limpeza"] }).returning();
  await db().insert(user).values({ id: "fdm-a", name: "Marca A", email: "fdm-a@exemplo.teste" });
  const [a] = await db().insert(clientes).values({ usuarioId: "fdm-a", nome: "Marca A", nichoId: nicho.id }).returning();
  clienteId = a.id;
  await db().insert(briefings).values({
    clienteId: a.id,
    completo: true,
    perfil: {
      fatos: { oQueVende: "lavagem de sofá a seco", preco: "a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [] },
      resumo: "lavagem de sofá",
      referencias: [],
    } as never,
  });
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  vi.mocked(verificador.gerarComVerificacao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

async function geracoes(tarefa: string) {
  return db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, tarefa));
}

describe("a fórmula de máquina no roteiro", () => {
  it("sem fórmula: uma geração só", async () => {
    const r = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(r.conteudo.gancho).not.toContain("método");
    expect(await geracoes("roteiro")).toHaveLength(1);
  });

  it("1ª tentativa com a fórmula: volta para o modelo com o motivo, e a 2ª sai limpa", async () => {
    const r = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:formula]`, objetivo: "alcance" });
    expect(await geracoes("roteiro")).toHaveLength(2);
    expect(r.conteudo.gancho).not.toContain("Não é sorte");
    const entradas = vi.mocked(verificador.gerarComVerificacao).mock.calls.map(([p]) => String(p.entrada));
    expect(entradas).toHaveLength(1); // uma chamada a gerarComVerificacao; a segunda tentativa é interna a ela
    const [roteiro1, roteiro2] = (await geracoes("roteiro")).map((g) => JSON.stringify(g.entradas));
    expect(roteiro1).not.toContain("R-COPY-26: o gancho");
    expect(roteiro2).toContain("R-COPY-26: o gancho");
  });

  it("fórmula nas duas tentativas: só aviso, o roteiro sai mesmo assim (nunca derruba a geração)", async () => {
    const r = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:formula-sempre]`, objetivo: "alcance" });
    expect(await geracoes("roteiro")).toHaveLength(2);
    expect(r.conteudo.gancho).toContain("Não é sorte, é método");
  });
});

describe("o teste 'serve para qualquer ramo?' no verificador de texto", () => {
  it("o gancho que serve para qualquer ramo volta uma vez, e a 2ª tentativa passa", async () => {
    const r = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:qualquer-ramo]`, objetivo: "alcance" });
    expect(await geracoes("roteiro")).toHaveLength(2);
    expect(r.conteudo.gancho).not.toContain("{mock:qualquer-ramo}");
    const [primeira] = await geracoes("roteiro");
    expect(primeira.motivoAvaliacao ?? "").toContain("serve para qualquer ramo");
  });
});
