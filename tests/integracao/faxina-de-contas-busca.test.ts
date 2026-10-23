/**
 * A faxina das contas fora do setor com a busca por significado do Tema livre (E17): a conta marcada não chega ao modelo barato como candidata, não volta como prova, e a busca por
 * palavra (a reserva) também a ignora. Contra o Postgres real, com a IA simulada.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { db, getPool } from "@/db";
import { clientes, contas, contasForaDoSetor, nichos, user, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { config } from "@/lib/config";
import { evidenciaParaTema } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);
const ANALISE = { assunto: "marketing digital para pequenos negocios", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" };

let ramo: number;
let clienteId: number;
let idsMarcada: number[];
let idsBoa: number[];

async function conta(handle: string, titulo: string): Promise<number[]> {
  const [c] = await db().insert(contas).values({ plataforma: "youtube", handle, nichoId: ramo }).returning({ id: contas.id });
  const linhas = await db()
    .insert(videos)
    .values(
      Array.from({ length: 3 }, (_, i) => ({
        plataforma: "youtube" as const,
        idExterno: `${handle}-${i}`,
        url: `https://exemplo.invalido/${handle}-${i}`,
        titulo: `${titulo} ${i}`,
        contaId: c.id,
        nichoId: ramo,
        views: 200_000,
        foraDaCurva: "9",
        publicadoEm: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        idioma: "pt",
        analise: ANALISE as never,
      })),
    )
    .returning({ id: videos.id });
  if (handle === "marcada") await db().insert(contasForaDoSetor).values({ contaId: c.id, nichoId: ramo, origem: "manual", motivo: "teste" });
  return linhas.map((l) => l.id);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [n] = await db().insert(nichos).values({ slug: "faxina-busca", nome: "Marketing", termos: [] }).returning();
  ramo = n.id;
  idsMarcada = await conta("marcada", "marketing digital da conta marcada");
  idsBoa = await conta("boa", "marketing digital da conta boa");
  await db().insert(user).values({ id: "faxina-busca-u", name: "[teste] Marca", email: "marca@faxina-busca.teste" });
  const [m] = await db().insert(clientes).values({ usuarioId: "faxina-busca-u", nome: "[teste] Marca", nichoId: ramo }).returning();
  clienteId = m.id;
}, 60_000);

afterEach(() => {
  config.busca.porSignificado = false;
  gerarEstruturadoMock.mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("a busca por significado ignora a conta fora do setor", () => {
  it("ligada: o modelo barato só recebe candidatos da conta do setor, e a prova não traz a marcada", async () => {
    config.busca.porSignificado = true;
    const prova = await evidenciaParaTema(ramo, "marketing digital", 8, undefined, [], undefined, { clienteId });
    const chamadas = gerarEstruturadoMock.mock.calls.map(([p]) => p).filter((p) => p.tarefa === "reordenarEvidencia");
    expect(chamadas.length).toBeGreaterThan(0);
    const candidatos = chamadas.flatMap((c) => c.entrada.split("\n").filter((l) => /^id \d+:/.test(l)).map((l) => Number(/^id (\d+):/.exec(l)![1])));
    expect(candidatos.sort()).toEqual([...idsBoa].sort());
    expect(prova.map((v) => v.id).every((id) => !idsMarcada.includes(id))).toBe(true);
  });

  it("desligada ou sem a marca de quem pede: a busca por palavra também ignora", async () => {
    const prova = await evidenciaParaTema(ramo, "marketing digital", 8);
    expect(prova.map((v) => v.id).sort()).toEqual([...idsBoa].sort());
    await db().delete(contasForaDoSetor).where(eq(contasForaDoSetor.nichoId, ramo));
    const sem = await evidenciaParaTema(ramo, "marketing digital", 8);
    expect(sem).toHaveLength(6);
  });
});
