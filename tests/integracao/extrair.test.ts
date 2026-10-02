/**
 * `rodarExtrair` e `rodarExtrairColeta` (etapa 8): ciclo completo contra o
 * Postgres real. A API de lote roda em modo mock (`AI_PROVIDER=mock`, ja
 * garantido pelo `vitest.config.mts`), sem chamar a Anthropic de verdade;
 * o mock de `extrairVideo` ainda passa pelo schema Zod real.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, lotesIa, nichos, videos } from "@/db/schema";
import { rodarExtrair } from "@/jobs/extrair";
import { LIMITE_ANALISADOS_SETOR_NOVO } from "@/jobs/extrair-agora";
import { rodarExtrairColeta } from "@/jobs/extrair-coleta";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

const TRANSCRICAO_BOA =
  "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.";

const ANALISE_EXEMPLO = {
  assunto: "ja analisado",
  gancho: "x",
  estrutura: "x",
  fechamento: "x",
  chamadaFinal: "x",
  formato: "outro",
  porQueFuncionou: "x",
};

async function criarVideo(
  idExterno: string,
  opcoes: { transcricao?: string; analise?: unknown; descricao?: string; contaId?: number } = {},
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: `[exemplo] video ${idExterno}`,
      views: 100,
      transcricao: opcoes.transcricao,
      analise: opcoes.analise as never,
      descricao: opcoes.descricao,
      contaId: opcoes.contaId,
    })
    .returning();
  return v;
}

/**
 * M1, item 1: `rodarExtrair` agora chama `rodarExtrairAgora` antes de montar o lote, e um setor
 * com menos de `LIMITE_ANALISADOS_SETOR_NOVO` vídeos analisados vai pelo caminho imediato, não
 * pelo lote. Este arquivo testa o lote especificamente (o caminho imediato tem o próprio arquivo,
 * `extrair-agora.test.ts`), então cada teste começa com o setor já "estabelecido".
 */
async function tornarSetorEstabelecido() {
  const linhas = Array.from({ length: LIMITE_ANALISADOS_SETOR_NOVO }, (_, i) => ({
    plataforma: "youtube" as const,
    idExterno: `ja-estabelecido-${i}`,
    url: `https://exemplo.invalido/ja-estabelecido-${i}`,
    nichoId,
    titulo: `[exemplo] ja estabelecido ${i}`,
    views: 100,
    transcricao: "video ja analisado, so para o setor nao contar como novo",
    analise: ANALISE_EXEMPLO as never,
  }));
  await db().insert(videos).values(linhas);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "extrair-teste", nome: "Extrair teste", termos: [] })
    .returning();
  nichoId = nicho.id;
});

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  await tornarSetorEstabelecido();
});

afterEach(async () => {
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(lotesIa);
});

describe("rodarExtrair mais rodarExtrairColeta", () => {
  it("monta o lote so com video transcrito e sem analise, e o ciclo completo grava analise mais etiquetas", async () => {
    await criarVideo("com-transcricao-sem-analise", { transcricao: TRANSCRICAO_BOA });
    await criarVideo("sem-transcricao"); // fica de fora do lote
    await criarVideo("ja-tem-analise", {
      transcricao: "outra transcricao",
      analise: { assunto: "ja analisado", gancho: "x", estrutura: "x", fechamento: "x", chamadaFinal: "x", formato: "outro", porQueFuncionou: "x" },
    }); // fica de fora do lote

    const resumoExtrair = await rodarExtrair();
    expect(resumoExtrair.videosNoLote).toBe(1);
    expect(resumoExtrair.loteIdExterno).toBeTruthy();

    const [loteGravado] = await db().select().from(lotesIa);
    expect(loteGravado.status).toBe("em_andamento");
    expect(loteGravado.tarefa).toBe("extrairVideo");

    const resumoColeta = await rodarExtrairColeta();
    expect(resumoColeta.lotesPendentesAntes).toBe(1);
    expect(resumoColeta.lotesConcluidos).toBe(1);
    expect(resumoColeta.videosAtualizados).toBe(1);

    const [videoAtualizado] = await db()
      .select()
      .from(videos)
      .where(eq(videos.idExterno, "com-transcricao-sem-analise"));
    expect(videoAtualizado.analise).not.toBeNull();
    expect(videoAtualizado.analise!.assunto).toBeTruthy();
    expect(videoAtualizado.etiquetas.length).toBeGreaterThan(0);
    // M4, item 1: este caminho sempre le a transcricao, nunca e o caminho sem fala.
    expect(videoAtualizado.semFala).toBe(false);

    const [loteAtualizado] = await db().select().from(lotesIa);
    expect(loteAtualizado.status).toBe("concluido");
    expect(loteAtualizado.concluidoEm).not.toBeNull();

    // Video que ja tinha analise nao foi tocado.
    const [videoIntocado] = await db().select().from(videos).where(eq(videos.idExterno, "ja-tem-analise"));
    expect(videoIntocado.analise!.assunto).toBe("ja analisado");
  });

  /**
   * M5b, achado 7 da revisão do motor (01/10/2026): a extração não via a legenda do post (só
   * título e transcrição), mas o prompt pede para reconhecer "POV" e legenda de outra página,
   * sinais que podem estar só na legenda. Antes desta etapa, `montarEntrada` nem recebia a
   * legenda: este teste prova que ela chega até o modelo (o mock lê a legenda, não só o título).
   */
  it("a legenda do post chega na extracao: POV so na legenda classifica como meme", async () => {
    await criarVideo("com-pov-na-legenda", {
      transcricao: TRANSCRICAO_BOA,
      descricao: "Mais um POV de dono de pequeno negocio #comedia",
    });

    await rodarExtrair();
    await rodarExtrairColeta();

    const [videoAtualizado] = await db().select().from(videos).where(eq(videos.idExterno, "com-pov-na-legenda"));
    expect(videoAtualizado.tipoConteudo).toBe("meme");
    expect(videoAtualizado.serveDeModelo).toBe(false);
  });

  /**
   * M5b, achado 7: o @ da conta também chega na entrada (via `contas.handle`). Prova indireta,
   * pelo mesmo sinal que `pertenceAoNicho` já usa (`mockExtrairVideo` olha a entrada inteira):
   * um termo do nicho que só aparece no handle, nunca no título nem na transcrição, só bate se o
   * handle de fato chegou até o modelo.
   */
  it("o @ da conta chega na extracao", async () => {
    await db().update(nichos).set({ termos: ["nichoexclusivodoteste"] }).where(eq(nichos.id, nichoId));
    try {
      const [conta] = await db()
        .insert(contas)
        .values({ plataforma: "youtube", handle: "nichoexclusivodoteste", nichoId })
        .returning();
      await criarVideo("com-conta-termo-no-handle", { transcricao: TRANSCRICAO_BOA, contaId: conta.id });

      await rodarExtrair();
      await rodarExtrairColeta();

      const [videoAtualizado] = await db().select().from(videos).where(eq(videos.idExterno, "com-conta-termo-no-handle"));
      expect(videoAtualizado.analise!.pertenceAoNicho).toBe(true);
    } finally {
      await db().update(nichos).set({ termos: [] }).where(eq(nichos.id, nichoId));
    }
  });

  it("transcricao curta demais nao entra no lote e ganha nova tentativa de transcricao", async () => {
    await criarVideo("transcricao-curta", { transcricao: "E ai" });
    const bom = await criarVideo("transcricao-boa", { transcricao: TRANSCRICAO_BOA });

    const resumo = await rodarExtrair();
    expect(resumo.videosNoLote).toBe(1);
    expect(resumo.transcricaoCurtaDemais).toBe(1);

    const [loteGravado] = await db().select().from(lotesIa);
    expect(loteGravado.videoIds).toEqual([bom.id]);

    const [videoCurto] = await db().select().from(videos).where(eq(videos.idExterno, "transcricao-curta"));
    expect(videoCurto.proximaTentativaTranscricao).not.toBeNull();
    expect(videoCurto.analise).toBeNull();
  });

  /**
   * Achado 13 da revisão do motor (01/10/2026): a API de lote é assíncrona, até 24h; sem isto, o
   * mesmo vídeo entrava num segundo lote enquanto o primeiro ainda não tinha voltado, gastando em
   * dobro.
   */
  it("video ja num lote de extrairVideo em andamento nunca entra em outro lote", async () => {
    const jaEmLote = await criarVideo("ja-em-lote-pendente", { transcricao: TRANSCRICAO_BOA });
    const livre = await criarVideo("livre-para-o-lote", { transcricao: TRANSCRICAO_BOA });
    await db().insert(lotesIa).values({
      tarefa: "extrairVideo",
      loteIdExterno: "lote-externo-pendente-de-ontem",
      videoIds: [jaEmLote.id],
      status: "em_andamento",
    });

    const resumo = await rodarExtrair();

    expect(resumo.videosNoLote).toBe(1);
    const [loteNovo] = await db()
      .select()
      .from(lotesIa)
      .where(eq(lotesIa.loteIdExterno, resumo.loteIdExterno as string));
    expect(loteNovo.videoIds).toEqual([livre.id]);
  });

  /**
   * Achado 13 da revisão do motor: sem isto, `rodarExtrair` reagendava TODO vídeo curto para daqui
   * a 7 dias em toda rodada (roda todo dia), empurrando a data de vencimento antes dela chegar a
   * passar; a transcrição "vazia" (ou curta) nunca voltava de fato à fila.
   */
  it("video curto com tentativa ja agendada no futuro nao tem a data empurrada de novo", async () => {
    const video = await criarVideo("curto-ja-agendado", { transcricao: "E ai" });
    const dataOriginal = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 dias, nao os 7 do reagendamento
    await db().update(videos).set({ proximaTentativaTranscricao: dataOriginal }).where(eq(videos.id, video.id));

    await rodarExtrair();

    const [videoDepois] = await db().select().from(videos).where(eq(videos.id, video.id));
    expect(videoDepois.proximaTentativaTranscricao?.getTime()).toBe(dataOriginal.getTime());
  });

  it("video curto cuja tentativa ja venceu ganha uma nova data, 7 dias a frente", async () => {
    const video = await criarVideo("curto-tentativa-vencida", { transcricao: "E ai" });
    const dataVencida = new Date(Date.now() - 24 * 60 * 60 * 1000); // ja passou
    await db().update(videos).set({ proximaTentativaTranscricao: dataVencida }).where(eq(videos.id, video.id));

    await rodarExtrair();

    const [videoDepois] = await db().select().from(videos).where(eq(videos.id, video.id));
    expect(videoDepois.proximaTentativaTranscricao!.getTime()).toBeGreaterThan(dataVencida.getTime());
  });

  it("sem nenhum video candidato, nao cria lote", async () => {
    const resumo = await rodarExtrair();
    expect(resumo.videosNoLote).toBe(0);
    expect(resumo.loteIdExterno).toBeUndefined();

    const lotes = await db().select().from(lotesIa);
    expect(lotes).toHaveLength(0);
  });

  it("rodar a coleta de novo depois de concluido nao reprocessa o mesmo lote", async () => {
    await criarVideo("video-unico", { transcricao: TRANSCRICAO_BOA });
    await rodarExtrair();
    await rodarExtrairColeta();

    const resumoSegunda = await rodarExtrairColeta();
    expect(resumoSegunda.lotesPendentesAntes).toBe(0);
    expect(resumoSegunda.lotesConcluidos).toBe(0);
  });
});
