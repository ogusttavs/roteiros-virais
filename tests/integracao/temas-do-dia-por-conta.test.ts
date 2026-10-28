/**
 * E61 PR 2, os temas do dia por conta (28/10/2026), contra o Postgres real e a IA em mock:
 *  - a conta com foco confirmado ganha três temas escritos para o foco, cada um com vídeo de prova do próprio foco; duas contas do MESMO setor, no mesmo dia, recebem temas diferentes;
 *  - sem foco (ou com foco só sugerido) nada muda: a conta lê os temas do setor;
 *  - cai para o setor quando o foco não achou vídeo (linha vazia), quando o dia fecha com menos de três (completa com o do setor, marcado) e quando o foco mudou ou foi tirado (lido na hora);
 *  - isolamento: nenhuma palavra do foco de uma conta aparece na linha, nos temas lidos nem nos registros da outra;
 *  - não gasta à toa: conta fora de uso não ganha tema, a segunda rodada não paga de novo, e o pedido de uma conta só não mexe no setor;
 *  - o custo vai para `geracoes_ia`, com o `clienteId`.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contas, geracoesIA, nichos, temasDia, temasDiaConta, user, videos } from "@/db/schema";
import { rodarTemasDoDia } from "@/jobs/temas-do-dia";
import { hojeISO } from "@/lib/config";
import { clientePorId } from "@/servicos/clientes";
import { temasParaCliente } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);

const FOCO_A = "automacao de marketing com inteligencia artificial para donos de pequenas empresas";
const FOCO_B = "posicionamento pessoal para quem constroi uma marca na internet";
const ASSUNTO_A = "automacao de marketing com inteligencia artificial";
const ASSUNTO_B = "mentoria de posicionamento pessoal e construir marca";

let nichoId: number;
let outroNichoId: number;
let contaDeVideo1: number;
let contaDeVideo2: number;
let contaA: number; // o Gustavo: marketing e automação
let contaB: number; // o Bruno: posicionamento, no mesmo setor
let contaC: number; // sem foco
let contaD: number; // foco só sugerido, sem resposta
let contaE: number; // foco confirmado, mas ninguém abre o aplicativo há dias
let contaF: number; // foco confirmado que não casa com nenhum vídeo do setor
let contaG: number; // outro setor, com foco
let idsDeA: number[] = [];
let idsDeB: number[] = [];

async function criarVideos(prefixo: string, assunto: string, quantidade: number, setor = nichoId): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    const [v] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: `${prefixo}-${i}`,
        url: `https://exemplo.invalido/${prefixo}-${i}`,
        nichoId: setor,
        contaId: i % 2 === 0 ? contaDeVideo1 : contaDeVideo2,
        titulo: `[exemplo] ${prefixo} ${i}`,
        views: 100,
        publicadoEm: diasAtras(3),
        velocidadeRelativa: String(5 + i),
        idioma: "pt",
        analise: { assunto, gancho: "x", estrutura: "x", fechamento: "x", chamadaFinal: "x", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
      })
      .returning({ id: videos.id });
    ids.push(v.id);
  }
  return ids;
}

async function criarConta(usuarioId: string, nome: string, setor: number, extra: Partial<typeof clientes.$inferInsert> = {}): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: nome, email: `${usuarioId}@temas-por-conta.teste`, role: "cliente" });
  const [c] = await db().insert(clientes).values({ usuarioId, nome, nichoId: setor, ultimoAcessoEm: new Date(), ...extra }).returning({ id: clientes.id });
  return c.id;
}

const confirmado = (foco: string) => ({ foco, focoOrigem: "escrito" as const, focoConfirmadoEm: new Date() });

async function linhaDaConta(clienteId: number) {
  const [linha] = await db().select().from(temasDiaConta).where(and(eq(temasDiaConta.clienteId, clienteId), eq(temasDiaConta.data, hojeISO())));
  return linha;
}

async function titulosLidos(clienteId: number): Promise<string[]> {
  const cliente = await clientePorId(clienteId);
  const resultado = await temasParaCliente(cliente!);
  expect(resultado.status).toBe("ok");
  return resultado.status === "ok" ? resultado.temas.map((t) => t.titulo) : [];
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "temas-por-conta", nome: "Empreendedorismo de teste", termos: [], criadoEm: diasAtras(30) }).returning();
  const [outro] = await db().insert(nichos).values({ slug: "temas-por-conta-outro", nome: "Outro setor de teste", termos: [], criadoEm: diasAtras(30) }).returning();
  nichoId = nicho.id;
  outroNichoId = outro.id;
  const criadas = await db()
    .insert(contas)
    .values([
      { plataforma: "youtube", handle: "tpc-conta-1", nichoId },
      { plataforma: "youtube", handle: "tpc-conta-2", nichoId },
    ])
    .returning({ id: contas.id });
  [contaDeVideo1, contaDeVideo2] = criadas.map((c) => c.id);

  contaA = await criarConta("tpc-a", "[teste] Conta A", nichoId, confirmado(FOCO_A));
  contaB = await criarConta("tpc-b", "[teste] Conta B", nichoId, confirmado(FOCO_B));
  contaC = await criarConta("tpc-c", "[teste] Conta C", nichoId);
  contaD = await criarConta("tpc-d", "[teste] Conta D", nichoId, { foco: FOCO_A, focoOrigem: "sugerido" });
  contaE = await criarConta("tpc-e", "[teste] Conta E", nichoId, { ...confirmado(FOCO_A), ultimoAcessoEm: diasAtras(20) });
  contaF = await criarConta("tpc-f", "[teste] Conta F", nichoId, confirmado("xylofonia zumbidos quimeras"));
  contaG = await criarConta("tpc-g", "[teste] Conta G", outroNichoId, confirmado(FOCO_A));
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  await db().delete(temasDiaConta);
  await db().delete(temasDia);
  await db().delete(videos);
  await db().delete(geracoesIA);
  // Os focos voltam ao que o beforeAll criou (um teste muda o da conta A).
  await db().update(clientes).set(confirmado(FOCO_A)).where(eq(clientes.id, contaA));
  idsDeA = await criarVideos("assunto-a", ASSUNTO_A, 4);
  idsDeB = await criarVideos("assunto-b", ASSUNTO_B, 4);
});

describe("os temas do dia por conta", () => {
  it("duas contas do mesmo setor, no mesmo dia, recebem temas diferentes, cada um com vídeo de prova do próprio foco", async () => {
    const resumo = await rodarTemasDoDia();
    expect(resumo.falhas).toBe(0);
    expect(resumo.contasGeradas).toBe(2);

    const [a, b] = [await linhaDaConta(contaA), await linhaDaConta(contaB)];
    expect(a.temas).toHaveLength(3);
    expect(b.temas).toHaveLength(3);
    expect(a.temas.every((t) => t.titulo.startsWith("tema do foco simulado"))).toBe(true);
    // A prova de cada conta é só dos vídeos do assunto dela.
    for (const tema of a.temas) expect(tema.evidencias.every((id) => idsDeA.includes(id))).toBe(true);
    for (const tema of b.temas) expect(tema.evidencias.every((id) => idsDeB.includes(id))).toBe(true);
    expect(a.temas.every((t) => t.evidencias.length >= 3)).toBe(true);
    expect(a.temas.map((t) => t.titulo)).not.toEqual(b.temas.map((t) => t.titulo));
    expect(a.focoUsado).toBe(FOCO_A);
    expect(b.focoUsado).toBe(FOCO_B);

    // O que a tela lê: os temas de cada conta, nunca os do outro.
    expect(await titulosLidos(contaA)).toEqual(a.temas.map((t) => t.titulo));
    expect(await titulosLidos(contaB)).toEqual(b.temas.map((t) => t.titulo));
  });

  it("sem foco, ou com foco só sugerido, nada muda: a conta lê os temas do setor, e nada é gerado por ela", async () => {
    await rodarTemasDoDia();
    const [setor] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    const titulosDoSetor = setor.temas.map((t) => t.titulo);
    expect(titulosDoSetor.every((t) => t.startsWith("tema simulado"))).toBe(true);

    expect(await titulosLidos(contaC)).toEqual(titulosDoSetor);
    expect(await titulosLidos(contaD)).toEqual(titulosDoSetor);
    expect(await linhaDaConta(contaC)).toBeUndefined();
    expect(await linhaDaConta(contaD)).toBeUndefined();
    const dasContas = await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.clienteId, contaC));
    expect(dasContas).toHaveLength(0);
  });

  it("a conta que ninguém abre há dias não ganha tema por foco (e não custa nada), e a de outro setor só olha o setor dela", async () => {
    await rodarTemasDoDia();
    expect(await linhaDaConta(contaE)).toBeUndefined();
    const gastoDaE = await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.clienteId, contaE));
    expect(gastoDaE).toHaveLength(0);
    // O outro setor não tem vídeo nenhum: a conta G não ganha linha e nunca recebe vídeo do setor da A.
    expect(await linhaDaConta(contaG)).toBeUndefined();
  });

  it("o foco que não casa com nenhum vídeo do setor deixa a linha vazia e a conta lê exatamente os temas do setor", async () => {
    await rodarTemasDoDia();
    const linha = await linhaDaConta(contaF);
    expect(linha.temas).toEqual([]);
    const [setor] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(await titulosLidos(contaF)).toEqual(setor.temas.map((t) => t.titulo));
  });

  it("quando o foco sustenta só dois temas, o terceiro vem do setor, marcado, e a tela recebe os três", async () => {
    await db().update(clientes).set(confirmado(`${FOCO_A} dois-temas-simulado`)).where(eq(clientes.id, contaA));
    await rodarTemasDoDia();
    const linha = await linhaDaConta(contaA);
    expect(linha.temas).toHaveLength(3);
    expect(linha.temas.filter((t) => !t.doSetor)).toHaveLength(2);
    const doSetor = linha.temas.filter((t) => t.doSetor);
    expect(doSetor).toHaveLength(1);
    expect(doSetor[0].titulo.startsWith("tema simulado")).toBe(true);
    // O do setor não repete título de tema do foco, e a tela tem a frase para dizer de onde ele veio.
    expect(new Set(linha.temas.map((t) => t.titulo)).size).toBe(3);
    expect(textosHoje.temaDoSetor).toContain("Do seu setor em geral");
    expect(await titulosLidos(contaA)).toHaveLength(3);
  });

  it("mudar ou tirar o foco vale na hora: a linha feita com o foco antigo nunca é lida", async () => {
    await rodarTemasDoDia();
    const antes = (await linhaDaConta(contaA)).temas.map((t) => t.titulo);
    expect(await titulosLidos(contaA)).toEqual(antes);
    const [setor] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    const titulosDoSetor = setor.temas.map((t) => t.titulo);

    await db().update(clientes).set(confirmado("outro assunto qualquer sobre vendas")).where(eq(clientes.id, contaA));
    expect(await titulosLidos(contaA)).toEqual(titulosDoSetor);

    await db().update(clientes).set({ foco: null, focoOrigem: null, focoConfirmadoEm: null }).where(eq(clientes.id, contaA));
    expect(await titulosLidos(contaA)).toEqual(titulosDoSetor);

    // Voltou ao mesmo foco da linha: ela volta a valer (o hash é do foco, não do momento).
    await db().update(clientes).set(confirmado(FOCO_A)).where(eq(clientes.id, contaA));
    expect(await titulosLidos(contaA)).toEqual(antes);
  });

  it("isolamento: nenhuma palavra do foco de uma conta aparece na linha, nos temas lidos nem nos registros da outra", async () => {
    await rodarTemasDoDia();
    const doB = JSON.stringify([await linhaDaConta(contaB), await titulosLidos(contaB)]).toLowerCase();
    expect(doB).not.toContain("automacao");
    expect(doB).not.toContain("inteligencia artificial");
    const doA = JSON.stringify([await linhaDaConta(contaA), await titulosLidos(contaA)]).toLowerCase();
    expect(doA).not.toContain("posicionamento");
    expect(doA).not.toContain("constroi uma marca");

    // As gerações de cada conta levam o clienteId dela, e as do B nunca têm o foco do A.
    const geracoesDoB = await db().select().from(geracoesIA).where(eq(geracoesIA.clienteId, contaB));
    expect(geracoesDoB.length).toBeGreaterThan(0);
    expect(JSON.stringify(geracoesDoB).toLowerCase()).not.toContain("automacao");
  });

  it("não paga de novo: a segunda rodada do dia, sem vídeo novo e com o mesmo foco, não refaz nada", async () => {
    await rodarTemasDoDia();
    const linhaAntes = await linhaDaConta(contaA);
    const geracoesAntes = await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));

    const resumo = await rodarTemasDoDia(nichoId, { forcar: true });
    expect(resumo.contasSemNovidade).toBe(3);
    expect(resumo.contasGeradas).toBe(0);
    expect((await linhaDaConta(contaA)).temas).toEqual(linhaAntes.temas);
    // Nenhuma chamada de tema com clienteId nova (a do setor pode ter rodado de novo; a das contas, não).
    const depois = await db().select({ id: geracoesIA.id, clienteId: geracoesIA.clienteId }).from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
    const novas = depois.filter((g) => !geracoesAntes.some((a) => a.id === g.id));
    expect(novas.filter((g) => g.clienteId !== null)).toHaveLength(0);
  });

  it("chegou vídeo novo no setor: a linha da conta é refeita", async () => {
    await rodarTemasDoDia();
    const antes = await linhaDaConta(contaA);
    await criarVideos("assunto-a-novo", ASSUNTO_A, 2);
    const resumo = await rodarTemasDoDia(nichoId, { forcar: true });
    expect(resumo.contasGeradas).toBeGreaterThanOrEqual(1);
    const depois = await linhaDaConta(contaA);
    expect(depois.candidatosHash).not.toBe(antes.candidatosHash);
  });

  it("o pedido de uma conta só (mudou o foco no meio do dia) gera os temas dela sem mexer nos do setor nem nos das outras", async () => {
    await rodarTemasDoDia();
    const [setorAntes] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    const linhaBAntes = await linhaDaConta(contaB);
    await db().delete(temasDiaConta).where(eq(temasDiaConta.clienteId, contaA));

    const resumo = await rodarTemasDoDia(nichoId, { clienteId: contaA });
    expect(resumo.contas).toBe(1);
    expect(resumo.contasGeradas).toBe(1);
    expect((await linhaDaConta(contaA)).temas).toHaveLength(3);
    const [setorDepois] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(setorDepois.temas).toEqual(setorAntes.temas);
    expect((await linhaDaConta(contaB)).id).toBe(linhaBAntes.id);
  });

  it("o pedido de uma conta sem foco confirmado (ou de outro setor) não gera nada", async () => {
    await rodarTemasDoDia();
    expect((await rodarTemasDoDia(nichoId, { clienteId: contaD })).contas).toBe(0);
    expect((await rodarTemasDoDia(nichoId, { clienteId: contaG })).contas).toBe(0);
    expect(await linhaDaConta(contaD)).toBeUndefined();
  });

  it("o custo vai para geracoes_ia com o clienteId: o filtro do foco (modelo barato) e os temas (modelo forte)", async () => {
    await rodarTemasDoDia();
    const deA = await db().select().from(geracoesIA).where(eq(geracoesIA.clienteId, contaA));
    const tarefas = deA.map((g) => g.tarefa);
    expect(tarefas).toContain("reordenarEvidencia");
    expect(tarefas).toContain("temasDoDia");
    const temas = deA.find((g) => g.tarefa === "temasDoDia")!;
    expect((temas.entradas as { modo?: string }).modo).toBe("foco_da_conta");
    expect(temas.versaoPrompt).toBe("1.10.0");
  });
});
