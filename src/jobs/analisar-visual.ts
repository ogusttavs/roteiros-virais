/**
 * Job `analisarVisual` (etapa 9, semanal, decisao 1 do `PROXIMO.md`): por
 * nicho, os 10 videos dos ultimos 7 dias com maior fora_da_curva que tem
 * transcricao e ainda nao tem analise_visual. Baixa o video em 480p, extrai
 * 8 quadros (`src/servicos/quadros.ts`) e manda a tarefa `analisarVisual`
 * (modelo forte, com imagem). Video que falha no download ou na extracao
 * de quadros nao derruba os outros (mesmo padrao de erro por item das
 * etapas 6 e 8), e fica registrado no resumo.
 *
 * V2a, item 3: vídeo do Instagram com `videos.midiaUrl` lida há menos de
 * 20h baixa direto pelo endereço de mídia da Meta (`urlParaBaixar`), sem
 * cair no yt-dlp contra a página do Instagram; mesmo raciocínio de
 * `transcrever.ts`.
 *
 * V2a, item 5 (corrigido no ajuste 1 da revisão do PR #45): o update de
 * sucesso grava `analiseVisualEm` junto com `analiseVisual`, mesmo
 * raciocínio de `transcrever.ts` (`atualizadoEm` é da coleta, não da
 * leitura); é o sinal que `resumoLeituraPorPlataforma` (`admin-coleta.ts`)
 * usa para "analisados hoje" em `/admin/nichos/[slug]`.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { nichos, videos, type AnaliseVisual, type Plataforma } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as analisarVisualIA from "@/ia/prompts/analisarVisual";
import { registrarGeracao } from "@/ia/registro";
import { config } from "@/lib/config";
import { incluirSeed, PERTENCE_AO_NICHO } from "@/servicos/pesquisa";
import { temposDeQuadro } from "@/servicos/quadros";

import { midiaUrlFresca } from "./coleta-comum";
import { apagarVideo, baixarVideo480p, duracaoDoArquivoS, extrairQuadros } from "./video";
import { ehUrlDoYoutube, pausaEntreVideosYoutube } from "./youtube-cliente";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

type CandidatoVisual = {
  id: number;
  url: string;
  plataforma: Plataforma;
  midiaUrl: string | null;
  midiaUrlEm: Date | null;
  titulo: string | null;
  transcricao: string | null;
  duracaoS: number | null;
};

async function candidatosDoNicho(nichoId: number): Promise<CandidatoVisual[]> {
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, new Date(Date.now() - SETE_DIAS_MS)),
    isNotNull(videos.foraDaCurva),
    isNotNull(videos.transcricao),
    isNotNull(videos.analise),
    isNull(videos.analiseVisual),
    PERTENCE_AO_NICHO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  return db()
    .select({
      id: videos.id,
      url: videos.url,
      plataforma: videos.plataforma,
      midiaUrl: videos.midiaUrl,
      midiaUrlEm: videos.midiaUrlEm,
      titulo: videos.titulo,
      transcricao: videos.transcricao,
      duracaoS: videos.duracaoS,
    })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva), asc(videos.id))
    .limit(config.regras.visuaisPorSemana);
}

/**
 * Endereço de mídia direto quando fresco (V2a, item 3), a URL de verdade
 * senão; mesmo raciocínio de `urlParaBaixar` em `transcrever.ts`.
 */
function urlParaBaixar(video: CandidatoVisual): string {
  if (video.plataforma === "instagram" && video.midiaUrl && midiaUrlFresca(video.midiaUrlEm)) {
    return video.midiaUrl;
  }
  return video.url;
}

async function analisarUm(video: CandidatoVisual): Promise<void> {
  let caminhoVideo: string | null = null;
  try {
    // A plataforma da linha decide seletor e proxy (ajuste 2 da revisao do PR #45): a url direta da Meta nao parece Instagram.
    caminhoVideo = await baixarVideo480p(urlParaBaixar(video), video.plataforma);

    /**
     * Video vindo da Meta (Business Discovery/Hashtag Search, E6 parte 3,
     * segunda rodada) nunca grava `duracao_s`: a API dela nao devolve isso
     * (transcricao do YouTube, rodada 2, item 3b). Antes, isso derrubava a
     * analise sem nem tentar o download; agora le do proprio arquivo
     * baixado com `ffprobe` e grava, para as proximas leituras do mesmo
     * video nao precisarem disso de novo.
     */
    const duracaoS = video.duracaoS ?? (await duracaoDoArquivoS(caminhoVideo));
    if (video.duracaoS === null) {
      await db().update(videos).set({ duracaoS }).where(eq(videos.id, video.id));
    }

    const quadros = await extrairQuadros(caminhoVideo, temposDeQuadro(duracaoS));

    const resultado = await gerarEstruturado({
      tarefa: "analisarVisual",
      nivel: analisarVisualIA.nivel,
      effort: analisarVisualIA.esforco,
      schema: analisarVisualIA.schema,
      sistemaEstavel: analisarVisualIA.montarSistemaEstavel(),
      entrada: analisarVisualIA.montarEntrada({
        titulo: video.titulo ?? "",
        duracaoS,
        transcricao: video.transcricao ?? "",
      }),
      imagens: quadros.map((quadro) => ({ base64: quadro.base64, mediaType: "image/jpeg" as const })),
    });

    const analiseVisual: AnaliseVisual = resultado.dados;
    await db().update(videos).set({ analiseVisual, analiseVisualEm: new Date() }).where(eq(videos.id, video.id));

    await registrarGeracao({
      tarefa: "analisarVisual",
      versaoPrompt: analisarVisualIA.versao,
      modelo: resultado.modelo,
      nivel: analisarVisualIA.nivel,
      entradas: { videoId: video.id },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });
  } finally {
    if (caminhoVideo) await apagarVideo(caminhoVideo);
  }
}

export async function rodarAnalisarVisual(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let analisados = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const candidatos = await candidatosDoNicho(nicho.id);

    for (const video of candidatos) {
      try {
        await analisarUm(video);
        analisados += 1;
      } catch (erro) {
        falhas += 1;
        erros.push(`video ${video.id} / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }

      // Espaça as chamadas ao YouTube (transcricao do YouTube, rodada 2, item 2), mesmo raciocinio de transcrever.ts.
      if (ehUrlDoYoutube(video.url)) await pausaEntreVideosYoutube();
    }
  }

  return {
    nichos: nichosAtivos.length,
    analisados,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
