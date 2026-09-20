/**
 * `rodarTemasDoDia` (etapa 10): ciclo completo contra o Postgres real.
 * `AI_PROVIDER=mock` (`vitest.config.mts`) faz `gerarEstruturado` cair no
 * mock de `temasDoDia` e `filtrarNoticias`, sem chamar a Anthropic de
 * verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, geracoesIA, nichos, noticias, temasDia, videos } from "@/db/schema";
import { rodarTemasDoDia } from "@/jobs/temas-do-dia";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;
/**
 * V2b, item 8: a prova exige pelo menos duas contas diferentes; a maioria
 * dos testes deste arquivo usa estas duas (idioma "pt", brasileiras) mais
 * uma terceira quando o cenário pede.
 */
let contaAId: number;
let contaBId: number;
let contaCId: number;

async function criarVideo(
  idExterno: string,
  opcoes: {
    velocidadeRelativa: number;
    assunto: string;
    contaId?: number;
    idioma?: string | null;
    publicadoEm?: Date;
  },
) {
  await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      contaId: opcoes.contaId ?? contaAId,
      titulo: `[exemplo] ${idExterno}`,
      views: 100,
      publicadoEm: opcoes.publicadoEm ?? diasAtras(3),
      velocidadeRelativa: String(opcoes.velocidadeRelativa),
      // V2b, item 8: "pt" por padrao, para os testes que nao sao sobre a prova nao serem afetados por ela.
      idioma: opcoes.idioma === undefined ? "pt" : opcoes.idioma,
      analise: {
        assunto: opcoes.assunto,
        gancho: "x",
        estrutura: "x",
        fechamento: "x",
        chamadaFinal: "x",
        formato: "fala_para_camera",
        porQueFuncionou: "x",
      } as never,
    });
}

/** Cria `quantidade` vídeos com o mesmo assunto, alternando entre `contaAId` e `contaBId`, para satisfazer a prova (3+ vídeos, 2+ contas, maioria "pt"). */
async function criarVideosComProva(assunto: string, quantidade = 3, prefixo = assunto) {
  const contasAlternadas = [contaAId, contaBId];
  for (let i = 0; i < quantidade; i += 1) {
    await criarVideo(`${prefixo}-prova-${i}`, {
      velocidadeRelativa: 5 + i,
      assunto,
      contaId: contasAlternadas[i % contasAlternadas.length],
    });
  }
}

async function criarVideoSemDono(idExterno: string, opcoes: { assunto: string; publicadoEm?: Date; idioma?: string | null }) {
  await db()
    .insert(videos)
    .values({
      plataforma: "instagram",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      semDono: true,
      origem: "meta",
      titulo: `[exemplo] ${idExterno}`,
      views: 0,
      publicadoEm: opcoes.publicadoEm ?? diasAtras(3),
      idioma: opcoes.idioma === undefined ? "pt" : opcoes.idioma,
      analise: {
        assunto: opcoes.assunto,
        gancho: "x",
        estrutura: "x",
        fechamento: "x",
        chamadaFinal: "x",
        formato: "fala_para_camera",
        porQueFuncionou: "x",
      } as never,
    });
}

async function criarNoticia(url: string, opcoes: { titulo: string; resumo?: string; coletadoEm?: Date }) {
  await db()
    .insert(noticias)
    .values({
      nichoId,
      url,
      titulo: opcoes.titulo,
      resumo: opcoes.resumo,
      coletadoEm: opcoes.coletadoEm ?? new Date(),
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({
      slug: "temas-do-dia-teste",
      nome: "Temas do dia teste",
      termos: [],
      // V2b, item 8: mais de 7 dias de base, para a janela padrao (7 dias) valer
      // na maioria dos testes deste arquivo; o teste da janela de 14 dias usa
      // um nicho proprio, criado agora.
      criadoEm: diasAtras(30),
    })
    .returning();
  nichoId = nicho.id;

  const contasCriadas = await db()
    .insert(contas)
    .values([
      { plataforma: "youtube", handle: "temas-conta-a", nichoId },
      { plataforma: "youtube", handle: "temas-conta-b", nichoId },
      { plataforma: "youtube", handle: "temas-conta-c", nichoId },
    ])
    .returning({ id: contas.id });
  [contaAId, contaBId, contaCId] = contasCriadas.map((c) => c.id);
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(noticias).where(eq(noticias.nichoId, nichoId));
  await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
  await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
});

describe("rodarTemasDoDia", () => {
  it("com prova suficiente (3 videos, 2 contas), gera tres temas com evidencia e grava em temas_dia", async () => {
    await criarVideosComProva("erro comum ao lavar sofa");

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(1);
    expect(resumo.semEvidencia).toBe(0);
    expect(resumo.semProva).toBe(0);
    expect(resumo.falhas).toBe(0);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas).toHaveLength(3);
    for (const tema of linha.temas) {
      expect(tema.evidencias.length).toBeGreaterThan(0);
    }
  });

  it("video sem dono (hashtag search da meta) com analise aparece entre as evidencias do tema (achado da leitura previa, correcao 3)", async () => {
    // V2b, item 8: video sem dono nunca conta para "2 contas diferentes"; misturado
    // com 2 videos de contas distintas, o conjunto ainda tem prova (3 videos, 2 contas).
    await criarVideoSemDono("video-sem-dono-1", { assunto: "assunto em alta na hashtag" });
    await criarVideo("video-com-dono-a", { velocidadeRelativa: 5, assunto: "assunto em alta na hashtag", contaId: contaAId });
    await criarVideo("video-com-dono-b", { velocidadeRelativa: 5, assunto: "assunto em alta na hashtag", contaId: contaBId });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(1);
    expect(resumo.semEvidencia).toBe(0);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    const [videoSemDono] = await db().select().from(videos).where(eq(videos.idExterno, "video-sem-dono-1"));
    const todasEvidencias = linha.temas.flatMap((tema) => tema.evidencias);
    expect(todasEvidencias).toContain(videoSemDono.id);
  });

  it("sem video subindo e sem noticia, nao gera tema e o resumo diz sem evidencia", async () => {
    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.semEvidencia).toBe(1);
    expect(resumo.falhas).toBe(0);

    const linhas = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhas).toHaveLength(0);
  });

  it("filtra e grava relevante/angulo nas noticias das ultimas 24h, ignorando a de mais de 24h", async () => {
    await criarVideosComProva("assunto qualquer");
    await criarNoticia("https://exemplo.invalido/noticia-recente", {
      titulo: "noticia de hoje sobre o nicho",
      resumo: "resumo da noticia",
    });
    await criarNoticia("https://exemplo.invalido/noticia-velha", {
      titulo: "noticia de mais de um dia atras",
      coletadoEm: new Date(Date.now() - 2 * DIA_MS),
    });

    await rodarTemasDoDia();

    const [recente] = await db()
      .select()
      .from(noticias)
      .where(eq(noticias.url, "https://exemplo.invalido/noticia-recente"));
    expect(recente.relevante).not.toBeNull();

    const [velha] = await db().select().from(noticias).where(eq(noticias.url, "https://exemplo.invalido/noticia-velha"));
    expect(velha.relevante).toBeNull();
  });

  /**
   * V2b, item 8: a prova exige video analisado, notícia nunca conta. Antes
   * desta regra este cenario (so noticia, sem nenhum video) gerava tres
   * temas com evidenciasNoticias; agora e sempre descartado por falta de
   * prova, mesmo com a evidencia (de noticia) validada por evidenciaValida.
   */
  it("nicho com noticia relevante e nenhum video com analise: tema sem prova, descartado", async () => {
    await criarNoticia("https://exemplo.invalido/noticia-so", {
      titulo: "noticia relevante do nicho",
      resumo: "resumo da noticia relevante",
    });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.semProva).toBe(1);
    expect(resumo.temasSemProva).toBe(3);
    expect(resumo.falhas).toBe(0);

    const linhas = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhas).toHaveLength(0);
  });

  it("resposta com id de evidencia inventado nas duas tentativas registra duas geracoes reprovadas e falhas: 1", async () => {
    await criarVideo("video-evidencia-inventada", {
      velocidadeRelativa: 5,
      assunto: "invente um id de evidencia que nao existe",
    });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.falhas).toBe(1);
    expect((resumo.erros as string[] | undefined)?.[0]).toContain(
      "sem evidencia valida depois de refazer a chamada uma vez",
    );

    const linhas = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhas).toHaveLength(0);

    const geracoes = await db()
      .select()
      .from(geracoesIA)
      .where(eq(geracoesIA.tarefa, "temasDoDia"));
    expect(geracoes).toHaveLength(2);
    for (const geracao of geracoes) {
      expect((geracao.entradas as { evidenciaValida?: boolean }).evidenciaValida).toBe(false);
    }
  });

  it("rodar de novo no mesmo dia substitui os temas gravados (upsert)", async () => {
    await criarVideosComProva("assunto original");
    await rodarTemasDoDia();

    const antes = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(antes).toHaveLength(1);

    await rodarTemasDoDia();

    const depois = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(depois).toHaveLength(1);
  });

  /** V2b, item 8: menos de 3 videos na janela, mesmo de contas diferentes, nunca tem prova. */
  it("menos de 3 videos: tema sem prova, descartado", async () => {
    await criarVideo("prova-poucos-1", { velocidadeRelativa: 5, assunto: "assunto com poucos videos", contaId: contaAId });
    await criarVideo("prova-poucos-2", { velocidadeRelativa: 5, assunto: "assunto com poucos videos", contaId: contaBId });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.semProva).toBe(1);

    const linhas = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhas).toHaveLength(0);
  });

  /** V2b, item 8: 3+ videos, mas todos da mesma conta, nunca tem prova (exige 2+ contas). */
  it("3 videos da mesma conta: tema sem prova, descartado", async () => {
    for (let i = 0; i < 3; i += 1) {
      await criarVideo(`prova-mesma-conta-${i}`, {
        velocidadeRelativa: 5 + i,
        assunto: "assunto com uma conta so",
        contaId: contaAId,
      });
    }

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.semProva).toBe(1);
  });

  /** V2b, item 8: maioria internacional (2 de 3), mesmo com 3 videos de 2 contas, nunca tem prova. */
  it("maioria internacional entre os videos citados: tema sem prova, descartado", async () => {
    await criarVideo("prova-maioria-en-1", { velocidadeRelativa: 5, assunto: "assunto internacional", contaId: contaAId, idioma: "en" });
    await criarVideo("prova-maioria-en-2", { velocidadeRelativa: 5, assunto: "assunto internacional", contaId: contaBId, idioma: "en" });
    await criarVideo("prova-maioria-en-3", { velocidadeRelativa: 5, assunto: "assunto internacional", contaId: contaCId, idioma: "pt" });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(0);
    expect(resumo.semProva).toBe(1);
  });

  /** V2b, item 8: maioria brasileira (2 de 3) basta, mesmo com um internacional no meio. */
  it("maioria brasileira (2 de 3) e suficiente, mesmo com um internacional citado junto", async () => {
    await criarVideo("prova-maioria-pt-1", { velocidadeRelativa: 5, assunto: "assunto com maioria br", contaId: contaAId, idioma: "pt" });
    await criarVideo("prova-maioria-pt-2", { velocidadeRelativa: 5, assunto: "assunto com maioria br", contaId: contaBId, idioma: "pt" });
    await criarVideo("prova-maioria-pt-3", { velocidadeRelativa: 5, assunto: "assunto com maioria br", contaId: contaCId, idioma: "en" });

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(1);
    expect(resumo.semProva).toBe(0);
  });

  /**
   * V2b, item 8: a janela de 14 dias em nicho novo é testada só
   * unitariamente (`temaTemProvaSuficiente`, `src/jobs/temas-do-dia.test.ts`),
   * não aqui: `subindoHojeComAnalise` e `semDonoComAnalise` (as duas únicas
   * fontes de evidência que alimentam o prompt) já limitam a janela delas a
   * 7 dias, então nenhum vídeo de mais de 7 dias chega a ser oferecido como
   * evidência ao modelo hoje; um teste de integração de ponta a ponta não
   * conseguiria diferenciar janela de 7 de janela de 14 sem também mudar
   * essas duas consultas, fora do escopo deste item.
   */
});
