/**
 * A E28, os comentários do público, contra o Postgres real e com a resposta GRAVADA da API do YouTube (nenhuma chamada de rede): o
 * job `comentarios-semana` escolhe os vídeos, guarda só o texto limpo, lê com a IA barata (a simulada, `AI_PROVIDER=mock`), conta por
 * código e refaz "as vozes do público" do setor. A fixture tem o formato documentado da API (com o nome, a foto e o endereço de
 * quem escreveu, para provar que nada disso chega ao banco) e comentários inventados: o repositório é público.
 *
 * Cada vídeo recebe a fixture com autores próprios (`fixtureDoVideo`): na vida real dois vídeos têm pessoas diferentes; a mesma
 * pessoa nos dois é um caso à parte (`mesmosAutores`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { comentariosVideo, consumoApi, geracoesIA, nichos, videos } from "@/db/schema";
import { rodarComentariosSemana } from "@/jobs/comentarios-semana";
import { ErroYoutubeApi } from "@/jobs/youtube-api";
import { config, hojeISO } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;

type ThreadDaFixture = { id: string; snippet: { topLevelComment: { id: string; snippet: { authorChannelId: { value: string } } } } };
const lerFixture = () => JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "comentarios", "youtube-comment-threads.json"), "utf8")) as { items: ThreadDaFixture[] };

/**
 * A resposta da API para um vídeo: os mesmos comentários, com os ids de comentário e os autores que só aquele vídeo tem. Com
 * `mesmosAutores`, os autores são os mesmos de outro vídeo (a mesma pessoa colando a mesma frase), para provar o dedupe da rodada.
 */
function fixtureDoVideo(videoId: string, mesmosAutores = false) {
  const base = lerFixture();
  for (const item of base.items) {
    item.id += `-${videoId}`;
    item.snippet.topLevelComment.id += `-${videoId}`;
    if (!mesmosAutores) item.snippet.topLevelComment.snippet.authorChannelId.value += `-${videoId}`;
  }
  return base;
}

let nichoId: number;
let outroNichoId: number;

type Semente = {
  idExterno: string;
  titulo?: string;
  views?: number;
  comentarios?: number;
  diasAtras?: number;
  plataforma?: "youtube" | "instagram";
  pertence?: boolean;
  nicho?: number;
  idioma?: string | null;
  duracaoS?: number;
};

async function semear(s: Semente) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: s.plataforma ?? "youtube",
      idExterno: s.idExterno,
      url: `https://exemplo.invalido/${s.idExterno}`,
      nichoId: s.nicho ?? nichoId,
      titulo: s.titulo ?? `[exemplo] video ${s.idExterno}`,
      views: s.views ?? 100_000,
      comentarios: s.comentarios ?? 120,
      publicadoEm: new Date(Date.now() - (s.diasAtras ?? 2) * DIA_MS),
      idioma: s.idioma === undefined ? "pt" : s.idioma,
      duracaoS: s.duracaoS,
      analise: s.pertence === false ? ({ pertenceAoNicho: false } as never) : undefined,
    })
    .returning();
  return v;
}

type Chamada = { videoId: string; maximo: number };
type OpcoesDaApi = { desligados?: string[]; falhaDeRede?: string[]; cota?: string[]; quebra?: string[]; mesmosAutores?: boolean };
function deps(opcoes: OpcoesDaApi = {}) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    deps: {
      pausaEntreTentativasMs: 0,
      buscarComentarios: async (videoId: string, maximo: number) => {
        chamadas.push({ videoId, maximo });
        if (opcoes.desligados?.includes(videoId)) {
          throw new ErroYoutubeApi('YouTube API respondeu 403: {"error":{"errors":[{"reason":"commentsDisabled"}]}}', 403);
        }
        if (opcoes.cota?.includes(videoId)) {
          throw new ErroYoutubeApi('YouTube API respondeu 403: {"error":{"errors":[{"reason":"quotaExceeded"}]}}', 403);
        }
        if (opcoes.falhaDeRede?.includes(videoId)) {
          throw new ErroYoutubeApi("YouTube API respondeu 503: indisponivel", 503);
        }
        if (opcoes.quebra?.includes(videoId)) {
          return {
            get items(): unknown[] {
              throw new Error("resposta que o normalizador nao consegue ler");
            },
          };
        }
        return fixtureDoVideo(videoId, opcoes.mesmosAutores);
      },
    },
  };
}

async function videoPorIdExterno(idExterno: string) {
  const [v] = await db().select().from(videos).where(and(eq(videos.plataforma, "youtube"), eq(videos.idExterno, idExterno)));
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "comentarios-teste", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  const [outro] = await db().insert(nichos).values({ slug: "comentarios-outro", nome: "Odontologia", termos: ["dentista"], ativo: false }).returning();
  outroNichoId = outro.id;
});

beforeEach(async () => {
  await db().delete(comentariosVideo);
  await db().delete(geracoesIA);
  await db().delete(consumoApi);
  await db().delete(videos);
  await db().update(nichos).set({ vozes: null, vozesEm: null, pisoViews: null, nome: "Produtos de limpeza" }).where(eq(nichos.id, nichoId));
});

afterAll(async () => {
  await getPool().end();
});

describe("rodarComentariosSemana (E28)", () => {
  it("escolhe só o que vale: YouTube, da semana, com comentário de verdade, do setor e acima do piso", async () => {
    await semear({ idExterno: "bom1" });
    await semear({ idExterno: "bom2", views: 90_000, diasAtras: 5 });
    await semear({ idExterno: "poucosComentarios", comentarios: 5 });
    await semear({ idExterno: "velho", diasAtras: 20 });
    await semear({ idExterno: "instagram", plataforma: "instagram" });
    await semear({ idExterno: "foraDoSetor", pertence: false });
    await semear({ idExterno: "outroSetor", nicho: outroNichoId });
    await db().update(nichos).set({ pisoViews: 95_000 }).where(eq(nichos.id, nichoId));
    await semear({ idExterno: "abaixoDoPiso", views: 80_000 });

    const { deps: d, chamadas } = deps();
    const resumo = await rodarComentariosSemana(nichoId, d);

    // com o piso do setor em 95 mil, só "bom1" (100 mil) passa; "bom2" (90 mil) e "abaixoDoPiso" (80 mil) ficam de fora
    expect(chamadas.map((c) => c.videoId)).toEqual(["bom1"]);
    expect(resumo).toMatchObject({ nichos: 1, lidos: 1 });

    await db().update(nichos).set({ pisoViews: null }).where(eq(nichos.id, nichoId));
    const segunda = deps();
    await rodarComentariosSemana(nichoId, segunda.deps);
    // agora o piso é o padrão do teste (0): entram os outros dois da semana, do mais visto para o menos, e "bom1" não volta
    expect(segunda.chamadas.map((c) => c.videoId)).toEqual(["bom2", "abaixoDoPiso"]);
    expect(segunda.chamadas.every((c) => c.maximo === 100)).toBe(true);
  });

  it("só vídeo brasileiro e dentro do teto de duração: o público de fora ou o do vídeo longo não é o do dono", async () => {
    await semear({ idExterno: "brasileiro" });
    await semear({ idExterno: "ingles", idioma: "en" });
    await semear({ idExterno: "espanhol", idioma: "es" });
    await semear({ idExterno: "semIdiomaDeConta", idioma: null });
    await semear({ idExterno: "longo", duracaoS: 600 });
    await semear({ idExterno: "curto", duracaoS: 45 });

    const { deps: d, chamadas } = deps();
    await rodarComentariosSemana(nichoId, d);
    // sem idioma e sem conta brasileira conta como de fora; o longo (acima do teto das referências) também sai
    expect(chamadas.map((c) => c.videoId).sort()).toEqual(["brasileiro", "curto"]);
  });

  it("guarda só o texto limpo, as curtidas e a data: nenhum nome, nenhuma foto, nenhum endereço, nenhum @", async () => {
    const v = await semear({ idExterno: "bom1" });
    await rodarComentariosSemana(nichoId, deps().deps);

    const colunas = await db().execute(sql`select column_name from information_schema.columns where table_name = 'comentarios_video' order by column_name`);
    expect(colunas.rows.map((r) => (r as { column_name: string }).column_name)).toEqual(["coletado_em", "curtidas", "id", "id_externo", "publicado_em", "texto", "video_id"]);

    const linhas = await db().select().from(comentariosVideo).where(eq(comentariosVideo.videoId, v.id));
    expect(linhas.length).toBeGreaterThan(10);
    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toContain("Autor de teste");
    expect(tudo).not.toContain("UCautor");
    expect(tudo).not.toContain("exemplo.invalido/foto");
    for (const l of linhas) {
      expect(l.texto).not.toContain("@");
      expect(l.texto).not.toMatch(/https?:|www\./);
    }
    // o teste do plano: nenhum "@" em nenhum texto guardado
    const comArroba = await db().execute(sql`select count(*)::int as n from comentarios_video where texto like '%@%'`);
    expect((comArroba.rows[0] as { n: number }).n).toBe(0);
  });

  it("lê o vídeo: a contagem é do código, e o texto do item é a nossa frase", async () => {
    await semear({ idExterno: "bom1" });
    await rodarComentariosSemana(nichoId, deps().deps);
    const v = await videoPorIdExterno("bom1");

    expect(v.comentariosColetadosEm).not.toBeNull();
    const analise = v.comentariosAnalise!;
    expect(analise.lidos).toBeGreaterThan(10);
    // cinco pessoas diferentes (a que colou três vezes conta uma): a pergunta mais repetida tem 5
    expect(analise.duvidas[0]).toEqual({ texto: "Serve em tecido de camurça?", vezes: 5 });
    // os três comentários de objeção (dois iguais e um sobre preço) viram um item só: o mesmo texto soma
    expect(analise.objecoes).toEqual([{ texto: "Não funcionou ou ficou caro para mim.", vezes: 3 }]);
    expect(analise.pedidos).toEqual([{ texto: "Pediram para mostrar o passo a passo.", vezes: 2 }]);
    expect(analise.sentimento).toBe("dividido");
    // nenhuma frase literal traz @ nem endereço
    for (const f of analise.frasesDoPublico) expect(f).not.toMatch(/@|https?:|www\./);
  });

  it("refaz as vozes do setor: soma as vezes dos vídeos, diz de que plataforma vieram e quantos entraram", async () => {
    const a = await semear({ idExterno: "bom1" });
    const b = await semear({ idExterno: "bom2", views: 90_000 });
    const quando = new Date("2026-10-11T07:45:00Z");
    await rodarComentariosSemana(nichoId, { ...deps().deps, agora: quando });

    const [nicho] = await db().select({ vozes: nichos.vozes, vozesEm: nichos.vozesEm }).from(nichos).where(eq(nichos.id, nichoId));
    expect(nicho.vozesEm?.toISOString()).toBe(quando.toISOString());
    const vozes = nicho.vozes!;
    expect(vozes.videos).toBe(2);
    expect(vozes.duvidas[0]).toEqual({ texto: "Serve em tecido de camurça?", vezes: 10, videos: [a.id, b.id].sort((x, y) => x - y), plataformas: ["youtube"] });
    expect(vozes.plataformas).toEqual(["youtube"]);
    expect(vozes.objecoes[0].vezes).toBe(6);
    expect(vozes.pedidos[0].vezes).toBe(4);
    expect(vozes.comentarios).toBeGreaterThan(20);
  });

  it("a mesma pessoa colando o mesmo texto em outro vídeo da rodada não conta de novo", async () => {
    await semear({ idExterno: "bom1" });
    await semear({ idExterno: "bom2", views: 90_000 });
    const resumo = await rodarComentariosSemana(nichoId, deps({ mesmosAutores: true }).deps);
    // o segundo vídeo só tem comentário repetido dos mesmos autores: não sobra o que ler
    expect(resumo).toMatchObject({ lidos: 1, poucos: 1 });
    const [nicho] = await db().select({ vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, nichoId));
    expect(nicho.vozes!.duvidas[0].vezes).toBe(5);
    expect(nicho.vozes!.videos).toBe(1);
  });

  it("registra a cota (uma unidade por vídeo) e as duas chamadas de IA por vídeo e por setor", async () => {
    await semear({ idExterno: "bom1" });
    await semear({ idExterno: "bom2", views: 90_000 });
    await rodarComentariosSemana(nichoId, deps().deps);

    const [consumo] = await db().select().from(consumoApi).where(and(eq(consumoApi.fonte, "youtube"), eq(consumoApi.data, hojeISO())));
    expect(consumo.unidades).toBe(2);

    const geracoes = await db().select({ tarefa: geracoesIA.tarefa }).from(geracoesIA);
    expect(geracoes.filter((g) => g.tarefa === "lerComentarios")).toHaveLength(2);
    expect(geracoes.filter((g) => g.tarefa === "juntarVozes")).toHaveLength(1);
  });

  it("não lê o mesmo vídeo duas vezes: a segunda rodada não chama a API", async () => {
    await semear({ idExterno: "bom1" });
    await rodarComentariosSemana(nichoId, deps().deps);
    const segunda = deps();
    const resumo = await rodarComentariosSemana(nichoId, segunda.deps);
    expect(segunda.chamadas).toEqual([]);
    expect(resumo).toMatchObject({ lidos: 0 });
  });

  it("comentários desligados: o vídeo é marcado e não volta, sem erro", async () => {
    await semear({ idExterno: "desligado" });
    await semear({ idExterno: "bom1" });
    const primeira = deps({ desligados: ["desligado"] });
    const resumo = await rodarComentariosSemana(nichoId, primeira.deps);
    expect(resumo).toMatchObject({ lidos: 1, desligados: 1, falhas: 0 });

    const v = await videoPorIdExterno("desligado");
    expect(v.comentariosColetadosEm).not.toBeNull();
    expect(v.comentariosAnalise).toBeNull();

    const segunda = deps({ desligados: ["desligado"] });
    await rodarComentariosSemana(nichoId, segunda.deps);
    expect(segunda.chamadas).toEqual([]);
  });

  it("falha de rede: uma segunda tentativa na rodada, depois o vídeo não é marcado e os outros seguem", async () => {
    await semear({ idExterno: "fora" });
    await semear({ idExterno: "bom1", views: 90_000 });
    const { deps: d, chamadas } = deps({ falhaDeRede: ["fora"] });
    const resumo = await rodarComentariosSemana(nichoId, d);
    expect(resumo).toMatchObject({ lidos: 1, falhas: 1 });
    expect(chamadas.filter((c) => c.videoId === "fora")).toHaveLength(2);
    expect((await videoPorIdExterno("fora")).comentariosColetadosEm).toBeNull();
    expect((await videoPorIdExterno("bom1")).comentariosColetadosEm).not.toBeNull();
    // as duas tentativas e a leitura do outro vídeo gastaram cota: três unidades
    const [consumo] = await db().select().from(consumoApi).where(eq(consumoApi.fonte, "youtube"));
    expect(consumo.unidades).toBe(3);
  });

  it("um vídeo que quebra por dentro não derruba os outros setores nem os outros vídeos", async () => {
    await semear({ idExterno: "quebra" });
    await semear({ idExterno: "bom1", views: 90_000 });
    const resumo = await rodarComentariosSemana(nichoId, deps({ quebra: ["quebra"] }).deps);
    expect(resumo).toMatchObject({ lidos: 1, falhas: 1 });
    expect((await videoPorIdExterno("quebra")).comentariosColetadosEm).toBeNull();
    expect((await videoPorIdExterno("bom1")).comentariosAnalise).not.toBeNull();
  });

  it("a IA fora na leitura: os comentários ficam guardados, o vídeo não é marcado e volta num 'rodar agora'", async () => {
    await semear({ idExterno: "ia", titulo: "[mock:ler-fora] video" });
    const resumo = await rodarComentariosSemana(nichoId, deps().deps);
    expect(resumo).toMatchObject({ lidos: 0, falhas: 1 });
    const v = await videoPorIdExterno("ia");
    expect(v.comentariosColetadosEm).toBeNull();
    expect(v.comentariosAnalise).toBeNull();
    const linhas = await db().select().from(comentariosVideo).where(eq(comentariosVideo.videoId, v.id));
    expect(linhas.length).toBeGreaterThan(10);

    // a segunda leitura não duplica os comentários
    await db().update(videos).set({ titulo: "video normal" }).where(eq(videos.id, v.id));
    await rodarComentariosSemana(nichoId, deps().deps);
    const depois = await db().select().from(comentariosVideo).where(eq(comentariosVideo.videoId, v.id));
    expect(depois).toHaveLength(linhas.length);
    expect((await videoPorIdExterno("ia")).comentariosAnalise).not.toBeNull();
  });

  it("a IA fora na junção: as vozes saem do que está escrito igual, e a rodada não cai", async () => {
    await db().update(nichos).set({ nome: "Produtos de limpeza [mock:juntar-fora]" }).where(eq(nichos.id, nichoId));
    await semear({ idExterno: "bom1" });
    await semear({ idExterno: "bom2", views: 90_000 });
    const resumo = await rodarComentariosSemana(nichoId, deps().deps);
    expect(resumo).toMatchObject({ lidos: 2, falhas: 0 });
    const [nicho] = await db().select({ vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, nichoId));
    // sem o modelo, "serve em tecido de camurça?" escrito igual nos dois vídeos ainda soma
    expect(nicho.vozes!.duvidas[0]).toMatchObject({ texto: "Serve em tecido de camurça?", vezes: 10 });
    // e prova que o marcador disparou: a chamada da junção falhou, então nenhuma foi registrada
    const geracoes = await db().select({ tarefa: geracoesIA.tarefa }).from(geracoesIA);
    expect(geracoes.filter((g) => g.tarefa === "juntarVozes")).toHaveLength(0);
  });

  it("a cota do dia no limite: não gasta, avisa, e o vídeo fica para a próxima", async () => {
    await semear({ idExterno: "bom1" });
    await db().insert(consumoApi).values({ fonte: "youtube", data: hojeISO(), unidades: 9_300 });
    const { deps: d, chamadas } = deps();
    const resumo = await rodarComentariosSemana(nichoId, d);
    expect(chamadas).toEqual([]);
    expect(resumo.avisos).toEqual(["a cota do YouTube de hoje acabou: o resto fica para a próxima rodada"]);
    expect((await videoPorIdExterno("bom1")).comentariosColetadosEm).toBeNull();
  });

  it("a cota acaba no meio da rodada: lê o que cabe, para, e não marca o resto", async () => {
    await semear({ idExterno: "primeiro", views: 300_000 });
    await semear({ idExterno: "segundo", views: 200_000 });
    await semear({ idExterno: "terceiro", views: 100_000 });
    // sobra uma unidade: a do primeiro
    await db().insert(consumoApi).values({ fonte: "youtube", data: hojeISO(), unidades: 9_299 });
    const { deps: d, chamadas } = deps();
    const resumo = await rodarComentariosSemana(nichoId, d);
    expect(chamadas.map((c) => c.videoId)).toEqual(["primeiro"]);
    expect(resumo).toMatchObject({ lidos: 1 });
    expect(resumo.avisos).toHaveLength(1);
    expect((await videoPorIdExterno("primeiro")).comentariosColetadosEm).not.toBeNull();
    expect((await videoPorIdExterno("segundo")).comentariosColetadosEm).toBeNull();
    expect((await videoPorIdExterno("terceiro")).comentariosColetadosEm).toBeNull();
  });

  it("a API respondendo que a cota acabou também para o setor, sem marcar o vídeo", async () => {
    await semear({ idExterno: "sem-cota" });
    await semear({ idExterno: "bom1", views: 90_000 });
    const { deps: d, chamadas } = deps({ cota: ["sem-cota"] });
    const resumo = await rodarComentariosSemana(nichoId, d);
    expect(chamadas.map((c) => c.videoId)).toEqual(["sem-cota"]);
    expect(resumo.avisos).toHaveLength(1);
    expect((await videoPorIdExterno("sem-cota")).comentariosColetadosEm).toBeNull();
    expect((await videoPorIdExterno("bom1")).comentariosColetadosEm).toBeNull();
  });

  it("sem nenhuma leitura nova, as vozes que já existiam ficam como estão", async () => {
    await db()
      .update(nichos)
      .set({
        vozes: { duvidas: [{ texto: "Pergunta de antes", vezes: 7, videos: [1], plataformas: ["youtube"] }], objecoes: [], pedidos: [], videos: 1, comentarios: 50, plataformas: ["youtube"] },
        vozesEm: new Date("2026-10-01T00:00:00Z"),
      })
      .where(eq(nichos.id, nichoId));
    await rodarComentariosSemana(nichoId, deps().deps);
    const [nicho] = await db().select({ vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, nichoId));
    expect(nicho.vozes!.duvidas[0].texto).toBe("Pergunta de antes");
  });

  it("só as leituras da semana entram nas vozes: a de dez dias atrás não conta", async () => {
    const velho = await semear({ idExterno: "lidoHaDezDias", diasAtras: 12 });
    await db()
      .update(videos)
      .set({
        comentariosAnalise: { duvidas: [{ texto: "Pergunta antiga do público", vezes: 9 }], objecoes: [], pedidos: [], oQueElogiaram: [], frasesDoPublico: [], sentimento: "dividido", lidos: 40 },
        comentariosColetadosEm: new Date(Date.now() - 10 * DIA_MS),
      })
      .where(eq(videos.id, velho.id));
    await rodarComentariosSemana(nichoId, deps().deps);
    const [nicho] = await db().select({ vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, nichoId));
    expect(nicho.vozes).toBeNull();
  });

  it("a borda da janela das vozes: a leitura de cinco dias entra, a de seis dias e meio (a rodada passada) não", async () => {
    const analiseDe = (texto: string) => ({ duvidas: [{ texto, vezes: 6 }], objecoes: [], pedidos: [], oQueElogiaram: [], frasesDoPublico: [], sentimento: "dividido" as const, lidos: 40 });
    const recente = await semear({ idExterno: "lidoHaCincoDias", diasAtras: 5 });
    const passado = await semear({ idExterno: "lidoNaRodadaPassada", diasAtras: 9 });
    await db()
      .update(videos)
      .set({ comentariosAnalise: analiseDe("Pergunta desta semana do público"), comentariosColetadosEm: new Date(Date.now() - 5 * DIA_MS) })
      .where(eq(videos.id, recente.id));
    await db()
      .update(videos)
      .set({ comentariosAnalise: analiseDe("Pergunta da semana passada do público"), comentariosColetadosEm: new Date(Date.now() - 6.5 * DIA_MS) })
      .where(eq(videos.id, passado.id));
    await rodarComentariosSemana(nichoId, deps().deps);
    const [nicho] = await db().select({ vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, nichoId));
    expect(nicho.vozes!.duvidas.map((d) => d.texto)).toEqual(["Pergunta desta semana do público"]);
    expect(nicho.vozes!.videos).toBe(1);
  });

  it("sem a chave do YouTube e sem resposta gravada, o job só avisa e não faz nada", async () => {
    await semear({ idExterno: "bom1" });
    // o `.env` de quem roda o teste pode ter a chave de verdade: o teste não depende dela, nem chama a API
    const chaveDeQuemRoda = config.coleta.youtubeKey;
    (config.coleta as { youtubeKey: string }).youtubeKey = "";
    try {
      const resumo = await rodarComentariosSemana(nichoId);
      expect(resumo).toEqual({ semChaveDoYoutube: true });
    } finally {
      (config.coleta as { youtubeKey: string }).youtubeKey = chaveDeQuemRoda;
    }
    expect((await videoPorIdExterno("bom1")).comentariosColetadosEm).toBeNull();
  });

  it("vale também para todos os setores ativos, sem número", async () => {
    await semear({ idExterno: "bom1" });
    await semear({ idExterno: "doOutro", nicho: outroNichoId });
    const { deps: d, chamadas } = deps();
    await rodarComentariosSemana(undefined, d);
    // o outro setor está desligado (ativo: false): só o primeiro é lido
    expect(chamadas.map((c) => c.videoId)).toEqual(["bom1"]);
  });
});
