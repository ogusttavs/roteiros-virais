/**
 * `src/servicos/noticias.ts` (E43) contra o Postgres real, em mock: o filtro por período,
 * "virou roteiro" isolado por marca, `contagemNoticiasNaSemana` e `noticiaPorId` escopado pelo
 * nicho da marca.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, noticias, roteiros, user } from "@/db/schema";
import { contagemNoticiasNaSemana, noticiaPorId, noticiasDoSetor } from "@/servicos/noticias";

import { resetarSchema } from "../../scripts/resetar-schema";

function porTitulo(titulo: string) {
  return eq(noticias.titulo, titulo);
}

let nichoId: number;
let outroNichoId: number;
let clienteId: number;
let outraMarcaMesmoSetorId: number;

const AGORA = new Date("2026-10-02T12:00:00Z");

function horasAtras(h: number): Date {
  return new Date(AGORA.getTime() - h * 60 * 60 * 1000);
}

function diasAtras(d: number): Date {
  return new Date(AGORA.getTime() - d * 24 * 60 * 60 * 1000);
}

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db().insert(nichos).values({ slug: "noticias-teste", nome: "[teste] Noticias" }).returning();
  nichoId = nicho.id;
  const [outroNicho] = await db().insert(nichos).values({ slug: "noticias-teste-outro", nome: "[teste] Noticias Outro" }).returning();
  outroNichoId = outroNicho.id;

  await db().insert(user).values({ id: "noticias-teste", name: "[teste] Noticias", email: "a@noticias.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "noticias-teste", nome: "[teste] Marca", nichoId }).returning();
  clienteId = cliente.id;

  await db().insert(user).values({ id: "noticias-teste-2", name: "[teste] Noticias Dois", email: "b@noticias.teste" });
  const [outraMarca] = await db()
    .insert(clientes)
    .values({ usuarioId: "noticias-teste-2", nome: "[teste] Outra Marca", nichoId })
    .returning();
  outraMarcaMesmoSetorId = outraMarca.id;

  await db()
    .insert(noticias)
    .values([
      {
        nichoId,
        titulo: "[teste] noticia de hoje",
        url: "https://exemplo.invalido/noticias-teste-hoje",
        fonte: "[teste] Fonte",
        publicadoEm: horasAtras(2),
        resumo: "resumo de hoje",
        relevante: true,
        angulo: "angulo de hoje",
      },
      {
        nichoId,
        titulo: "[teste] noticia da semana, nao hoje",
        url: "https://exemplo.invalido/noticias-teste-semana",
        fonte: "[teste] Fonte",
        publicadoEm: diasAtras(3),
        resumo: null,
        relevante: true,
        angulo: null,
      },
      {
        nichoId,
        titulo: "[teste] noticia do mes, fora da semana",
        url: "https://exemplo.invalido/noticias-teste-mes",
        fonte: "[teste] Fonte",
        publicadoEm: diasAtras(20),
        resumo: "resumo do mes",
        relevante: true,
        angulo: null,
      },
      {
        nichoId,
        titulo: "[teste] noticia nao relevante, nunca aparece",
        url: "https://exemplo.invalido/noticias-teste-nao-relevante",
        fonte: "[teste] Fonte",
        publicadoEm: horasAtras(1),
        resumo: null,
        relevante: false,
        angulo: null,
      },
      {
        nichoId,
        titulo: "[teste] noticia ainda nao filtrada, nunca aparece",
        url: "https://exemplo.invalido/noticias-teste-nulo",
        fonte: "[teste] Fonte",
        publicadoEm: horasAtras(1),
        resumo: null,
        relevante: null,
        angulo: null,
      },
      {
        nichoId: outroNichoId,
        titulo: "[teste] noticia de outro setor, nunca aparece",
        url: "https://exemplo.invalido/noticias-teste-outro-setor",
        fonte: "[teste] Fonte",
        publicadoEm: horasAtras(1),
        resumo: null,
        relevante: true,
        angulo: null,
      },
    ])
    .returning();
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

function conteudoExemplo() {
  return {
    titulo: "titulo",
    gancho: "gancho de teste",
    corpo: "corpo de teste",
    fechamento: "fechamento",
    chamadaFinal: "chamada",
    duracaoS: 30,
    ondeGravar: "onde",
    comoEditar: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: "", referencia: "" },
  } as never;
}

describe("noticiasDoSetor: filtro por periodo", () => {
  it("'hoje' traz so a noticia publicada nas ultimas 24h", async () => {
    const lista = await noticiasDoSetor(nichoId, clienteId, "hoje", AGORA);
    expect(lista.map((n) => n.titulo)).toEqual(["[teste] noticia de hoje"]);
  });

  it("'semana' traz hoje e a da semana, mais recente primeiro, nunca a do mes nem a irrelevante", async () => {
    const lista = await noticiasDoSetor(nichoId, clienteId, "semana", AGORA);
    expect(lista.map((n) => n.titulo)).toEqual(["[teste] noticia de hoje", "[teste] noticia da semana, nao hoje"]);
  });

  it("'mes' traz as tres, nunca a de outro setor", async () => {
    const lista = await noticiasDoSetor(nichoId, clienteId, "mes", AGORA);
    expect(lista.map((n) => n.titulo)).toEqual([
      "[teste] noticia de hoje",
      "[teste] noticia da semana, nao hoje",
      "[teste] noticia do mes, fora da semana",
    ]);
  });

  it("traz url, fonte, resumo e angulo tal como gravados, com nulo quando nao ha", async () => {
    const lista = await noticiasDoSetor(nichoId, clienteId, "hoje", AGORA);
    expect(lista[0]).toMatchObject({
      url: "https://exemplo.invalido/noticias-teste-hoje",
      fonte: "[teste] Fonte",
      resumo: "resumo de hoje",
      angulo: "angulo de hoje",
      virouRoteiro: false,
      roteiroId: null,
    });
  });
});

describe("noticiasDoSetor: 'virou roteiro' isolado por marca", () => {
  it("sem roteiro nenhum, todas vem com virouRoteiro falso", async () => {
    const lista = await noticiasDoSetor(nichoId, clienteId, "mes", AGORA);
    expect(lista.every((n) => n.virouRoteiro === false && n.roteiroId === null)).toBe(true);
  });

  it("um roteiro da marca a partir de uma noticia marca virouRoteiro so para essa marca", async () => {
    const [noticiaDeHoje] = await db().select().from(noticias).where(porTitulo("[teste] noticia de hoje"));

    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: AGORA.toISOString().slice(0, 10),
        tema: "tema a partir da noticia",
        origem: "livre",
        objetivo: "engajamento",
        noticiaId: noticiaDeHoje.id,
        conteudo: conteudoExemplo(),
      })
      .returning();

    const listaDaMarca = await noticiasDoSetor(nichoId, clienteId, "hoje", AGORA);
    expect(listaDaMarca[0]).toMatchObject({ virouRoteiro: true, roteiroId: roteiro.id });

    // mesmo setor, outra marca: a mesma noticia nao aparece como "virou roteiro" para ela.
    const listaDaOutraMarca = await noticiasDoSetor(nichoId, outraMarcaMesmoSetorId, "hoje", AGORA);
    expect(listaDaOutraMarca[0]).toMatchObject({ virouRoteiro: false, roteiroId: null });
  });

  it("duas versoes da mesma noticia: 'virou roteiro' aponta para o roteiro mais recente", async () => {
    const [noticiaDoMes] = await db().select().from(noticias).where(porTitulo("[teste] noticia do mes, fora da semana"));

    await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: diasAtras(1).toISOString().slice(0, 10),
        tema: "primeira tentativa",
        origem: "livre",
        objetivo: "engajamento",
        noticiaId: noticiaDoMes.id,
        conteudo: conteudoExemplo(),
      });
    const [maisRecente] = await db()
      .insert(roteiros)
      .values({
        clienteId,
        data: AGORA.toISOString().slice(0, 10),
        tema: "segunda tentativa, mais recente",
        origem: "livre",
        objetivo: "engajamento",
        noticiaId: noticiaDoMes.id,
        conteudo: conteudoExemplo(),
      })
      .returning();

    const lista = await noticiasDoSetor(nichoId, clienteId, "mes", AGORA);
    const linha = lista.find((n) => n.titulo === "[teste] noticia do mes, fora da semana");
    expect(linha).toMatchObject({ virouRoteiro: true, roteiroId: maisRecente.id });
  });
});

describe("contagemNoticiasNaSemana", () => {
  it("conta as relevantes da semana deste setor, nunca a irrelevante nem a de outro setor", async () => {
    expect(await contagemNoticiasNaSemana(nichoId, AGORA)).toBe(2);
    expect(await contagemNoticiasNaSemana(outroNichoId, AGORA)).toBe(1);
  });
});

describe("noticiaPorId", () => {
  it("acha a noticia pelo id quando o nicho bate", async () => {
    const [esperada] = await db().select().from(noticias).where(porTitulo("[teste] noticia de hoje"));
    const achada = await noticiaPorId(esperada.id, nichoId);
    expect(achada?.titulo).toBe("[teste] noticia de hoje");
  });

  it("nao acha quando o nicho nao bate (escopo por setor da marca)", async () => {
    const [esperada] = await db().select().from(noticias).where(porTitulo("[teste] noticia de hoje"));
    const achada = await noticiaPorId(esperada.id, outroNichoId);
    expect(achada).toBeNull();
  });

  it("nao acha um id que nao existe", async () => {
    const achada = await noticiaPorId(999999, nichoId);
    expect(achada).toBeNull();
  });
});
