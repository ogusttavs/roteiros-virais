/**
 * A E52 (PR 2), a leitura dos vídeos longos, contra o Postgres real: o job `ler-longos` transcreve os poucos longos da semana (a transcrição é entregue gravada, nenhum `yt-dlp` nem
 * Groq) e lê a estrutura de cada um com a IA simulada (`AI_PROVIDER=mock`, o mock também passa pelo schema Zod de verdade). Os vídeos e os textos são inventados: o repositório é
 * público.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, custosExternos, geracoesIA, nichos, videos } from "@/db/schema";
import type { gerarEstruturado } from "@/ia/cliente";
import { rodarLerLongos } from "@/jobs/ler-longos";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-11T12:00:00Z");

let setorA: number;
let setorB: number;
let contaA: number;
let contaB: number;
let contaC: number;

/** Um texto falado de verdade, comprido o bastante para passar do mínimo do longo (1.200 caracteres). */
const TEXTO = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(" ");

type Semente = {
  idExterno: string;
  duracaoS?: number;
  foraDaCurva?: string;
  descricao?: string | null;
  setor?: number;
  conta?: number;
  transcricao?: string | null;
  transcritoDiasAtras?: number;
  analiseLongaDiasAtras?: number;
};

async function semear(s: Semente) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: s.idExterno,
      url: `https://exemplo.invalido/${s.idExterno}`,
      nichoId: s.setor ?? setorA,
      contaId: s.conta ?? contaA,
      titulo: `[exemplo] ${s.idExterno}`,
      descricao: s.descricao === undefined ? null : s.descricao,
      views: 200_000,
      foraDaCurva: s.foraDaCurva ?? "3.000",
      duracaoS: s.duracaoS ?? 600,
      publicadoEm: new Date(AGORA.getTime() - 4 * DIA_MS),
      idioma: "pt",
      transcricao: s.transcricao ?? null,
      transcritoEm: s.transcritoDiasAtras === undefined ? null : new Date(AGORA.getTime() - s.transcritoDiasAtras * DIA_MS),
      analiseLonga:
        s.analiseLongaDiasAtras === undefined
          ? null
          : {
              versaoPrompt: "1.0.0",
              origemDosCapitulos: "leitura",
              assunto: "já lido",
              abertura: { promessa: "x", entregaAteS: 10, tipo: "outro" },
              capitulos: [],
              lacos: [],
              ondeSairia: [],
              fechamento: { oQueFaz: "x", apontaParaProximoVideo: false },
              porQueFuncionou: "x",
            },
      analiseLongaEm: s.analiseLongaDiasAtras === undefined ? null : new Date(AGORA.getTime() - s.analiseLongaDiasAtras * DIA_MS),
    })
    .returning();
  return v;
}

const porIdExterno = async (idExterno: string) => (await db().select().from(videos).where(eq(videos.idExterno, idExterno)))[0];

/** A transcrição entregue gravada: o que `transcreverUm` faria com a legenda do YouTube (grava o texto e a hora). */
function transcritor(resultados: Record<string, "legenda" | "groq" | "pulado" | "proxy" | "foraDoAr" | "falha" | "excecao"> = {}, chamadas: string[] = [], bytesPorVideo = 0) {
  return async (video: { id: number; url: string; duracaoS: number; idioma: string | null }, medirBytes?: (bytes: number) => void) => {
    const [linha] = await db().select({ idExterno: videos.idExterno }).from(videos).where(eq(videos.id, video.id));
    chamadas.push(linha.idExterno);
    const como = resultados[linha.idExterno] ?? "legenda";
    if (como === "excecao") throw new Error("o yt-dlp quebrou de um jeito que ninguem previu");
    if (como === "proxy") return { tipo: "proxyFora" as const, motivo: "proxy sem trafego" as const };
    if (como === "foraDoAr") return { tipo: "proxyFora" as const, motivo: "proxy fora do ar" as const };
    if (como === "pulado") return { tipo: "pulado" as const };
    if (como === "falha") return { tipo: "falhou" as const, motivo: "link morto" };
    if (bytesPorVideo > 0) medirBytes?.(bytesPorVideo);
    await db().update(videos).set({ transcricao: TEXTO, transcritoEm: AGORA }).where(eq(videos.id, video.id));
    return como === "groq" ? { tipo: "groq" as const, duracaoS: video.duracaoS } : { tipo: "legenda" as const };
  };
}

const semPausa = async () => undefined;

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "longos-job-a", nome: "Produtos de limpeza", termos: ["limpeza", "sofá"] }).returning();
  setorA = a.id;
  const [b] = await db().insert(nichos).values({ slug: "longos-job-b", nome: "Odontologia", termos: ["dentista"] }).returning();
  setorB = b.id;
  const criarConta = async (handle: string, nichoId: number) => {
    const [c] = await db().insert(contas).values({ plataforma: "youtube", handle, nichoId, pais: "BR", idiomaPrincipal: "pt" }).returning();
    return c.id;
  };
  contaA = await criarConta("longos-job-a", setorA);
  contaB = await criarConta("longos-job-b", setorA);
  contaC = await criarConta("longos-job-c", setorB);
}, 60_000);

beforeEach(async () => {
  await db().delete(geracoesIA);
  await db().delete(custosExternos);
  await db().delete(videos);
});

afterAll(async () => {
  await getPool().end();
});

describe("rodarLerLongos", () => {
  it("transcreve os longos da semana e lê a estrutura de cada um: a lista do dono por cima, e a ficha de um curto fica nula", async () => {
    await semear({ idExterno: "com-lista", foraDaCurva: "5.000", descricao: "Passo a passo\n0:00 Abertura\n1:30 O erro\n4:00 O jeito certo\n8:00 Fechamento" });
    await semear({ idExterno: "sem-lista", foraDaCurva: "4.000", duracaoS: 540, conta: contaB });

    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa });
    expect(resumo).toMatchObject({ setores: 1, transcritosPorLegenda: 2, leiturasGravadas: 2, leiturasRecusadas: 0, leiturasQueFalharam: 0, falhasDeTranscricao: 0 });
    expect(resumo.minutosTranscritos).toBe(19);

    const comLista = await porIdExterno("com-lista");
    expect(comLista.analiseLonga).toMatchObject({ origemDosCapitulos: "descricao", versaoPrompt: "1.0.0" });
    expect(comLista.analiseLonga!.capitulos.map((c) => [c.inicioS, c.nome])).toEqual([
      [0, "Abertura"],
      [90, "O erro"],
      [240, "O jeito certo"],
      [480, "Fechamento"],
    ]);
    expect(comLista.analiseLonga!.capitulos[3].gancho).toBeNull();
    expect(comLista.analiseLongaEm).not.toBeNull();
    expect(comLista.proximaTentativaAnaliseLonga).toBeNull();
    // a ficha de um curto não é tocada: o longo não entra em Referências, temas nem evidência
    expect(comLista.analise).toBeNull();

    const semLista = await porIdExterno("sem-lista");
    expect(semLista.analiseLonga).toMatchObject({ origemDosCapitulos: "leitura" });
    expect(semLista.analiseLonga!.capitulos).toHaveLength(4);
    expect(semLista.analiseLonga!.capitulos[0].inicioS).toBe(0);
    expect(semLista.analise).toBeNull();
  });

  it("a leitura vai para o ramo certo na lista de gerações (a aba Custos lê dali)", async () => {
    await semear({ idExterno: "do-setor-a" });
    await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa });
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "extrairVideoLongo"));
    expect(geracoes).toHaveLength(1);
    expect(geracoes[0].ramoId).toBe(setorA);
    expect(geracoes[0].versaoPrompt).toBe("1.0.0");
  });

  it("o tráfego do proxy da rodada fica registrado, por setor, em megabytes e com o custo estimado", async () => {
    await semear({ idExterno: "p1", foraDaCurva: "9.000", conta: contaA });
    await semear({ idExterno: "p2", foraDaCurva: "8.000", conta: contaB });
    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({}, [], 4_000_000), pausaEntreVideos: semPausa });
    expect(resumo.megabytesPeloProxy).toBe(8);
    const linhas = await db().select().from(custosExternos).where(eq(custosExternos.fonte, "proxy"));
    expect(linhas).toHaveLength(1);
    expect(Number(linhas[0].unidades)).toBeCloseTo(8, 3);
    expect(linhas[0].unidade).toBe("megabytes");
    expect(Number(linhas[0].custoUsd)).toBeGreaterThan(0);
    expect(linhas[0].detalhe).toMatchObject({ setor: "longos-job-a", longos: true });
  });

  it("respeita o teto de minutos de vídeo da semana: o que não cabe espera, e o que já foi lido na semana desconta", async () => {
    expect(config.regras.longosMinutosPorSemana).toBe(90);
    await semear({ idExterno: "quarenta-1", duracaoS: 2400, foraDaCurva: "9.000", conta: contaA });
    await semear({ idExterno: "quarenta-2", duracaoS: 2400, foraDaCurva: "8.000", conta: contaB });
    await semear({ idExterno: "quarenta-3", duracaoS: 2400, foraDaCurva: "7.000", conta: contaA });
    await semear({ idExterno: "dez-minutos", duracaoS: 600, foraDaCurva: "6.000", conta: contaB });

    const chamadas: string[] = [];
    await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({}, chamadas), pausaEntreVideos: semPausa });
    // 40 + 40 = 80 minutos; o terceiro de 40 passaria dos 90 e fica de fora; o de 10 cabe e entra
    expect(chamadas).toEqual(["quarenta-1", "quarenta-2", "dez-minutos"]);
    expect((await porIdExterno("quarenta-3")).transcricao).toBeNull();
  });

  it("os minutos já lidos nos últimos sete dias descontam do teto da semana", async () => {
    // 50 minutos lidos anteontem (dois de 25): sobram 40
    await semear({ idExterno: "lido-1", duracaoS: 1500, transcricao: TEXTO, transcritoDiasAtras: 2, analiseLongaDiasAtras: 2, conta: contaC });
    await semear({ idExterno: "lido-2", duracaoS: 1500, transcricao: TEXTO, transcritoDiasAtras: 2, analiseLongaDiasAtras: 2, conta: contaC });
    await semear({ idExterno: "novo-40", duracaoS: 2400, foraDaCurva: "9.000", conta: contaA });
    await semear({ idExterno: "novo-30", duracaoS: 1800, foraDaCurva: "8.000", conta: contaB });

    const chamadas: string[] = [];
    await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({}, chamadas), pausaEntreVideos: semPausa });
    expect(chamadas).toEqual(["novo-40"]);
  });

  it("o proxy que recusa para a transcrição de todos os setores, sem marcar falha no vídeo, e o longo já transcrito ainda é lido", async () => {
    await semear({ idExterno: "ja-transcrito", transcricao: TEXTO, transcritoDiasAtras: 20, foraDaCurva: "2.000", conta: contaB });
    await semear({ idExterno: "o-que-o-proxy-recusa", foraDaCurva: "9.000" });
    await semear({ idExterno: "do-setor-b", setor: setorB, conta: contaC });

    const chamadas: string[] = [];
    const resumo = await rodarLerLongos(undefined, {
      agora: AGORA,
      transcrever: transcritor({ "o-que-o-proxy-recusa": "proxy" }, chamadas),
      pausaEntreVideos: semPausa,
    });
    // só uma tentativa: o proxy recusou e nada mais do YouTube foi tentado, em setor nenhum
    expect(chamadas).toEqual(["o-que-o-proxy-recusa"]);
    expect(resumo.youtubePausadoMotivo).toBe("proxy sem trafego");
    expect(resumo.falhasDeTranscricao).toBe(0);
    expect((await porIdExterno("o-que-o-proxy-recusa")).proximaTentativaTranscricao).toBeNull();
    expect((await porIdExterno("do-setor-b")).transcricao).toBeNull();
    // a leitura não passa pelo proxy: o que já estava transcrito é lido
    expect((await porIdExterno("ja-transcrito")).analiseLonga).not.toBeNull();
  });

  it("a falha de um vídeo conta e o job segue para o próximo", async () => {
    await semear({ idExterno: "falha", foraDaCurva: "9.000" });
    await semear({ idExterno: "boa", foraDaCurva: "8.000", conta: contaB });
    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({ falha: "falha" }), pausaEntreVideos: semPausa });
    expect(resumo).toMatchObject({ falhasDeTranscricao: 1, transcritosPorLegenda: 1, leiturasGravadas: 1 });
    expect(resumo.erros).toEqual([expect.stringContaining("link morto")]);
    expect((await porIdExterno("falha")).analiseLonga).toBeNull();
    expect((await porIdExterno("boa")).analiseLonga).not.toBeNull();
  });

  it("sem chave da Groq e sem legenda, o vídeo é pulado e contado à parte, sem leitura", async () => {
    await semear({ idExterno: "sem-legenda" });
    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({ "sem-legenda": "pulado" }), pausaEntreVideos: semPausa });
    expect(resumo).toMatchObject({ puladosSemChaveGroq: 1, leiturasGravadas: 0, falhasDeTranscricao: 0 });
  });

  it("texto curto demais (música, vinheta) não gasta a leitura", async () => {
    await semear({ idExterno: "so-musica", transcricao: "la la la la", transcritoDiasAtras: 30 });
    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa });
    expect(resumo.leiturasGravadas).toBe(0);
    expect((await porIdExterno("so-musica")).analiseLonga).toBeNull();
    expect((await db().select().from(geracoesIA)).length).toBe(0);
  });

  it("a saída sem estrutura é recusada pelo código e o vídeo espera seis dias; a IA que falha não marca nada", async () => {
    await semear({ idExterno: "sem-estrutura", transcricao: TEXTO, transcritoDiasAtras: 20, foraDaCurva: "9.000", conta: contaA });
    await semear({ idExterno: "ia-fora", transcricao: TEXTO, transcritoDiasAtras: 20, foraDaCurva: "8.000", conta: contaB });

    const gerar = (async (opcoes: { entrada: string }) => {
      if (opcoes.entrada.includes("ia-fora")) throw new Error("API fora do ar");
      return {
        dados: {
          assunto: "x",
          abertura: { promessa: "x", entregaAteS: null, tipo: "outro" },
          capitulos: [{ inicioS: 0, nome: "só um", oQueFaz: "x", gancho: null }],
          lacos: [],
          ondeSairia: [],
          fechamento: { oQueFaz: "x", apontaParaProximoVideo: false },
          porQueFuncionou: "x",
        },
        modelo: "simulado",
        tokensEntrada: 10,
        tokensSaida: 5,
        tokensCacheLeitura: 0,
        tokensCacheEscrita: 0,
      };
    }) as unknown as typeof gerarEstruturado;

    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa, gerar });
    expect(resumo).toMatchObject({ leiturasGravadas: 0, leiturasRecusadas: 1, leiturasQueFalharam: 1 });

    const recusado = await porIdExterno("sem-estrutura");
    expect(recusado.analiseLonga).toBeNull();
    // seis dias, e não sete: a rodada seguinte nasce segundos antes da hora desta
    expect(recusado.proximaTentativaAnaliseLonga!.getTime()).toBe(AGORA.getTime() + 6 * DIA_MS);
    // a IA que falha não marca nada: a rotina é semanal, e o vídeo volta na próxima rodada
    const queFalhou = await porIdExterno("ia-fora");
    expect(queFalhou.proximaTentativaAnaliseLonga).toBeNull();
  });

  it("a segunda recusa do mesmo vídeo o põe de lado por meio ano (o texto não muda)", async () => {
    await semear({ idExterno: "sem-estrutura", transcricao: TEXTO, transcritoDiasAtras: 20, conta: contaA });
    const gerar = (async () => ({
      dados: {
        assunto: "x",
        abertura: { promessa: "x", entregaAteS: null, tipo: "outro" },
        capitulos: [],
        lacos: [],
        ondeSairia: [],
        fechamento: { oQueFaz: "x", apontaParaProximoVideo: false },
        porQueFuncionou: "x",
      },
      modelo: "simulado",
      tokensEntrada: 1,
      tokensSaida: 1,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    })) as unknown as typeof gerarEstruturado;

    await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa, gerar });
    expect((await porIdExterno("sem-estrutura")).proximaTentativaAnaliseLonga!.getTime()).toBe(AGORA.getTime() + 6 * DIA_MS);

    // a semana seguinte: a data venceu, o vídeo é lido de novo, recusado de novo, e agora fica meio ano de fora
    const semanaSeguinte = new Date(AGORA.getTime() + 7 * DIA_MS);
    await rodarLerLongos(setorA, { agora: semanaSeguinte, transcrever: transcritor(), pausaEntreVideos: semPausa, gerar });
    expect((await porIdExterno("sem-estrutura")).proximaTentativaAnaliseLonga!.getTime()).toBe(semanaSeguinte.getTime() + 180 * DIA_MS);
  });

  it("a leitura segue as regras da escolha: abaixo do piso do ramo, fora da janela e de outro idioma não são lidos", async () => {
    await db().update(nichos).set({ pisoViews: 150_000 }).where(eq(nichos.id, setorA));
    try {
      await semear({ idExterno: "bom", transcricao: TEXTO, transcritoDiasAtras: 3, conta: contaA });
      await semear({ idExterno: "abaixo-do-piso", transcricao: TEXTO, transcritoDiasAtras: 3, conta: contaB });
      await db().update(videos).set({ views: 100_000 }).where(eq(videos.idExterno, "abaixo-do-piso"));
      await semear({ idExterno: "antigo", transcricao: TEXTO, transcritoDiasAtras: 3, conta: contaC });
      await db()
        .update(videos)
        .set({ publicadoEm: new Date(AGORA.getTime() - 200 * DIA_MS) })
        .where(eq(videos.idExterno, "antigo"));
      await semear({ idExterno: "outro-idioma", transcricao: TEXTO, transcritoDiasAtras: 3, conta: contaA });
      await db().update(videos).set({ idioma: "outro" }).where(eq(videos.idExterno, "outro-idioma"));

      const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa });
      expect(resumo.leiturasGravadas).toBe(1);
      expect((await porIdExterno("bom")).analiseLonga).not.toBeNull();
      for (const fora of ["abaixo-do-piso", "antigo", "outro-idioma"]) expect((await porIdExterno(fora)).analiseLonga, fora).toBeNull();
    } finally {
      await db().update(nichos).set({ pisoViews: null }).where(eq(nichos.id, setorA));
    }
  });

  it("o que não saiu (sem legenda e sem chave, ou uma exceção) ganha data e a vaga vai para o próximo da fila na mesma rodada", async () => {
    await semear({ idExterno: "sem-legenda", foraDaCurva: "9.000", conta: contaA });
    await semear({ idExterno: "quebrou", foraDaCurva: "8.000", conta: contaB });
    await semear({ idExterno: "boa-1", foraDaCurva: "7.000", conta: contaC });
    await semear({ idExterno: "boa-2", foraDaCurva: "6.000", conta: contaA });
    await semear({ idExterno: "boa-3", foraDaCurva: "5.000", conta: contaB });
    await semear({ idExterno: "boa-4", foraDaCurva: "4.000", conta: contaC });
    await semear({ idExterno: "boa-5", foraDaCurva: "3.000", conta: contaA });

    const chamadas: string[] = [];
    const resumo = await rodarLerLongos(setorA, {
      agora: AGORA,
      transcrever: transcritor({ "sem-legenda": "pulado", quebrou: "excecao" }, chamadas),
      pausaEntreVideos: semPausa,
    });
    // as 5 vagas da semana ficaram com 5 vídeos de verdade: os dois que não saíram não tomaram vaga
    expect(resumo).toMatchObject({ puladosSemChaveGroq: 1, falhasDeTranscricao: 1, transcritosPorLegenda: 5 });
    expect(chamadas).toEqual(["sem-legenda", "quebrou", "boa-1", "boa-2", "boa-3", "boa-4", "boa-5"]);
    for (const id of ["sem-legenda", "quebrou"]) {
      expect((await porIdExterno(id)).proximaTentativaTranscricao!.getTime()).toBe(AGORA.getTime() + 6 * DIA_MS);
    }
    // na semana seguinte a data venceu: os dois voltam para a frente da fila (e, se falharem de novo, de novo não tomam a vaga de ninguém)
    const semanaSeguinte = new Date(AGORA.getTime() + 7 * DIA_MS);
    const depois: string[] = [];
    await db().update(videos).set({ transcricao: null, transcritoEm: null, analiseLonga: null }).where(eq(videos.nichoId, setorA));
    await rodarLerLongos(setorA, { agora: semanaSeguinte, transcrever: transcritor({}, depois), pausaEntreVideos: semPausa });
    expect(depois.slice(0, 2)).toEqual(["sem-legenda", "quebrou"]);
  });

  it("o proxy que só 'caiu' uma vez não para a semana; três seguidas sim", async () => {
    for (const [i, conta] of [contaA, contaB, contaC, contaA, contaB].entries()) await semear({ idExterno: `v${i}`, foraDaCurva: String(9 - i) + ".000", conta });

    // uma só: segue
    const umaSo: string[] = [];
    const resumo1 = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({ v0: "foraDoAr" }, umaSo), pausaEntreVideos: semPausa });
    expect(resumo1.youtubePausadoMotivo).toBeUndefined();
    expect(umaSo).toEqual(["v0", "v1", "v2", "v3", "v4"]);

    // três seguidas: para
    await db().update(videos).set({ transcricao: null, transcritoEm: null, analiseLonga: null });
    const tres: string[] = [];
    const resumo3 = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({ v0: "foraDoAr", v1: "foraDoAr", v2: "foraDoAr" }, tres), pausaEntreVideos: semPausa });
    expect(resumo3.youtubePausadoMotivo).toBe("proxy fora do ar");
    expect(tres).toEqual(["v0", "v1", "v2"]);
  });

  it("o orçamento de tempo do setor para a transcrição, diz qual setor parou e segue para a leitura", async () => {
    await semear({ idExterno: "t1", foraDaCurva: "9.000", conta: contaA });
    await semear({ idExterno: "ja-transcrito", transcricao: TEXTO, transcritoDiasAtras: 20, conta: contaB });
    let agoraMs = 0;
    const relogio = () => {
      agoraMs += 31 * 60_000;
      return agoraMs;
    };
    const chamadas: string[] = [];
    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({}, chamadas), pausaEntreVideos: semPausa, relogio });
    expect(chamadas).toEqual([]);
    expect(resumo.setoresParadosPeloOrcamento).toEqual(["longos-job-a"]);
    // a leitura não gasta o orçamento do proxy: o que já estava transcrito é lido
    expect(resumo.leiturasGravadas).toBe(1);
  });

  it("o tráfego do proxy fica no ramo do setor, de forma explícita, sem depender do contexto da execução", async () => {
    await semear({ idExterno: "x1", conta: contaA });
    await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor({}, [], 3_000_000), pausaEntreVideos: semPausa });
    const [linha] = await db().select().from(custosExternos).where(eq(custosExternos.fonte, "proxy"));
    expect(linha.ramoId).toBe(setorA);
  });

  it("não repete: o longo já lido não é lido de novo, e quem espera a nova tentativa não volta antes da data", async () => {
    await semear({ idExterno: "ja-lido", transcricao: TEXTO, transcritoDiasAtras: 3, analiseLongaDiasAtras: 3 });
    const esperando = await semear({ idExterno: "esperando", transcricao: TEXTO, transcritoDiasAtras: 3, foraDaCurva: "9.000", conta: contaB });
    await db()
      .update(videos)
      .set({ proximaTentativaAnaliseLonga: new Date(AGORA.getTime() + 2 * DIA_MS) })
      .where(eq(videos.id, esperando.id));

    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa });
    expect(resumo.leiturasGravadas).toBe(0);
    expect((await db().select().from(geracoesIA)).length).toBe(0);

    // a data vence: volta
    const resumoDepois = await rodarLerLongos(setorA, { agora: new Date(AGORA.getTime() + 3 * DIA_MS), transcrever: transcritor(), pausaEntreVideos: semPausa });
    expect(resumoDepois.leiturasGravadas).toBe(1);
    expect((await porIdExterno("esperando")).analiseLonga).not.toBeNull();
  });

  it("só lê o longo: o curto e o vídeo de outro setor ficam de fora, e com `nichoId` só aquele setor", async () => {
    await semear({ idExterno: "curto", duracaoS: 90, transcricao: TEXTO, transcritoDiasAtras: 3 });
    await semear({ idExterno: "longo-b", setor: setorB, conta: contaC, transcricao: TEXTO, transcritoDiasAtras: 3 });
    await semear({ idExterno: "longo-a", transcricao: TEXTO, transcritoDiasAtras: 3 });

    const resumo = await rodarLerLongos(setorA, { agora: AGORA, transcrever: transcritor(), pausaEntreVideos: semPausa });
    expect(resumo.setores).toBe(1);
    expect((await porIdExterno("longo-a")).analiseLonga).not.toBeNull();
    expect((await porIdExterno("curto")).analiseLonga).toBeNull();
    expect((await porIdExterno("longo-b")).analiseLonga).toBeNull();
  });
});
