/**
 * O que `extrair-coleta.ts` (lote) e `extrair-agora.ts` (M1, item 1, setor novo) compartilham:
 * a checagem de idioma, a retentativa em português e como um resultado de `extrairVideo` vira
 * colunas em `videos`. Extraído nesta rodada para o caminho imediato não duplicar a mesma regra
 * de qualidade (revisão do PR #30: análise nenhuma é pior que uma com um campo em inglês).
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { lotesIa, nichos, videos, type AnaliseVideo } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as extrairVideo from "@/ia/prompts/extrairVideo";
import { registrarGeracao } from "@/ia/registro";
import { pareceTextoEmPortugues } from "@/lib/idioma";

/**
 * Transcricao curta demais nao carrega informacao o bastante para o
 * extrator acertar (achado da revisao da etapa 8): esses videos nao entram
 * no lote (nem no caminho imediato) e ganham uma proxima tentativa de
 * transcricao, para o job `transcrever` tentar de novo pelo audio se a
 * legenda foi o problema.
 */
export const TAMANHO_MINIMO_TRANSCRICAO = 80;

/**
 * Achado 13 da revisão do motor (01/10/2026): vídeo já num lote da mesma tarefa ainda em
 * andamento (a API de lote é assíncrona, até 24h) nunca entra em outro lote nem no caminho
 * imediato (`extrair-agora.ts`); sem isto, o mesmo vídeo podia ser analisado duas vezes (gasto em
 * dobro) enquanto o lote de ontem ainda não tinha voltado.
 */
export async function idsEmLotePendente(tarefa: string): Promise<Set<number>> {
  const lotes = await db()
    .select({ videoIds: lotesIa.videoIds })
    .from(lotesIa)
    .where(and(eq(lotesIa.tarefa, tarefa), eq(lotesIa.status, "em_andamento")));
  return new Set(lotes.flatMap((l) => l.videoIds));
}

/**
 * Achado 13 da revisão do motor (01/10/2026): sem isto, todo vídeo "curto" era reagendado para
 * daqui a 7 dias EM TODA RODADA (`extrair`/`extrairAgora` rodam todo dia), mesmo quando já tinha
 * uma tentativa futura pendente; a data nunca chegava a passar, porque era empurrada de novo
 * antes de vencer. Só reagenda quem está sem tentativa marcada ou já passou da marcada.
 */
export function precisaAgendarNovaTentativa(proximaTentativaTranscricao: Date | null, agora: Date): boolean {
  return !proximaTentativaTranscricao || proximaTentativaTranscricao <= agora;
}

/**
 * So os campos que o cliente le (o gancho pode vir sozinho no idioma
 * original quando o resto da analise saiu certo, achado de 06/09):
 * `assunto`, `etiquetas` e `motivoNicho` ficam fora, porque um deles e
 * curto demais para dar sinal e os outros dois sao uso interno.
 */
function camposParaChecarIdioma(dados: extrairVideo.SaidaExtrairVideo): string[] {
  return [dados.gancho, dados.estrutura, dados.fechamento, dados.chamadaFinal, dados.porQueFuncionou];
}

export function pareceEmPortugues(dados: extrairVideo.SaidaExtrairVideo): boolean {
  return camposParaChecarIdioma(dados).every(pareceTextoEmPortugues);
}

export function contarCamposEmPortugues(dados: extrairVideo.SaidaExtrairVideo): number {
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

export async function retentarEmPortugues(videoId: number): Promise<extrairVideo.SaidaExtrairVideo | null> {
  const dadosVideo = await buscarDadosParaRetentativa(videoId);
  if (!dadosVideo) return null;

  // Achado 11 da revisão do motor: `montarEntrada` já termina com o lembrete de acentuação; esta
  // instrução de tradução entra depois dele (ao contrário da segunda tentativa do roteiro, que o
  // achado pede explicitamente reordenada), porque o próprio pedido de traduzir tudo já cobre
  // acentuação, e esta retentativa é sobre idioma, não sobre o lembrete genérico.
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

/**
 * Um resultado de `extrairVideo` que passou (ou nao) na checagem de idioma, com a melhor versao
 * escolhida (achado do 06/09, revisao do PR #30: nunca descarta a analise so por causa do idioma).
 * `aplicarResultadoExtracao` grava as colunas e registra a geracao; quem chama decide se veio de
 * lote (`emLote: true`) ou do caminho imediato (`emLote: false`).
 */
export async function resolverIdioma(
  videoId: number,
  dados: extrairVideo.SaidaExtrairVideo,
): Promise<{ dados: extrairVideo.SaidaExtrairVideo; reprovadoPorIdioma: boolean }> {
  if (pareceEmPortugues(dados)) return { dados, reprovadoPorIdioma: false };

  const retentativa = await retentarEmPortugues(videoId);
  if (retentativa && pareceEmPortugues(retentativa)) {
    return { dados: retentativa, reprovadoPorIdioma: false };
  }
  if (retentativa && contarCamposEmPortugues(retentativa) > contarCamposEmPortugues(dados)) {
    return { dados: retentativa, reprovadoPorIdioma: true };
  }
  return { dados, reprovadoPorIdioma: true };
}

/**
 * Grava a analise, etiquetas, idioma da fala, tipo de abertura e tipo de conteudo no video (o
 * mesmo caminho para lote e imediato: a extracao le a transcricao inteira, mais confiavel que
 * titulo/descricao para idioma e mais precisa que so o gancho ja extraido para tipo de
 * abertura). `tipoConteudo`/`serveDeModelo` (H4, item 2) ficam tanto no jsonb `analise` (registro
 * completo) quanto em colunas proprias (`evidenciaParaRoteiro` filtra por SQL).
 *
 * Achado 3 da revisao do motor (01/10/2026): quando `idiomaConfirmado` e verdadeiro (a Groq ou a
 * legenda do YouTube ja confirmaram o idioma na fala de verdade, `transcrever.ts`), so grava o
 * palpite da extracao se ele concordar na mesma lingua base (os dois primeiros caracteres: "pt"
 * de "pt-BR"/"pt-PT" continua refinando um "pt" generico). Discordando (por exemplo, confirmado
 * "en" e a extracao devolveu "pt-BR"), mantem o idioma confirmado: foi exatamente essa
 * divergencia, de um texto forcado no idioma errado, que fazia a extracao concluir "pt-BR" para
 * um video em outro idioma e a conta virar `pais = 'BR'` para sempre (`pontuar.ts`).
 */
export async function aplicarResultadoExtracao(videoId: number, dados: extrairVideo.SaidaExtrairVideo): Promise<void> {
  const { etiquetas, idioma, tipoAbertura, ...analise } = dados;
  const analiseVideo: AnaliseVideo = analise;
  // M4, item 1: este caminho sempre lê a transcrição, nunca é o caminho sem fala.
  await db()
    .update(videos)
    .set({
      analise: analiseVideo,
      etiquetas,
      idioma: sql`CASE
        WHEN ${videos.idiomaConfirmado} AND left(${videos.idioma}, 2) IS DISTINCT FROM left(${idioma}, 2)
        THEN ${videos.idioma}
        ELSE ${idioma}
      END`,
      tipoAbertura,
      tipoConteudo: dados.tipoConteudo,
      serveDeModelo: dados.serveDeModelo,
      semFala: false,
    })
    .where(eq(videos.id, videoId));
}
