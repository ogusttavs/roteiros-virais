/**
 * `rodarTemasDoDia` (etapa 10): ciclo completo contra o Postgres real.
 * `AI_PROVIDER=mock` (`vitest.config.mts`) faz `gerarEstruturado` cair no
 * mock de `temasDoDia` e `filtrarNoticias`, sem chamar a Anthropic de
 * verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contas, geracoesIA, nichos, noticias, roteiros, temasDia, user, videos } from "@/db/schema";
import { podeSobrescreverTemasDoDia, rodarTemasDoDia } from "@/jobs/temas-do-dia";
import { hojeISO } from "@/lib/config";

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

    // M5b, item 3: a tentativa sem prova fica marcada (temas vazio, a contagem de vídeos daquela
    // hora), para a próxima rodada saber se chegou vídeo novo antes de chamar o modelo de novo.
    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas).toEqual([]);
    expect(linha.candidatosNaUltimaTentativa).toBe(0);
  });

  it("resposta com id de evidencia inventado nas duas tentativas registra duas geracoes reprovadas e falhas: 1", async () => {
    await criarVideo("video-evidencia-inventada", {
      velocidadeRelativa: 5,
      assunto: "invente um id de evidencia que não existe",
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

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas).toEqual([]);
    expect(linha.candidatosNaUltimaTentativa).toBe(2);
  });

  /**
   * M5b, item 3, resto do achado 9: rodar de novo no mesmo dia sem vídeo novo não chama o modelo
   * outra vez (fica "sem_novidade", sem nova linha em `geracoesIA`); com vídeo novo, tenta de novo
   * de verdade (chama o modelo, atualiza `candidatosNaUltimaTentativa`).
   */
  it("sem video novo desde a ultima tentativa sem prova, nao chama o modelo de novo; com video novo, tenta de novo", async () => {
    await criarVideo("sem-novidade-1", { velocidadeRelativa: 5, assunto: "assunto sem novidade", contaId: contaAId });
    await criarVideo("sem-novidade-2", { velocidadeRelativa: 5, assunto: "assunto sem novidade", contaId: contaBId });

    const primeira = await rodarTemasDoDia();
    expect(primeira.semProva).toBe(1);
    const geracoesAposPrimeira = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
    expect(geracoesAposPrimeira.length).toBeGreaterThan(0);

    // De novo, sem vídeo novo: sem_novidade, nenhuma chamada nova ao modelo.
    const segunda = await rodarTemasDoDia();
    expect(segunda.semProva).toBe(0);
    expect(segunda.semNovidade).toBe(1);
    const geracoesAposSegunda = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
    expect(geracoesAposSegunda).toHaveLength(geracoesAposPrimeira.length);

    const [linhaAntes] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linhaAntes.candidatosNaUltimaTentativa).toBe(2);

    // Chega vídeo novo (terceira conta, completa a prova): a terceira rodada tenta de novo.
    await criarVideo("sem-novidade-3", { velocidadeRelativa: 5, assunto: "assunto sem novidade", contaId: contaCId });
    const terceira = await rodarTemasDoDia();
    expect(terceira.semNovidade).toBe(0);
    const geracoesAposTerceira = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
    expect(geracoesAposTerceira.length).toBeGreaterThan(geracoesAposSegunda.length);
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
   * Hotfix de 02/10/2026 (achado de produção): o setor com a régua de Brasil em 30% (a Overtake)
   * fechou o dia sem tema porque a prova exigia maioria brasileira, mais dura que a régua que o
   * Gustavo definiu para ele. Com a régua do setor, 1 brasileiro em 3 tem prova.
   */
  it("setor com a regua de Brasil em 30%: 1 brasileiro em 3 basta para o tema nascer", async () => {
    await db().update(nichos).set({ proporcaoBrasil: "0.3" }).where(eq(nichos.id, nichoId));
    await criarVideo("prova-regua-en-1", { velocidadeRelativa: 5, assunto: "assunto de setor de fora", contaId: contaAId, idioma: "en" });
    await criarVideo("prova-regua-en-2", { velocidadeRelativa: 5, assunto: "assunto de setor de fora", contaId: contaBId, idioma: "en" });
    await criarVideo("prova-regua-pt-3", { velocidadeRelativa: 5, assunto: "assunto de setor de fora", contaId: contaCId, idioma: "pt" });

    try {
      const resumo = await rodarTemasDoDia();
      expect(resumo.gerados).toBe(1);
      expect(resumo.semProva).toBe(0);
    } finally {
      await db().update(nichos).set({ proporcaoBrasil: null }).where(eq(nichos.id, nichoId));
    }
  });

  /**
   * Hotfix de 02/10/2026: o gerador recebe a origem e a conta de cada vídeo e a regra da prova, e
   * tema barrado ganha uma segunda tentativa com o motivo. Aqui o mock cita sempre todos os ids,
   * então a segunda tentativa repete o resultado: o que se prova é que ela acontece (duas gerações
   * registradas), leva o motivo na entrada, e que o setor continua sem tema inventado.
   */
  it("tema barrado na prova: refaz uma vez com o motivo, e as duas geracoes ficam registradas", async () => {
    await criarVideo("prova-refaz-en-1", { velocidadeRelativa: 5, assunto: "assunto que sera refeito", contaId: contaAId, idioma: "en" });
    await criarVideo("prova-refaz-en-2", { velocidadeRelativa: 5, assunto: "assunto que sera refeito", contaId: contaBId, idioma: "en" });
    await criarVideo("prova-refaz-pt-3", { velocidadeRelativa: 5, assunto: "assunto que sera refeito", contaId: contaCId, idioma: "pt" });

    const antes = await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));
    const resumo = await rodarTemasDoDia();
    const depois = await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.tarefa, "temasDoDia"));

    expect(resumo.gerados).toBe(0);
    expect(resumo.semProva).toBe(1);
    expect(depois.length - antes.length).toBe(2);
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

/**
 * M1, item 2: os temas nascem quando a análise chega, não só às 06:30. `extrairColeta` e
 * `extrairAgora` enfileiram `temasDoDia` com `nichoId` depois de analisar vídeo novo; o job
 * confere sozinho se o setor já tem tema hoje e nunca regenera o de quem já escolheu.
 */
describe("rodarTemasDoDia com nichoId (M1, item 2)", () => {
  it("setor que ja tem tema hoje: pula, nao chama a IA de novo", async () => {
    await db()
      .insert(temasDia)
      .values({
        nichoId,
        data: hojeISO(),
        temas: [{ titulo: "tema de ontem", descricao: "x", porQue: "x", evidencias: [], puxaPara: "conversao" }],
      });
    await criarVideosComProva("assunto que chegou depois do tema de hoje");

    const resumo = await rodarTemasDoDia(nichoId);
    expect(resumo.jaTinhaTemaHoje).toBe(true);
    expect(resumo.gerados).toBe(0);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas[0]?.titulo).toBe("tema de ontem");
  });

  /**
   * R1, item 0: `opts.forcar` ("npm run job -- temas-do-dia <nichoId> --refazer") pula o "já tem
   * hoje, não regenera"; a segurança de não piorar (`podeSobrescreverTemasDoDia`) continua valendo
   * na escrita, então com evidência boa (3+ temas) a sobrescrita acontece normalmente.
   */
  it("com forcar, refaz mesmo que o setor ja tenha tema hoje", async () => {
    await db()
      .insert(temasDia)
      .values({
        nichoId,
        data: hojeISO(),
        temas: [{ titulo: "tema de antes do refazer", descricao: "x", porQue: "x", evidencias: [], puxaPara: "conversao" }],
      });
    await criarVideosComProva("assunto que chegou depois, pedindo refazer");

    const resumo = await rodarTemasDoDia(nichoId, { forcar: true });
    expect(resumo.jaTinhaTemaHoje).toBeUndefined();
    expect(resumo.gerados).toBe(1);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas[0]?.titulo).not.toBe("tema de antes do refazer");
  });

  it("setor sem tema hoje, com nichoId: gera so para aquele setor", async () => {
    await criarVideosComProva("assunto do setor unico");

    const resumo = await rodarTemasDoDia(nichoId);
    expect(resumo.nichos).toBe(1);
    expect(resumo.gerados).toBe(1);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas.length).toBeGreaterThan(0);
  });

  it("sem nichoId, continua substituindo o tema de quem ja tem (comportamento de sempre)", async () => {
    await db()
      .insert(temasDia)
      .values({
        nichoId,
        data: hojeISO(),
        temas: [{ titulo: "tema velho", descricao: "x", porQue: "x", evidencias: [], puxaPara: "conversao" }],
      });
    await criarVideosComProva("assunto novo que substitui o tema velho");

    const resumo = await rodarTemasDoDia();
    expect(resumo.gerados).toBe(1);

    const [linha] = await db().select().from(temasDia).where(eq(temasDia.nichoId, nichoId));
    expect(linha.temas[0]?.titulo).not.toBe("tema velho");
  });
});

/**
 * R1, item 0 (achado de produção em 01/10): rodar o job de novo no mesmo dia não pode piorar o
 * que já está lá. `podeSobrescreverTemasDoDia` testada direto (não pelo pipeline inteiro): o mock
 * de `temasDoDia` sempre gera os mesmos três temas candidatos a partir da mesma evidência, então
 * "o conjunto novo tem menos temas com prova" não dá para simular variando só a evidência de
 * entrada; testar a função de decisão direto prova a regra sem depender de como o mock gera.
 */
describe("podeSobrescreverTemasDoDia (R1, item 0)", () => {
  const temaA = { titulo: "tema A", descricao: "x", porQue: "x", evidencias: [], puxaPara: "conversao" as const };
  const temaB = { titulo: "tema B", descricao: "x", porQue: "x", evidencias: [], puxaPara: "alcance" as const };

  it("sem tema existente hoje, pode sobrescrever (primeira geração do dia)", async () => {
    expect(await podeSobrescreverTemasDoDia(nichoId, [temaA])).toBe(true);
  });

  it("o conjunto novo tem menos temas que o existente: não sobrescreve (o setor 5 caiu de 2 para 1)", async () => {
    await db()
      .insert(temasDia)
      .values({ nichoId, data: hojeISO(), temas: [temaA, temaB] });

    expect(await podeSobrescreverTemasDoDia(nichoId, [temaA])).toBe(false);
  });

  it("o conjunto novo tem o mesmo tanto ou mais: sobrescreve", async () => {
    await db()
      .insert(temasDia)
      .values({ nichoId, data: hojeISO(), temas: [temaA] });

    expect(await podeSobrescreverTemasDoDia(nichoId, [temaA, temaB])).toBe(true);
  });

  it("um roteiro de hoje já nasceu de um dos temas existentes: não sobrescreve, mesmo com o mesmo tanto de temas", async () => {
    await db()
      .insert(temasDia)
      .values({ nichoId, data: hojeISO(), temas: [temaA] });

    const usuarioId = "temas-do-dia-teste-roteiro-usou";
    await db().insert(user).values({ id: usuarioId, name: "[teste] roteiro ja usou", email: `${usuarioId}@temas.teste` });
    const [cliente] = await db().insert(clientes).values({ usuarioId, nome: "[teste] roteiro ja usou", nichoId }).returning();
    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: hojeISO(),
        tema: temaA.titulo,
        origem: "sugerido",
        objetivo: "alcance",
        conteudo: {
          titulo: temaA.titulo,
          duracaoS: 30,
          gancho: "x",
          corpo: "x",
          fechamento: "x",
          chamadaFinal: "x",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "x",
          edicao: { textoNaTela: [], ritmoDeCorte: "x", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: true,
          tipoAbertura: null,
          legenda: null,
        } as never,
      });

    expect(await podeSobrescreverTemasDoDia(nichoId, [temaA, temaB])).toBe(false);

    await db().delete(roteiros).where(eq(roteiros.clienteId, cliente.id));
    await db().delete(clientes).where(eq(clientes.id, cliente.id));
    await db().delete(user).where(eq(user.id, usuarioId));
  });

  it("um roteiro de hoje de OUTRO tema (nao um dos existentes): sobrescreve normalmente", async () => {
    await db()
      .insert(temasDia)
      .values({ nichoId, data: hojeISO(), temas: [temaA] });

    const usuarioId = "temas-do-dia-teste-roteiro-outro-tema";
    await db().insert(user).values({ id: usuarioId, name: "[teste] roteiro outro tema", email: `${usuarioId}@temas.teste` });
    const [cliente] = await db().insert(clientes).values({ usuarioId, nome: "[teste] roteiro outro tema", nichoId }).returning();
    await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: hojeISO(),
        tema: "um tema qualquer, nao o tema A",
        origem: "livre",
        objetivo: "alcance",
        conteudo: {
          titulo: "x",
          duracaoS: 30,
          gancho: "x",
          corpo: "x",
          fechamento: "x",
          chamadaFinal: "x",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "x",
          edicao: { textoNaTela: [], ritmoDeCorte: "x", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: true,
          tipoAbertura: null,
          legenda: null,
        } as never,
      });

    expect(await podeSobrescreverTemasDoDia(nichoId, [temaA, temaB])).toBe(true);

    await db().delete(roteiros).where(eq(roteiros.clienteId, cliente.id));
    await db().delete(clientes).where(eq(clientes.id, cliente.id));
    await db().delete(user).where(eq(user.id, usuarioId));
  });
});
