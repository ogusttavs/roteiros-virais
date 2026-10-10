/**
 * O assunto do momento de cada ramo hoje (E55 PR 2, parte c), contra o Postgres real: `assuntosDoMomentoPorRamo` (a lista de Ramos do admin e a frase da rotina que monta os temas do dia) conta o tema do
 * momento que o ramo tem nos temas de hoje enquanto o assunto segue na lista de agora, e nada fora disso.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { nichos, temasDia, tendenciasBrasil, type TemaDoDia } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { listarNichosComContagem } from "@/servicos/admin-coleta";
import { assuntosDoMomentoPorRamo } from "@/servicos/em-alta";
import { somarDiasISO } from "@/servicos/roteiro";
import { chaveDoAssunto } from "@/servicos/tendencias";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA = 60 * 60 * 1000;

let comMomento: number;
let semMomento: number;
let ontem: number;

function temaComum(): TemaDoDia {
  return { titulo: "tema comum", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
}

function temaDoMomento(assunto: string): TemaDoDia {
  return {
    ...temaComum(),
    titulo: `tema de ${assunto}`,
    doMomento: { chave: chaveDoAssunto(assunto), assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 9 },
  };
}

async function rodadaDeAgora(assuntos: string[]): Promise<void> {
  await db()
    .insert(tendenciasBrasil)
    .values(
      assuntos.map((assunto, i) => ({
        coletadaEm: new Date(Date.now() - HORA),
        assunto,
        chave: chaveDoAssunto(assunto),
        termos: [assunto],
        fontes: [{ fonte: "google" as const, titulo: assunto, url: null, trafego: "2000+", posicao: i + 1 }],
        posicao: i + 1,
        sensivel: false,
      })),
    );
}

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "admin-momento-com", nome: "Com momento", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "admin-momento-sem", nome: "Sem momento", termos: [] }).returning();
  const [c] = await db().insert(nichos).values({ slug: "admin-momento-ontem", nome: "Com momento de ontem", termos: [] }).returning();
  comMomento = a.id;
  semMomento = b.id;
  ontem = c.id;
}, 30_000);

beforeEach(async () => {
  await db().delete(temasDia);
  await db().delete(tendenciasBrasil);
});

afterAll(async () => {
  await getPool().end();
});

describe("assuntosDoMomentoPorRamo", () => {
  it("o ramo com tema do momento nos temas de hoje, enquanto o assunto segue na lista de agora, e só ele", async () => {
    await rodadaDeAgora(["Frente fria"]);
    await db().insert(temasDia).values({ nichoId: comMomento, data: hojeISO(), temas: [temaComum(), temaDoMomento("Frente fria")] });
    await db().insert(temasDia).values({ nichoId: semMomento, data: hojeISO(), temas: [temaComum()] });

    const mapa = await assuntosDoMomentoPorRamo(hojeISO());
    expect([...mapa.entries()]).toEqual([[comMomento, ["Frente fria"]]]);
  });

  it("o assunto que saiu da lista, ou a lista de agora que não existe (passou de 18 horas), não contam", async () => {
    await db().insert(temasDia).values({ nichoId: comMomento, data: hojeISO(), temas: [temaComum(), temaDoMomento("Frente fria")] });
    expect((await assuntosDoMomentoPorRamo(hojeISO())).size).toBe(0);
    await rodadaDeAgora(["Jogo do Flamengo"]);
    expect((await assuntosDoMomentoPorRamo(hojeISO())).size).toBe(0);
  });

  it("o tema do momento de um dia que já passou nunca conta para hoje", async () => {
    await rodadaDeAgora(["Frente fria"]);
    const ontemISO = somarDiasISO(hojeISO(), -1);
    await db().insert(temasDia).values({ nichoId: ontem, data: ontemISO, temas: [temaComum(), temaDoMomento("Frente fria")] });
    expect((await assuntosDoMomentoPorRamo(hojeISO())).size).toBe(0);
  });

  it("a lista de Ramos do admin leva o assunto do momento de cada ramo (vazio nos outros)", async () => {
    await rodadaDeAgora(["Frente fria"]);
    await db().insert(temasDia).values({ nichoId: comMomento, data: hojeISO(), temas: [temaComum(), temaDoMomento("Frente fria")] });

    const lista = await listarNichosComContagem();
    expect(lista.find((n) => n.id === comMomento)?.assuntosDoMomento).toEqual(["Frente fria"]);
    expect(lista.find((n) => n.id === semMomento)?.assuntosDoMomento).toEqual([]);
  });
});
