/**
 * E76 PR 1, contra o Postgres real, em mock: a sugestão de resposta do briefing que afirma um dado sem fonte chega à pessoa (e é
 * gravada) com o dado trocado por colchete; o mesmo dado, quando está numa resposta ou no que lemos do site, fica; e a sugestão
 * gravada antes da conferência passa por ela na tela, sem gravar nada. O mock inventa "5 empresas" e "6 meses" quando a resposta
 * traz `MARCADOR_SUGESTAO_INVENTADA`.
 */
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, contextoMarcaItens, geracoesIA, nichos, user } from "@/db/schema";
import { MARCADOR_SUGESTAO_INVENTADA } from "@/ia/mock";
import { avaliacoesParaMostrar, avaliarResposta, garantirBriefing } from "@/servicos/briefing";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

async function novaMarca(id: string): Promise<number> {
  await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@sugestao.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId }).returning();
  return cliente.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "sugestao-teste", nome: "Sugestão teste" }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("avaliarResposta: a sugestão não afirma dado sem fonte (E76 PR 1)", () => {
  it("o dado inventado vira colchete na avaliação devolvida e na gravada; a geração registrada guarda o que a IA escreveu", async () => {
    const clienteId = await novaMarca("sugestao-inventa");
    const resposta = `Atendo empresas pequenas que querem importar da China pela primeira vez. ${MARCADOR_SUGESTAO_INVENTADA}`;

    const resultado = await avaliarResposta(clienteId, "p1", resposta, "negocio");
    expect(resultado.avaliacao.exemplo).toBe("Com a gente, [quantas empresas?] importaram nos últimos [quantos meses?], e eu explico cada etapa do pedido.");

    const briefing = await garantirBriefing(clienteId);
    expect(briefing.avaliacoes.p1?.exemplo).toBe(resultado.avaliacao.exemplo);

    const [geracao] = await db()
      .select({ saida: geracoesIA.saida })
      .from(geracoesIA)
      .where(and(eq(geracoesIA.clienteId, clienteId), eq(geracoesIA.tarefa, "avaliarResposta")))
      .orderBy(desc(geracoesIA.id))
      .limit(1);
    expect(JSON.stringify(geracao.saida)).toContain("5 empresas");
  });

  it("o número que está na própria resposta fica", async () => {
    const clienteId = await novaMarca("sugestao-resposta");
    const resposta = `Nos últimos 6 meses, 5 empresas importaram com a gente pela primeira vez. ${MARCADOR_SUGESTAO_INVENTADA}`;

    const resultado = await avaliarResposta(clienteId, "p1", resposta, "negocio");
    expect(resultado.avaliacao.exemplo).toBe("Com a gente, 5 empresas importaram nos últimos 6 meses, e eu explico cada etapa do pedido.");
  });

  it("o número que está numa outra resposta do briefing fica", async () => {
    const clienteId = await novaMarca("sugestao-outra-resposta");
    await avaliarResposta(clienteId, "p2", "Em 6 meses de operação já atendemos 5 empresas, todas pequenas.", "negocio");

    const resultado = await avaliarResposta(clienteId, "p1", `Cuidamos da importação inteira. ${MARCADOR_SUGESTAO_INVENTADA}`, "negocio");
    expect(resultado.avaliacao.exemplo).toContain("5 empresas");
    expect(resultado.avaliacao.exemplo).toContain("6 meses");
  });

  it("o número que lemos do site, confirmado pela pessoa, fica; o item que ela tirou não serve de fonte", async () => {
    const clienteId = await novaMarca("sugestao-site");
    await db().insert(contextoMarcaItens).values([
      {
        clienteId,
        categoria: "vende",
        origem: "site",
        texto: "Importadora que atendeu 5 empresas.",
        textoConfirmado: "Importadora que atendeu 5 empresas.",
        estado: "confirmado",
      },
      { clienteId, categoria: "rendeu", origem: "site", texto: "Abriu há 6 meses.", estado: "recusado" },
    ]);

    const resultado = await avaliarResposta(clienteId, "p1", `Cuidamos da importação inteira. ${MARCADOR_SUGESTAO_INVENTADA}`, "negocio");
    expect(resultado.avaliacao.exemplo).toBe("Com a gente, 5 empresas importaram nos últimos [quantos meses?], e eu explico cada etapa do pedido.");
  });
});

describe("avaliacoesParaMostrar: a sugestão gravada antes da conferência (E76 PR 1)", () => {
  it("a tela recebe a sugestão conferida, e o banco continua como estava", async () => {
    const clienteId = await novaMarca("sugestao-antiga");
    const briefing = await garantirBriefing(clienteId);
    const avaliacaoAntiga = {
      nota: 7,
      bom: "Clara.",
      melhorar: "Falta prova.",
      como: "Traga um número real.",
      impacto: "O roteiro fica com a sua cara.",
      exemplo: "O nosso Instagram foi lançado há dois meses com 4 posts.",
    };
    await db()
      .update(briefings)
      .set({ respostas: { p1: "Cuidamos da importação inteira." }, avaliacoes: { p1: avaliacaoAntiga } })
      .where(eq(briefings.id, briefing.id));

    const linha = await garantirBriefing(clienteId);
    const paraTela = await avaliacoesParaMostrar(clienteId, linha, "negocio");
    expect(paraTela.p1?.exemplo).toBe("O nosso Instagram foi lançado há [quantos meses?] com [quantos posts?].");

    const depois = await garantirBriefing(clienteId);
    expect(depois.avaliacoes.p1?.exemplo).toBe(avaliacaoAntiga.exemplo);
  });

  it("sem sugestão nenhuma, devolve as avaliações como vieram", async () => {
    const clienteId = await novaMarca("sugestao-sem-exemplo");
    const linha = await garantirBriefing(clienteId);
    expect(await avaliacoesParaMostrar(clienteId, linha, "negocio")).toEqual(linha.avaliacoes);
  });
});
