/**
 * Job `extrairColeta` (etapa 8, roda a parte, a cada poucas horas): busca os
 * lotes `em_andamento` de `lotes_ia`, confere se cada um terminou, e quando
 * terminou grava `analise` mais `etiquetas` nos videos do lote.
 *
 * Idioma (acabamento visual 2, achado do Gustavo no iPad): a analise que
 * nao passa na checagem barata de `src/lib/idioma.ts` ganha uma segunda
 * tentativa, sincrona (fora do lote, so para este video), com a instrucao
 * de traducao reforcada. Reprovou de novo, grava a melhor das duas mesmo
 * assim (revisao do PR #30: analise nenhuma e pior que uma com um campo em
 * ingles) e conta no resumo do job; nunca deixa o video sem analise por
 * causa disto.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, nichos, videos, type AnaliseVideo } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { coletarResultadosLote, statusLote } from "@/ia/lote";
import * as extrairVideo from "@/ia/prompts/extrairVideo";
import { registrarGeracao } from "@/ia/registro";
import { pareceTextoEmPortugues } from "@/lib/idioma";

/**
 * So os campos que o cliente le (o gancho pode vir sozinho no idioma
 * original quando o resto da analise saiu certo, achado de 06/09):
 * `assunto`, `etiquetas` e `motivoNicho` ficam fora, porque um deles e
 * curto demais para dar sinal e os outros dois sao uso interno.
 */
function camposParaChecarIdioma(dados: extrairVideo.SaidaExtrairVideo): string[] {
  return [dados.gancho, dados.estrutura, dados.fechamento, dados.chamadaFinal, dados.porQueFuncionou];
}

function pareceEmPortugues(dados: extrairVideo.SaidaExtrairVideo): boolean {
  return camposParaChecarIdioma(dados).every(pareceTextoEmPortugues);
}

function contarCamposEmPortugues(dados: extrairVideo.SaidaExtrairVideo): number {
  return camposParaChecarIdioma(dados).filter(pareceTextoEmPortugues).length;
}

async function buscarDadosParaRetentativa(
  videoId: number,
): Promise<{ titulo: string; transcricao: string; nomeNicho: string; termosNicho: string[] } | null> {
  const [linha] = await db()
    .select({
      titulo: videos.titulo,
      transcricao: videos.transcricao,
      nomeNicho: nichos.nome,
      termosNicho: nichos.termos,
    })
    .from(videos)
    .innerJoin(nichos, eq(videos.nichoId, nichos.id))
    .where(eq(videos.id, videoId));

  if (!linha || !linha.transcricao) return null;
  return { titulo: linha.titulo ?? "", transcricao: linha.transcricao, nomeNicho: linha.nomeNicho, termosNicho: linha.termosNicho };
}

async function retentarEmPortugues(videoId: number): Promise<extrairVideo.SaidaExtrairVideo | null> {
  const dadosVideo = await buscarDadosParaRetentativa(videoId);
  if (!dadosVideo) return null;

  const entrada = `${extrairVideo.montarEntrada(dadosVideo)}\n\nA tentativa anterior saiu em outro idioma ou so parte dela. Traduza tudo para o português do Brasil, inclusive o gancho.`;

  const resultado = await gerarEstruturado({
    tarefa: "extrairVideo",
    nivel: extrairVideo.nivel,
    effort: extrairVideo.esforco,
    schema: extrairVideo.schema,
    sistemaEstavel: extrairVideo.montarSistemaEstavel(),
    entrada,
  });

  await registrarGeracao({
    tarefa: "extrairVideo",
    versaoPrompt: extrairVideo.versao,
    modelo: resultado.modelo,
    nivel: extrairVideo.nivel,
    entradas: { videoId, retentativaDeIdioma: true },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  return resultado.dados;
}

export async function rodarExtrairColeta(): Promise<Record<string, unknown>> {
  const lotesPendentes = await db().select().from(lotesIa).where(eq(lotesIa.status, "em_andamento"));

  let lotesConcluidos = 0;
  let videosAtualizados = 0;
  let videosComErro = 0;
  let reprovadosPorIdioma = 0;
  const erros: string[] = [];

  for (const lote of lotesPendentes) {
    const status = await statusLote(lote.loteIdExterno);
    if (status !== "concluido") continue;

    const resultados = await coletarResultadosLote(lote.loteIdExterno, extrairVideo.schema);

    for (const resultado of resultados) {
      const videoId = Number(resultado.customId);

      if (resultado.status !== "sucesso") {
        videosComErro += 1;
        const motivo = resultado.status === "erro" ? resultado.motivo : "lote expirado";
        erros.push(`video ${videoId}: ${motivo}`);
        continue;
      }

      let dados = resultado.dados;
      if (!pareceEmPortugues(dados)) {
        const retentativa = await retentarEmPortugues(videoId);
        if (retentativa && pareceEmPortugues(retentativa)) {
          dados = retentativa;
        } else {
          // As duas reprovaram (ou a retentativa nao rodou, sem transcricao
          // para reconstruir a entrada): fica com a que passa em mais
          // campos, nunca descarta a analise (revisao do PR #30).
          reprovadosPorIdioma += 1;
          erros.push(`video ${videoId}: analise reprovada na checagem de idioma depois de refazer`);
          if (retentativa && contarCamposEmPortugues(retentativa) > contarCamposEmPortugues(dados)) {
            dados = retentativa;
          }
        }
      }

      const { etiquetas, ...analise } = dados;
      const analiseVideo: AnaliseVideo = analise;

      await db().update(videos).set({ analise: analiseVideo, etiquetas }).where(eq(videos.id, videoId));
      videosAtualizados += 1;

      await registrarGeracao({
        tarefa: "extrairVideo",
        versaoPrompt: extrairVideo.versao,
        modelo: resultado.modelo,
        nivel: extrairVideo.nivel,
        entradas: { videoId },
        saida: resultado.dados,
        uso: {
          tokensEntrada: resultado.tokensEntrada,
          tokensSaida: resultado.tokensSaida,
          tokensCacheLeitura: 0,
          tokensCacheEscrita: 0,
        },
        emLote: true,
      });
    }

    await db()
      .update(lotesIa)
      .set({ status: "concluido", concluidoEm: new Date() })
      .where(eq(lotesIa.id, lote.id));
    lotesConcluidos += 1;
  }

  return {
    lotesPendentesAntes: lotesPendentes.length,
    lotesConcluidos,
    videosAtualizados,
    videosComErro,
    reprovadosPorIdioma,
    erros: erros.length > 0 ? erros : undefined,
  };
}
