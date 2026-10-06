/**
 * A E55, o motor das tendências do Brasil, contra o Postgres real e com respostas GRAVADAS (nenhuma chamada de rede): a coleta (Google Trends e YouTube), o tema "do momento" nos temas do dia
 * (entra na terceira vaga, nunca troca um tema que já virou roteiro, nunca vem de assunto sensível, some quando o assunto sai da lista, não vai para outro dia) e a nota do tema com a lista.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, roteiros, temasDia, tendenciasAvaliadas, tendenciasBrasil, user, type TemaDoDia } from "@/db/schema";
import { ErroColeta } from "@/jobs/execucoes";
import { atualizarTemaDoMomento, atualizarTemasDoMomentoDosSetoresEmUso } from "@/jobs/tema-do-momento";
import { comOMomentoQueJaEstava, semOMomento } from "@/jobs/temas-do-dia";
import { rodarTendenciasBrasil } from "@/jobs/tendencias-brasil";
import type { YoutubeVideoPopular } from "@/jobs/youtube-api";
import { hojeISO } from "@/lib/config";
import { ErroRoteiro, gerarRoteiro } from "@/servicos/roteiro";
import { avaliarTema, temasParaCliente } from "@/servicos/temas";
import { chaveDoAssunto } from "@/servicos/tendencias";

import { resetarSchema } from "../../scripts/resetar-schema";

const PASTA = path.join(process.cwd(), "tests", "fixtures", "tendencias");
const feed = () => readFileSync(path.join(PASTA, "google-trends-br.xml"), "utf8");
const youtube = () => (JSON.parse(readFileSync(path.join(PASTA, "youtube-mais-populares-br.json"), "utf8")) as { items: YoutubeVideoPopular[] }).items;

const HORA = 60 * 60 * 1000;

let nichoId: number;
let nichoSemUsoId: number;
let clienteId: number;

function temaComum(n: number): TemaDoDia {
  return { titulo: `tema comum ${n}`, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
}

async function rodada(quando: Date, assuntos: { assunto: string; sensivel?: boolean; termos?: string[] }[]): Promise<void> {
  await db()
    .insert(tendenciasBrasil)
    .values(
      assuntos.map((a, i) => ({
        coletadaEm: quando,
        assunto: a.assunto,
        chave: chaveDoAssunto(a.assunto),
        termos: a.termos ?? [a.assunto],
        fontes: [{ fonte: "google" as const, titulo: a.assunto, url: "https://g1.globo.com/a", trafego: "2000+", posicao: i + 1 }],
        posicao: i + 1,
        sensivel: a.sensivel ?? false,
      })),
    );
}

async function temasDeHoje(id = nichoId): Promise<TemaDoDia[]> {
  const [linha] = await db().select({ temas: temasDia.temas }).from(temasDia).where(and(eq(temasDia.nichoId, id), eq(temasDia.data, hojeISO())));
  return linha?.temas ?? [];
}

async function limparDoDia(): Promise<void> {
  await db().delete(tendenciasAvaliadas);
  await db().delete(tendenciasBrasil);
  await db().delete(temasDia);
  await db().delete(roteiros);
  await db().delete(geracoesIA);
}

async function roteiroDeHoje(tema: string): Promise<void> {
  await db()
    .insert(roteiros)
    .values({ clienteId, data: hojeISO(), tema, origem: "sugerido", objetivo: "alcance", conteudo: { gancho: "g", corpo: "c", fechamento: "f", chamadaFinal: "x" } } as never);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "tendencias-teste", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  const [semUso] = await db().insert(nichos).values({ slug: "tendencias-sem-uso", nome: "Setor parado", termos: [] }).returning();
  nichoSemUsoId = semUso.id;
  await db().insert(user).values({ id: "tendencias-usuario", name: "Marca", email: "tendencias@exemplo.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "tendencias-usuario", nome: "Marca", nichoId }).returning();
  clienteId = cliente.id;
  await db()
    .insert(briefings)
    .values({
      clienteId,
      completo: true,
      perfil: {
        fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "produtos de limpeza",
        referencias: [],
      },
    });
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("a coleta das tendências do Brasil", () => {
  it("grava os assuntos das duas fontes numa rodada só (mesma hora), com a fonte, o volume e o link; o sensível pelas palavras fica marcado", async () => {
    await limparDoDia();
    const agora = new Date("2026-10-06T08:50:00Z");
    const resumo = await rodarTendenciasBrasil({ agora, baixarGoogle: async () => feed(), buscarYoutube: async () => youtube(), semTemaDoMomento: true });
    expect(resumo.buscasDoGoogle).toBe(5);
    expect(Number(resumo.videosDoYoutube)).toBeGreaterThan(0);
    expect(resumo.agrupadoPorModelo).toBe(true);

    const linhas = await db().select().from(tendenciasBrasil).orderBy(tendenciasBrasil.posicao);
    expect(linhas.length).toBe(resumo.assuntos);
    expect(new Set(linhas.map((l) => l.coletadaEm.toISOString()))).toEqual(new Set([agora.toISOString()]));
    expect(linhas.map((l) => l.posicao)).toEqual(linhas.map((_, i) => i + 1));
    const doGoogle = linhas.find((l) => l.fontes.some((f) => f.fonte === "google"))!;
    expect(doGoogle.fontes[0]).toMatchObject({ fonte: "google", trafego: expect.any(String) });
    expect(linhas.some((l) => l.fontes.some((f) => f.fonte === "youtube" && f.url?.startsWith("https://www.youtube.com/watch?v=")))).toBe(true);
    // O primeiro item do feed gravado tem notícias com candidato e partido: o código marca como sensível mesmo o modelo (simulado) não marcando.
    expect(linhas.some((l) => l.sensivel)).toBe(true);
    expect(resumo.sensiveis).toBe(linhas.filter((l) => l.sensivel).length);
    // O agrupamento fica no registro de IA, com o custo (a coleta em si custa zero).
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "agruparTendencias"));
    expect(geracoes).toHaveLength(1);
  });

  it("uma fonte fora do ar não derruba a outra; as duas fora do ar viram um erro de coleta que repete", async () => {
    await limparDoDia();
    const so = await rodarTendenciasBrasil({ agora: new Date("2026-10-06T09:00:00Z"), baixarGoogle: async () => { throw new Error("o feed respondeu 503"); }, buscarYoutube: async () => youtube(), semTemaDoMomento: true });
    expect(so.buscasDoGoogle).toBe(0);
    expect(String((so.falhas as string[])[0])).toContain("Google Trends");
    expect(Number(so.assuntos)).toBeGreaterThan(0);

    await limparDoDia();
    await expect(
      rodarTendenciasBrasil({ agora: new Date(), baixarGoogle: async () => { throw new Error("fora"); }, buscarYoutube: async () => { throw new Error("cota"); }, semTemaDoMomento: true }),
    ).rejects.toBeInstanceOf(ErroColeta);
    expect(await db().select().from(tendenciasBrasil)).toHaveLength(0);
  });
});

describe("o tema do momento nos temas do dia", () => {
  it("entra na terceira vaga (os dois primeiros ficam), com o assunto de origem e a fonte; assunto sensível não vira tema; a segunda chamada não repete", async () => {
    await limparDoDia();
    const rodadaEm = new Date(Date.now() - HORA);
    await rodada(rodadaEm, [{ assunto: "Eleição 2026", sensivel: true }, { assunto: "Fim da escala 6x1", termos: ["escala 6x1", "PEC"] }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1), temaComum(2), temaComum(3)] });

    const nicho = { id: nichoId, nome: "Produtos de limpeza", termos: ["limpeza"] };
    expect(await atualizarTemaDoMomento(nicho)).toBe("criado");
    const temas = await temasDeHoje();
    expect(temas.map((t) => t.titulo)).toEqual(["tema comum 1", "tema comum 2", "Tema do momento: Fim da escala 6x1"]);
    expect(temas[2].doMomento).toMatchObject({ assunto: "Fim da escala 6x1", fonte: "Em alta no Google no Brasil", encaixe: 8, coletadaEm: rodadaEm.toISOString() });
    expect(temas[2].doMomento?.chave).toBe(chaveDoAssunto("Fim da escala 6x1"));
    // O sensível ficou de fora: o modelo nem o recebeu como escolha (o simulador pega o primeiro não sensível).
    expect(temas.some((t) => t.doMomento?.assunto === "Eleição 2026")).toBe(false);

    expect(await atualizarTemaDoMomento(nicho)).toBe("mantido");
    expect((await db().select().from(tendenciasAvaliadas)).filter((a) => a.nichoId === nichoId)).toHaveLength(1);
  });

  it("nunca troca um tema que já virou roteiro hoje: com os três usados, não há vaga; com um livre, é esse", async () => {
    await limparDoDia();
    await rodada(new Date(Date.now() - HORA), [{ assunto: "Preço do café sobe" }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1), temaComum(2), temaComum(3)] });
    for (const n of [1, 2, 3]) await roteiroDeHoje(`tema comum ${n}`);
    const nicho = { id: nichoId, nome: "Produtos de limpeza", termos: [] };
    expect(await atualizarTemaDoMomento(nicho)).toBe("sem_vaga");
    expect((await temasDeHoje()).every((t) => !t.doMomento)).toBe(true);

    await db().delete(roteiros).where(eq(roteiros.tema, "tema comum 2"));
    expect(await atualizarTemaDoMomento(nicho)).toBe("criado");
    // Troca no lugar do último tema que ninguém usou ("tema comum 2"); os usados ficam onde estavam.
    expect((await temasDeHoje()).map((t) => t.titulo)).toEqual(["tema comum 1", "Tema do momento: Preço do café sobe", "tema comum 3"]);
  });

  it("sem nenhum assunto que não seja sensível, não chama o modelo e marca a rodada; sem lista de agora, não faz nada", async () => {
    await limparDoDia();
    const nicho = { id: nichoId, nome: "Produtos de limpeza", termos: [] };
    expect(await atualizarTemaDoMomento(nicho)).toBe("sem_lista");
    await rodada(new Date(Date.now() - HORA), [{ assunto: "Morte de cantor", sensivel: true }]);
    expect(await atualizarTemaDoMomento(nicho)).toBe("sem_assunto");
    expect(await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temaDoMomento"))).toHaveLength(0);
    // Uma lista velha (mais de 18 horas) já não é "a lista de agora".
    await limparDoDia();
    await rodada(new Date(Date.now() - 20 * HORA), [{ assunto: "Preço do café sobe" }]);
    expect(await atualizarTemaDoMomento(nicho)).toBe("sem_lista");
  });

  it("nenhum assunto cabe no setor (o modelo devolve nenhum): a rodada fica avaliada e nenhum tema nasce", async () => {
    await limparDoDia();
    await rodada(new Date(Date.now() - HORA), [{ assunto: "SEM_ENCAIXE_TESTE assunto de outro mundo" }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    const nicho = { id: nichoId, nome: "Produtos de limpeza", termos: [] };
    expect(await atualizarTemaDoMomento(nicho)).toBe("sem_encaixe");
    expect(await atualizarTemaDoMomento(nicho)).toBe("ja_avaliado");
    expect((await temasDeHoje()).map((t) => t.titulo)).toEqual(["tema comum 1"]);
  });

  it("some quando o assunto sai da lista (a rodada do meio-dia), no Hoje e na linha do dia; o tema comum fica", async () => {
    await limparDoDia();
    await rodada(new Date(Date.now() - 6 * HORA), [{ assunto: "Fim da escala 6x1", termos: ["escala 6x1"] }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1), temaComum(2)] });
    const nicho = { id: nichoId, nome: "Produtos de limpeza", termos: [] };
    expect(await atualizarTemaDoMomento(nicho)).toBe("criado");
    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const antes = await temasParaCliente(cliente);
    expect(antes.status === "ok" && antes.temas.some((t) => t.doMomento)).toBe(true);

    // O meio-dia: a lista nova não tem mais o assunto, só um sensível. O Hoje já não mostra o tema (mesmo antes de o job rodar), e o job tira da linha.
    await rodada(new Date(Date.now() - 1000), [{ assunto: "Jogo do Flamengo", sensivel: false, termos: ["flamengo"] }]);
    const depois = await temasParaCliente(cliente);
    expect(depois.status === "ok" && depois.temas.map((t) => t.titulo)).toEqual(["tema comum 1", "tema comum 2"]);
    await atualizarTemaDoMomento(nicho);
    const linha = await temasDeHoje();
    expect(linha.filter((t) => t.doMomento).map((t) => t.doMomento?.assunto)).not.toContain("Fim da escala 6x1");
    expect(linha.filter((t) => !t.doMomento).map((t) => t.titulo)).toEqual(["tema comum 1", "tema comum 2"]);
  });

  it("o tema do momento é para hoje: o roteiro dele para outro dia é recusado no servidor, e o de hoje sai pedindo o formato mais fácil de gravar", async () => {
    await limparDoDia();
    await rodada(new Date(Date.now() - HORA), [{ assunto: "Fim da escala 6x1" }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    await atualizarTemaDoMomento({ id: nichoId, nome: "Produtos de limpeza", termos: [] });
    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const resultado = await temasParaCliente(cliente);
    if (resultado.status !== "ok") throw new Error("sem tema");
    const indice = resultado.temas.findIndex((t) => t.doMomento);
    expect(indice).toBeGreaterThanOrEqual(0);

    const amanha = new Date(Date.now() + 24 * HORA).toISOString().slice(0, 10);
    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance", data: amanha })).rejects.toThrow("Tendência é para hoje");
    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance", data: amanha })).rejects.toBeInstanceOf(ErroRoteiro);

    const hoje = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" });
    expect(hoje.data).toBe(hojeISO());
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro"));
    expect(JSON.stringify(geracoes.map((g) => g.entradas))).toContain("Este é um tema do momento");

    // O tema comum, para outro dia, continua valendo (a recusa é só do tema do momento).
    await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance", data: amanha });
  });

  it("gerar os temas de novo nunca apaga o tema do momento: ele continua na terceira vaga e a contagem de temas de verdade ignora ele", () => {
    const momento: TemaDoDia = { ...temaComum(9), titulo: "do momento", doMomento: { chave: "x", assunto: "x", termos: [], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 8 } };
    expect(semOMomento([temaComum(1), momento]).map((t) => t.titulo)).toEqual(["tema comum 1"]);
    const novos = [temaComum(1), temaComum(2), temaComum(3)];
    expect(comOMomentoQueJaEstava(novos, [temaComum(7), momento]).map((t) => t.titulo)).toEqual(["tema comum 1", "tema comum 2", "do momento"]);
    expect(comOMomentoQueJaEstava(novos, [temaComum(7)]).map((t) => t.titulo)).toEqual(["tema comum 1", "tema comum 2", "tema comum 3"]);
  });

  it("depois de cada coleta só os setores em uso (marca com roteiro nos últimos 3 dias) ganham tema do momento", async () => {
    await limparDoDia();
    await rodada(new Date(Date.now() - HORA), [{ assunto: "Preço do café sobe" }]);
    await db().insert(temasDia).values([
      { nichoId, data: hojeISO(), temas: [temaComum(1)] },
      { nichoId: nichoSemUsoId, data: hojeISO(), temas: [temaComum(1)] },
    ]);
    await roteiroDeHoje("tema comum 1");
    const resumo = await atualizarTemasDoMomentoDosSetoresEmUso();
    expect(resumo.setores).toBe(1);
    expect((await temasDeHoje(nichoId)).some((t) => t.doMomento)).toBe(true);
    expect((await temasDeHoje(nichoSemUsoId)).some((t) => t.doMomento)).toBe(false);
  });
});

describe("a nota do tema com os assuntos em alta no Brasil", () => {
  it("o assunto em alta que toca o tema entra na entrada, e a nota sobe sem vídeo no banco; sem nenhum tocando, o bloco diz que nenhum toca", async () => {
    await limparDoDia();
    await rodada(new Date(Date.now() - HORA), [{ assunto: "Eleição 2026", sensivel: true, termos: ["eleição"] }]);
    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];

    const com = await avaliarTema(cliente, "o que a eleição muda para o meu negócio de limpeza");
    expect(com.pilares.viralizar.nota).toBeGreaterThanOrEqual(6);
    const [geracao] = await db().select().from(geracoesIA).where(and(eq(geracoesIA.clienteId, clienteId), eq(geracoesIA.tarefa, "avaliarTema")));
    expect(JSON.stringify(geracao.entradas)).toContain("assuntos_em_alta");
    expect(JSON.stringify(geracao.entradas)).toContain("Eleição 2026");

    await db().delete(geracoesIA);
    await avaliarTema(cliente, "como escolher o melhor produto para tirar mancha de gordura");
    const [sem] = await db().select().from(geracoesIA).where(and(eq(geracoesIA.clienteId, clienteId), eq(geracoesIA.tarefa, "avaliarTema")));
    expect(JSON.stringify(sem.entradas)).toContain("nenhum encontrado");
  });
});
