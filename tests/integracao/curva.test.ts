/**
 * `fontesDoHistorico` (V8, item 3: "de onde veio a medida" no admin) contra
 * o Postgres real. As demais funções de `curva.ts` que tocam o banco
 * (`curvasDoHistorico`, `medianaDaConta`, `curvaDoVideo`) não têm teste de
 * integração ainda (achado de fora desta etapa); a ordenação por
 * `postadoEm desc` que este arquivo prova para `fontesDoHistorico` também
 * foi aplicada a `curvasDoHistorico` (mesma ressalva, comentário em
 * `curva.ts`), mas sem teste dedicado por não ser o pedido desta etapa.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, metricasVideoCliente, nichos, roteiros, user, videosCliente } from "@/db/schema";
import { fontesDoHistorico } from "@/servicos/curva";

import { resetarSchema } from "../../scripts/resetar-schema";

const CONTEUDO_ROTEIRO_MINIMO = {
  titulo: "titulo",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

let nichoId: number;
let clienteId: number;

let contadorRoteiro = 0;

/** A data em si nao importa para estes testes (so o `roteiroId`); um contador evita pensar em datas de verdade. */
async function criarRoteiro(): Promise<number> {
  contadorRoteiro += 1;
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: "2026-09-01",
      tema: `tema de teste ${contadorRoteiro}`,
      origem: "sugerido",
      objetivo: "alcance",
      conteudo: CONTEUDO_ROTEIRO_MINIMO,
      status: "postado",
    })
    .returning();
  return roteiro.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "curva-teste", nome: "[teste] curva" }).returning();
  nichoId = nicho.id;
  await db().insert(user).values({ id: "curva-teste", name: "[teste] curva", email: "curva-teste@curva.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "curva-teste", nome: "[teste] curva", nichoId }).returning();
  clienteId = cliente.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("fontesDoHistorico", () => {
  it("lista vazia de roteiroIds: mapa vazio, sem consultar o banco", async () => {
    expect(await fontesDoHistorico(clienteId, [])).toEqual(new Map());
  });

  it("roteiro sem videos_cliente (nao postado, ou so aparenta): sem entrada no mapa", async () => {
    const roteiroId = await criarRoteiro();
    expect((await fontesDoHistorico(clienteId, [roteiroId])).has(roteiroId)).toBe(false);
  });

  it("video postado sem nenhuma medida ainda: sem entrada no mapa", async () => {
    const roteiroId = await criarRoteiro();
    await db().insert(videosCliente).values({ clienteId, roteiroId, url: "https://exemplo.invalido/x", postadoEm: new Date() });
    expect((await fontesDoHistorico(clienteId, [roteiroId])).has(roteiroId)).toBe(false);
  });

  it("uma medida com fonte 'meta': aparece certo no mapa", async () => {
    const roteiroId = await criarRoteiro();
    const [video] = await db()
      .insert(videosCliente)
      .values({ clienteId, roteiroId, url: "https://exemplo.invalido/x", postadoEm: new Date() })
      .returning();
    await db().insert(metricasVideoCliente).values({ videoClienteId: video.id, views: 1000, likes: 10, comentarios: 1, fonte: "meta" });

    expect((await fontesDoHistorico(clienteId, [roteiroId])).get(roteiroId)).toBe("meta");
  });

  it("medida antiga, de antes desta etapa (fonte nula no banco): entra no mapa como null, nao como ausente", async () => {
    const roteiroId = await criarRoteiro();
    const [video] = await db()
      .insert(videosCliente)
      .values({ clienteId, roteiroId, url: "https://exemplo.invalido/x", postadoEm: new Date() })
      .returning();
    await db().insert(metricasVideoCliente).values({ videoClienteId: video.id, views: 500, likes: 5, comentarios: 0 });

    const fontes = await fontesDoHistorico(clienteId, [roteiroId]);
    expect(fontes.has(roteiroId)).toBe(true);
    expect(fontes.get(roteiroId)).toBeNull();
  });

  it("duas medidas do mesmo video: usa a mais recente, nao a primeira gravada", async () => {
    const roteiroId = await criarRoteiro();
    const [video] = await db()
      .insert(videosCliente)
      .values({ clienteId, roteiroId, url: "https://exemplo.invalido/x", postadoEm: new Date() })
      .returning();
    await db()
      .insert(metricasVideoCliente)
      .values([
        { videoClienteId: video.id, coletadoEm: new Date("2026-09-06T10:00:00Z"), views: 100, likes: 1, comentarios: 0, fonte: "apify" },
        { videoClienteId: video.id, coletadoEm: new Date("2026-09-06T12:00:00Z"), views: 200, likes: 2, comentarios: 0, fonte: "meta" },
      ]);

    expect((await fontesDoHistorico(clienteId, [roteiroId])).get(roteiroId)).toBe("meta");
  });

  /**
   * Duas linhas de `videos_cliente` para o MESMO roteiro (hoje possivel quando a conexao cai no
   * meio de "Postei", decisao pendente do PR #53): a mais recente (`postadoEm`) vence, nunca uma
   * ordem arbitraria do Postgres (achado da revisao da V8).
   */
  it("dois videos_cliente para o mesmo roteiro: usa o mais recente pelo postadoEm", async () => {
    const roteiroId = await criarRoteiro();
    const [videoAntigo] = await db()
      .insert(videosCliente)
      .values({ clienteId, roteiroId, url: "https://exemplo.invalido/antigo", postadoEm: new Date("2026-09-06T10:00:00Z") })
      .returning();
    const [videoNovo] = await db()
      .insert(videosCliente)
      .values({ clienteId, roteiroId, url: "https://exemplo.invalido/novo", postadoEm: new Date("2026-09-06T11:00:00Z") })
      .returning();
    await db().insert(metricasVideoCliente).values([
      { videoClienteId: videoAntigo.id, views: 10, likes: 1, comentarios: 0, fonte: "apify" },
      { videoClienteId: videoNovo.id, views: 20, likes: 2, comentarios: 0, fonte: "meta" },
    ]);

    expect((await fontesDoHistorico(clienteId, [roteiroId])).get(roteiroId)).toBe("meta");
  });

  it("nunca mistura o video de outro cliente (isolamento por cliente_id)", async () => {
    await db().insert(user).values({ id: "curva-teste-outro", name: "[teste] outro", email: "curva-teste-outro@curva.teste" });
    const [outroCliente] = await db()
      .insert(clientes)
      .values({ usuarioId: "curva-teste-outro", nome: "[teste] outro", nichoId })
      .returning();
    const roteiroId = await criarRoteiro();
    const [video] = await db()
      .insert(videosCliente)
      .values({ clienteId: outroCliente.id, roteiroId, url: "https://exemplo.invalido/x", postadoEm: new Date() })
      .returning();
    await db().insert(metricasVideoCliente).values({ videoClienteId: video.id, views: 1, likes: 0, comentarios: 0, fonte: "meta" });

    expect((await fontesDoHistorico(clienteId, [roteiroId])).has(roteiroId)).toBe(false);
  });
});
