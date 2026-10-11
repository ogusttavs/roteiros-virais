/**
 * As pesquisas na hora do admin (E54, parte 4), contra o Postgres real: uma linha por pesquisa com marca, tamanho, buscas, custo e desfecho; o resumo da janela inteira (com o estimado
 * ao lado do medido, por tamanho); o corte da lista sem cortar o resumo; a janela de 30 dias; a pesquisa presa que o admin também fecha; e o roteiro que nasceu da pesquisa.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, geracoesIA, pesquisasNaHora, roteiros, user, type AchadoDaPesquisa } from "@/db/schema";
import { desfechoDaPesquisa, pesquisasNaHoraDoAdmin } from "@/servicos/admin-custos";
import { dadosDoCampoDePesquisa, estimarPesquisa } from "@/servicos/pesquisa-na-hora";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 24 * 60 * 60 * 1000;
let marcaA: number;
let marcaB: number;

function achado(id: number): AchadoDaPesquisa {
  return {
    id,
    texto: `Dado ${id}.`,
    fonteNome: "IBGE",
    fonteTipo: "oficial",
    url: `https://www.ibge.gov.br/${id}`,
    titulo: null,
    dataDaPagina: "2026-08-31",
    dataTexto: null,
    antigo: false,
    citacao: `Trecho ${id}.`,
  };
}

async function pesquisa(valores: Partial<typeof pesquisasNaHora.$inferInsert> & { marca?: number }) {
  const { marca, ...resto } = valores;
  const [linha] = await db()
    .insert(pesquisasNaHora)
    .values({ clienteId: marca ?? marcaA, pedido: "quanto subiu o preço dos produtos de limpeza", status: "pronta", achados: [achado(1), achado(2), achado(3)], selecionados: [1, 2], buscas: 4, custoUsd: "0.080000", terminadoEm: new Date(), ...resto })
    .returning();
  return linha;
}

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values([
    { id: "pda-a", name: "Marca A", email: "pda-a@exemplo.teste" },
    { id: "pda-b", name: "Marca B", email: "pda-b@exemplo.teste" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "pda-a", nome: "[teste] Marca A" }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "pda-b", nome: "[teste] Marca B" }).returning();
  marcaA = a.id;
  marcaB = b.id;
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  await db().delete(pesquisasNaHora);
});

afterAll(async () => {
  await getPool().end();
});

describe("pesquisasNaHoraDoAdmin", () => {
  it("sem pesquisa nenhuma: lista vazia, resumo zerado e o teto da marca", async () => {
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.linhas).toEqual([]);
    expect(r.cortadas).toBe(false);
    expect(r.resumo).toMatchObject({ total: 0, prontas: 0, semAchados: 0, erros: 0, rodando: 0, buscas: 0, custoUsd: 0, custoMedioUsd: null, marcas: 0, comRoteiro: 0, tetoPorMarcaPorDia: 3, pesoAFundo: 2 });
  });

  it("uma linha por pesquisa, a mais recente primeiro, com marca, tamanho, buscas, custo, dados e tempo", async () => {
    const agora = Date.now();
    const antiga = await pesquisa({ criadoEm: new Date(agora - 3 * 3_600_000), terminadoEm: new Date(agora - 3 * 3_600_000 + 40_000), profundidade: "aprofundada", buscas: 9, custoUsd: "0.200000", marca: marcaB });
    const nova = await pesquisa({ criadoEm: new Date(agora - 1 * 3_600_000), terminadoEm: new Date(agora - 1 * 3_600_000 + 25_000) });
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.linhas.map((l) => l.id)).toEqual([nova.id, antiga.id]);
    expect(r.linhas[0]).toMatchObject({ clienteId: marcaA, marca: "[teste] Marca A", profundidade: "normal", status: "pronta", buscas: 4, dados: 3, marcados: 2, duracaoS: 25, roteiros: 0, confirmada: false, premissa: "sem_premissa" });
    expect(r.linhas[0].custoUsd).toBeCloseTo(0.08, 6);
    expect(r.linhas[1]).toMatchObject({ clienteId: marcaB, profundidade: "aprofundada", buscas: 9, duracaoS: 40 });
  });

  it("o erro não mostra tempo (a presa é fechada na hora em que alguém abre a página, então o tempo seria o da espera), e a sem dado confiável mostra", async () => {
    const agora = Date.now();
    await pesquisa({ status: "erro", achados: [], selecionados: [], buscas: 0, custoUsd: "0", motivo: "A pesquisa não terminou.", criadoEm: new Date(agora - 120_000), terminadoEm: new Date(agora - 30_000) });
    await pesquisa({ status: "sem_achados", achados: [], selecionados: [], buscas: 3, custoUsd: "0.050000", criadoEm: new Date(agora - 60_000), terminadoEm: new Date(agora - 20_000) });
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.linhas.find((l) => l.status === "erro")).toMatchObject({ duracaoS: null, motivo: "A pesquisa não terminou." });
    expect(r.linhas.find((l) => l.status === "sem_achados")).toMatchObject({ duracaoS: 40 });
  });

  it("duas marcas contam duas", async () => {
    await pesquisa({ marca: marcaA });
    await pesquisa({ marca: marcaB });
    await pesquisa({ marca: marcaB });
    expect((await pesquisasNaHoraDoAdmin()).resumo.marcas).toBe(2);
  });

  it("o resumo soma a janela e a média é só das que gastaram (o erro que caiu sem busca não entra)", async () => {
    await pesquisa({ buscas: 4, custoUsd: "0.080000" });
    await pesquisa({ buscas: 2, custoUsd: "0.040000", status: "sem_achados", achados: [], selecionados: [] });
    await pesquisa({ buscas: 0, custoUsd: "0", status: "erro", achados: [], selecionados: [], motivo: "A pesquisa não terminou." });
    await pesquisa({ buscas: 0, custoUsd: "0", status: "pesquisando", achados: [], selecionados: [], terminadoEm: null });
    await pesquisa({ buscas: 0, custoUsd: "0", status: "executando", achados: [], selecionados: [], terminadoEm: null });
    const { resumo } = await pesquisasNaHoraDoAdmin();
    expect(resumo).toMatchObject({ total: 5, prontas: 1, semAchados: 1, erros: 1, rodando: 2, buscas: 6, marcas: 1 });
    expect(resumo.custoUsd).toBeCloseTo(0.12, 6);
    expect(resumo.custoMedioUsd).toBeCloseTo(0.06, 6);
  });

  it("a que não fez busca mas pagou a leitura (só o custo) entra na média, e a que não gastou nada não", async () => {
    await pesquisa({ buscas: 4, custoUsd: "0.080000" });
    await pesquisa({ buscas: 0, custoUsd: "0.020000", status: "erro", achados: [], selecionados: [] });
    await pesquisa({ buscas: 0, custoUsd: "0", status: "erro", achados: [], selecionados: [] });
    // fez busca e o custo não foi medido (zero): também conta como que gastou
    await pesquisa({ buscas: 3, custoUsd: "0" });
    const { resumo } = await pesquisasNaHoraDoAdmin();
    expect(resumo.custoMedioUsd).toBeCloseTo(0.1 / 3, 6);
  });

  it("o estimado que a tela diz fica ao lado do medido, por tamanho, e a rápida e a a fundo não se misturam", async () => {
    // as medidas ficam longe da estimativa de propósito: o medido não pode ser confundido com o que a tela diz
    await pesquisa({ profundidade: "normal", buscas: 1, custoUsd: "0.020000" });
    await pesquisa({ profundidade: "normal", buscas: 3, custoUsd: "0.040000" });
    await pesquisa({ profundidade: "aprofundada", buscas: 2, custoUsd: "0.030000" });
    const { resumo } = await pesquisasNaHoraDoAdmin();
    const rapida = resumo.porTamanho.find((t) => t.profundidade === "normal")!;
    const aFundo = resumo.porTamanho.find((t) => t.profundidade === "aprofundada")!;
    expect(rapida).toMatchObject({ pesquisas: 2, buscasMedias: 2, estimadoBuscas: estimarPesquisa("normal").buscas });
    expect(rapida.estimadoBuscas).not.toBe(2);
    expect(rapida.custoMedioUsd).toBeCloseTo(0.03, 6);
    expect(rapida.estimadoUsd).toBeCloseTo(estimarPesquisa("normal").usd, 6);
    expect(aFundo).toMatchObject({ pesquisas: 1, buscasMedias: 2, estimadoBuscas: estimarPesquisa("aprofundada").buscas });
    expect(aFundo.estimadoBuscas).not.toBe(2);
    expect(aFundo.custoMedioUsd).toBeCloseTo(0.03, 6);
    expect(aFundo.estimadoUsd).toBeGreaterThan(rapida.estimadoUsd);
  });

  it("o estimado dito é o mesmo que o campo diz para a pessoa (arredondado como ela), e a estimativa exata fica ao lado", async () => {
    const campo = await dadosDoCampoDePesquisa(marcaA);
    const { resumo } = await pesquisasNaHoraDoAdmin();
    expect(resumo.porTamanho.find((x) => x.profundidade === "normal")!.estimadoDito).toBe(campo.rapida);
    expect(resumo.porTamanho.find((x) => x.profundidade === "aprofundada")!.estimadoDito).toBe(campo.aFundo);
    expect(campo.rapida).toMatch(/^uns R\$ \d,\d0$|^uns R\$ \d,\d5$/);
  });

  it("o tamanho sem pesquisa medida diz que não há média, e não zero", async () => {
    await pesquisa({ profundidade: "normal" });
    const { resumo } = await pesquisasNaHoraDoAdmin();
    const aFundo = resumo.porTamanho.find((t) => t.profundidade === "aprofundada")!;
    expect(aFundo).toMatchObject({ pesquisas: 0, custoMedioUsd: null, buscasMedias: null });
  });

  it("a janela é de 30 dias: a de 40 dias fica de fora, e a de hoje entra", async () => {
    await pesquisa({ criadoEm: new Date(Date.now() - 40 * DIA) });
    await pesquisa({ criadoEm: new Date(Date.now() - 29 * DIA) });
    const hoje = await pesquisa({});
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.resumo.total).toBe(2);
    expect(r.linhas[0].id).toBe(hoje.id);
  });

  it("a janela começa 30 dias antes da meia-noite de hoje (Brasília): uma hora depois entra, uma hora antes não", async () => {
    const agora = new Date("2026-10-10T18:00:00Z");
    const desde = new Date("2026-09-10T03:00:00Z");
    const dentro = await pesquisa({ criadoEm: new Date(desde.getTime() + 3_600_000) });
    await pesquisa({ criadoEm: new Date(desde.getTime() - 3_600_000) });
    const r = await pesquisasNaHoraDoAdmin(agora);
    expect(r.desde.toISOString()).toBe(desde.toISOString());
    expect(r.linhas.map((l) => l.id)).toEqual([dentro.id]);
  });

  it("com exatamente o limite de pesquisas, a lista não diz que foi cortada", async () => {
    for (let i = 0; i < 3; i += 1) await pesquisa({});
    const r = await pesquisasNaHoraDoAdmin(new Date(), 3);
    expect(r.linhas).toHaveLength(3);
    expect(r.cortadas).toBe(false);
  });

  it("a lista é cortada no limite e o resumo continua sendo da janela inteira", async () => {
    for (let i = 0; i < 5; i += 1) await pesquisa({ buscas: 1, custoUsd: "0.010000" });
    const r = await pesquisasNaHoraDoAdmin(new Date(), 3);
    expect(r.linhas).toHaveLength(3);
    expect(r.cortadas).toBe(true);
    expect(r.resumo.total).toBe(5);
    expect(r.resumo.buscas).toBe(5);
  });

  it("o roteiro que nasceu da pesquisa conta na linha (a cópia que ele guarda aponta para ela); o de outra marca com o mesmo id não", async () => {
    const p = await pesquisa({ confirmadaEm: new Date() });
    const copia = { pesquisaId: p.id, dados: [achado(1)], posicaoDaPessoa: null, decisaoDaPremissa: null, avisoDaPremissa: null, pesquisadaEm: new Date().toISOString() };
    const base = { data: "2026-10-10", tema: "t", origem: "livre" as const, objetivo: "alcance" as const, conteudo: { gancho: "g", corpo: "c", fechamento: "f", chamadaFinal: "x" } as never };
    const [raiz] = await db().insert(roteiros).values({ ...base, clienteId: marcaA, pesquisaNaHora: copia }).returning({ id: roteiros.id });
    // reprovar e reescrever cria outra linha com a mesma cópia da pesquisa: é uma versão, não outro roteiro
    await db().insert(roteiros).values([
      { ...base, clienteId: marcaA, pesquisaNaHora: copia, versao: 2, versaoDe: raiz.id },
      { ...base, clienteId: marcaA, pesquisaNaHora: copia, versao: 3, versaoDe: raiz.id },
      { ...base, clienteId: marcaA, pesquisaNaHora: copia },
      { ...base, clienteId: marcaB, pesquisaNaHora: copia },
      { ...base, clienteId: marcaA, pesquisaNaHora: { ...copia, pesquisaId: p.id + 1000 } },
      { ...base, clienteId: marcaA, pesquisaNaHora: null },
    ]);
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.linhas[0]).toMatchObject({ id: p.id, roteiros: 2, confirmada: true });
    expect(r.resumo.comRoteiro).toBe(1);
  });

  it("a premissa que não bate, a decisão e a pergunta de posição aparecem na linha", async () => {
    await pesquisa({
      premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: x.", anguloSugerido: null, achadoIds: [1] },
      decisaoDaPremissa: "manter",
      perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] },
      posicaoDaPessoa: "Dos dois",
    });
    const [l] = (await pesquisasNaHoraDoAdmin()).linhas;
    expect(l).toMatchObject({ premissa: "nao_confere", decisao: "manter", perguntouPosicao: true, respondeuPosicao: true });
    // a que perguntou e a pessoa ainda não respondeu
    await db().delete(pesquisasNaHora);
    await pesquisa({ perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] } });
    const [sem_resposta] = (await pesquisasNaHoraDoAdmin()).linhas;
    expect(sem_resposta).toMatchObject({ perguntouPosicao: true, respondeuPosicao: false, premissa: "sem_premissa", decisao: null });
  });

  it("a pesquisa que ficou presa há mais de 15 minutos aparece fechada como erro, não como 'rodando' para sempre", async () => {
    const parada = { achados: [] as AchadoDaPesquisa[], selecionados: [] as number[], buscas: 0, custoUsd: "0", terminadoEm: null };
    await pesquisa({ ...parada, status: "pesquisando", criadoEm: new Date(Date.now() - 40 * 60_000) });
    await pesquisa({ ...parada, status: "executando", criadoEm: new Date(Date.now() - 40 * 60_000) });
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.resumo).toMatchObject({ rodando: 0, erros: 2 });
    expect(r.linhas.map((l) => l.status)).toEqual(["erro", "erro"]);
    expect(r.linhas.every((l) => l.motivo?.includes("demorou mais do que devia"))).toBe(true);
    const no_banco = await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.status, "erro"));
    expect(no_banco).toHaveLength(2);
  });

  it("a de 14 minutos ainda roda, e continua 'rodando' no resumo", async () => {
    await pesquisa({ status: "executando", achados: [], selecionados: [], buscas: 0, custoUsd: "0", terminadoEm: null, criadoEm: new Date(Date.now() - 14 * 60_000) });
    const r = await pesquisasNaHoraDoAdmin();
    expect(r.resumo).toMatchObject({ rodando: 1, erros: 0 });
    expect(r.linhas[0]).toMatchObject({ status: "executando", duracaoS: null });
  });
});

describe("desfechoDaPesquisa", () => {
  const base = { status: "pronta" as const, dados: 6, marcados: 3, confirmada: true, roteiros: 0, premissa: "sem_premissa" as const, decisao: null, perguntouPosicao: false };

  it.each([
    [{ status: "pesquisando" as const }, "Rodando"],
    [{ status: "executando" as const }, "Rodando"],
    [{ status: "erro" as const }, "Não terminou"],
    [{ status: "sem_achados" as const }, "Sem dado confiável"],
    [{ marcados: 0, confirmada: false }, "Pronta, 6 dados, a pessoa ainda não marcou"],
    // o motor já deixa os dados pré-marcados: sem a confirmação da pessoa, isso não conta como marcado por ela
    [{ confirmada: false }, "Pronta, 6 dados, a pessoa ainda não marcou"],
    [{ confirmada: false, roteiros: 1 }, "Pronta, 3 de 6 dados marcados, virou roteiro"],
    [{}, "Pronta, 3 de 6 dados marcados, ainda sem roteiro"],
    [{ roteiros: 1 }, "Pronta, 3 de 6 dados marcados, virou roteiro"],
    [{ roteiros: 2 }, "Pronta, 3 de 6 dados marcados, virou 2 roteiros"],
    [{ roteiros: 1, premissa: "nao_confere" as const, decisao: "fontes" as const }, "Pronta, 3 de 6 dados marcados, virou roteiro, a premissa não batia, seguiu as fontes"],
    [{ premissa: "nao_confere" as const, decisao: "manter" as const, perguntouPosicao: true }, "Pronta, 3 de 6 dados marcados, ainda sem roteiro, a premissa não batia, seguiu com o que escreveu, perguntou a posição"],
    [{ premissa: "nao_confere" as const, decisao: null }, "Pronta, 3 de 6 dados marcados, ainda sem roteiro, a premissa não batia"],
  ])("%j", (mudanca, esperado) => {
    expect(desfechoDaPesquisa({ ...base, ...mudanca })).toBe(esperado);
  });

  it("um dado só fala no singular", () => {
    expect(desfechoDaPesquisa({ ...base, dados: 1, marcados: 1 })).toBe("Pronta, 1 de 1 dado marcado, ainda sem roteiro");
  });
});
