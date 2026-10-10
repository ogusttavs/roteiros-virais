/**
 * As vozes do público no roteiro (E28, parte 2), contra o Postgres real e com o simulador de IA: o que o público do SETOR da marca
 * perguntou nos comentários de vídeos do YouTube esta semana chega à entrada do roteiro (e às fontes dos fatos, para o verificador),
 * numerado, com o número de comentários e a plataforma. Só o que passou do piso de comentários iguais; nada de outro setor; nada
 * quando a leitura é velha; e a reescrita mantém o bloco.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, roteiros, user, type VozesDoSetor } from "@/db/schema";
import * as verificador from "@/ia/verificador";
import { diaPorExtenso } from "@/servicos/noticias-assuntos";
import { gerarRoteiro, reprovarERescrever } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para o verificador de verdade, mas deixa ver o que cada tarefa recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

const DIA_MS = 24 * 60 * 60 * 1000;
const TEMA = "o que fazer quando a mancha volta no sofá";

let nichoId: number;
let outroNichoId: number;
let clienteId: number;

const voz = (texto: string, vezes: number) => ({ texto, vezes, videos: [1, 2], plataformas: ["youtube" as const] });
const vozes = (duvidas: ReturnType<typeof voz>[], pedidos: ReturnType<typeof voz>[] = []): VozesDoSetor => ({
  duvidas,
  objecoes: [],
  pedidos,
  videos: 12,
  comentarios: 840,
  plataformas: ["youtube"],
});

async function porVozes(setor: number, v: VozesDoSetor | null, vozesEm: Date | null = new Date()) {
  await db().update(nichos).set({ vozes: v, vozesEm: v ? vozesEm : null }).where(eq(nichos.id, setor));
}

/** A última chamada da tarefa: o que ela recebeu na entrada e nas fontes dos fatos. */
function ultimaChamada() {
  const chamadas = vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === "roteiro");
  expect(chamadas.length).toBeGreaterThan(0);
  const [params] = chamadas[chamadas.length - 1];
  return { entrada: String(params.entrada), fontes: String(params.fontesDosFatos ?? "") };
}

beforeAll(async () => {
  await resetarSchema(db());
  // O outro setor nasce primeiro (id menor): uma consulta que esquecesse o filtro por setor devolveria o dele, e o teste de vazamento pegaria.
  const [outro] = await db().insert(nichos).values({ slug: "vozes-outro-setor", nome: "Outro setor", termos: ["outro"] }).returning();
  const [nicho] = await db().insert(nichos).values({ slug: "vozes-no-roteiro", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  outroNichoId = outro.id;
  await db().insert(user).values({ id: "vozes-usuario", name: "Marca", email: "vozes@exemplo.teste" });
  const [marca] = await db().insert(clientes).values({ usuarioId: "vozes-usuario", nome: "Marca", nichoId }).returning();
  clienteId = marca.id;
  await db().insert(briefings).values({
    clienteId,
    completo: true,
    perfil: {
      fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [] },
      resumo: "produtos de limpeza",
      referencias: [],
    } as never,
  });
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await porVozes(nichoId, null);
  await porVozes(outroNichoId, null);
  vi.mocked(verificador.gerarComVerificacao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("as vozes do público no roteiro", () => {
  it("com a leitura da semana, a entrada traz o bloco numerado, com os comentários e a plataforma, e as fontes dos fatos também", async () => {
    const leitura = new Date(Date.now() - 3 * DIA_MS);
    await porVozes(nichoId, vozes([voz("Serve em tecido de camurça?", 14), voz("Quanto tempo tem que esperar?", 9)], [voz("Mostrar o passo a passo no colchão", 6)]), leitura);
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });

    const { entrada, fontes } = ultimaChamada();
    expect(entrada).toContain("<vozes_do_publico>");
    expect(entrada).toContain("pergunta 1 | 14 comentários | YouTube | Serve em tecido de camurça?");
    expect(entrada).toContain("pergunta 2 | 9 comentários | YouTube | Quanto tempo tem que esperar?");
    expect(entrada).toContain("pedido 3 | 6 comentários | YouTube | Mostrar o passo a passo no colchão");
    expect(entrada).toContain("nunca escreva \"o público pergunta X\" sem dizer onde");
    // datado: "lidos em <dia>" (o dia da leitura, não o de hoje), nunca como fato do setor
    expect(entrada).toContain(`Lido nos comentários de vídeos do YouTube do setor em ${diaPorExtenso(leitura)}`);
    expect(entrada).toContain("nunca um fato do setor");
    expect(fontes).toContain("Lido nos comentários de vídeos do YouTube do setor");
    expect(fontes).toContain("pergunta 1 | 14 comentários | YouTube | Serve em tecido de camurça?");
  });

  it("sem leitura nenhuma, a entrada é a de antes", async () => {
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    const { entrada, fontes } = ultimaChamada();
    expect(entrada).not.toContain("vozes_do_publico");
    expect(fontes).not.toContain("comentários de vídeos do YouTube");
  });

  it("a pergunta que não passou do piso de cinco comentários não entra", async () => {
    await porVozes(nichoId, vozes([voz("Pergunta de quatro comentários?", 4)]));
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(ultimaChamada().entrada).not.toContain("vozes_do_publico");
  });

  it("a leitura de mais de duas semanas atrás não vale", async () => {
    await porVozes(nichoId, vozes([voz("Serve em tecido de camurça?", 14)]), new Date(Date.now() - 20 * DIA_MS));
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(ultimaChamada().entrada).not.toContain("vozes_do_publico");
  });

  it("as vozes de outro setor nunca chegam: só as do setor da marca", async () => {
    await porVozes(outroNichoId, vozes([voz("Pergunta do outro setor?", 20)]));
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(ultimaChamada().entrada).not.toContain("Pergunta do outro setor");
    expect(ultimaChamada().entrada).not.toContain("vozes_do_publico");
  });

  it("o roteiro do momento nunca recebe o bloco: a cena é a única fonte", async () => {
    await porVozes(nichoId, vozes([voz("Serve em tecido de camurça?", 14)]));
    await gerarRoteiro(clienteId, {
      origem: "momento",
      momento: { onde: "no balcão da loja", oQueEstaAcontecendo: "uma cliente está escolhendo o produto", oQueDaParaMostrar: "o kit na prateleira" },
      objetivo: "alcance",
    });
    const { entrada, fontes } = ultimaChamada();
    expect(entrada).not.toContain("vozes_do_publico");
    expect(fontes).not.toContain("Serve em tecido de camurça?");
  });

  it("uma leitura malformada no banco não impede o roteiro: segue sem as vozes", async () => {
    await db().update(nichos).set({ vozes: { videos: 1 } as never, vozesEm: new Date() }).where(eq(nichos.id, nichoId));
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(roteiro.id).toBeGreaterThan(0);
    expect(ultimaChamada().entrada).not.toContain("vozes_do_publico");
  });

  it("a reescrita (reprovar e escrever de novo) mantém o bloco", async () => {
    await porVozes(nichoId, vozes([voz("Serve em tecido de camurça?", 14)]));
    const primeiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await reprovarERescrever(primeiro.id, ["gancho_fraco"]);
    expect(ultimaChamada().entrada).toContain("pergunta 1 | 14 comentários | YouTube | Serve em tecido de camurça?");
  });
});
