/**
 * Preenche `videos.tipoAbertura` das análises que já existem no banco (V4,
 * item 2, roteiro sem vício): classifica pelo gancho e pelo formato já
 * extraídos, com o modelo barato, na API de lote da Anthropic
 * (`src/ia/lote.ts`, mesmo caminho do `extrairColeta`), sem transcrever
 * nada de novo. Idempotente: só toca vídeo com `analise` preenchida e
 * `tipoAbertura` nulo. `--limite N` para testar num número pequeno antes de
 * rodar tudo.
 *
 * `npm run preencher:tipo-abertura`, em produção quem roda é o Fable.
 */
import { and, asc, count, eq, gt, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { videos, type AnaliseVideo } from "@/db/schema";
import { coletarResultadosLote, criarLote, statusLote, type ItemLote } from "@/ia/lote";
import * as classificarAbertura from "@/ia/prompts/classificarAbertura";
import { registrarGeracao } from "@/ia/registro";

const TAMANHO_LOTE = 500;
const ESPERA_ENTRE_CONSULTAS_MS = 30_000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function aguardarLote(loteId: string): Promise<void> {
  while ((await statusLote(loteId)) !== "concluido") {
    await esperar(ESPERA_ENTRE_CONSULTAS_MS);
  }
}

async function processarLote(
  videosDoLote: { id: number; analise: AnaliseVideo }[],
): Promise<{ atualizados: number; comErro: number }> {
  const itens: ItemLote<classificarAbertura.SaidaClassificarAbertura>[] = videosDoLote.map((video) => ({
    customId: String(video.id),
    tarefa: "classificarAbertura",
    nivel: classificarAbertura.nivel,
    schema: classificarAbertura.schema,
    sistemaEstavel: classificarAbertura.montarSistemaEstavel(),
    entrada: classificarAbertura.montarEntrada({
      gancho: video.analise.gancho,
      formato: video.analise.formato,
    }),
  }));

  const loteId = await criarLote(itens);
  await aguardarLote(loteId);
  const resultados = await coletarResultadosLote(loteId, classificarAbertura.schema);

  let atualizados = 0;
  let comErro = 0;
  for (const resultado of resultados) {
    if (resultado.status !== "sucesso") {
      comErro += 1;
      continue;
    }
    const videoId = Number(resultado.customId);
    await db().update(videos).set({ tipoAbertura: resultado.dados.tipoAbertura }).where(eq(videos.id, videoId));
    atualizados += 1;

    await registrarGeracao({
      tarefa: "classificarAbertura",
      versaoPrompt: classificarAbertura.versao,
      modelo: resultado.modelo,
      nivel: classificarAbertura.nivel,
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

  return { atualizados, comErro };
}

function limiteDaLinhaDeComando(): number | undefined {
  const indice = process.argv.findIndex((a) => a === "--limite" || a.startsWith("--limite="));
  if (indice === -1) return undefined;
  const bruto = process.argv[indice].includes("=")
    ? process.argv[indice].split("=")[1]
    : process.argv[indice + 1];
  const valor = Number(bruto);
  return Number.isFinite(valor) && valor > 0 ? valor : undefined;
}

export async function preencherTipoAbertura(limite?: number): Promise<{
  videosSemTipoAberturaAntes: number;
  videosAtualizados: number;
  videosComErro: number;
}> {
  const [{ semTipo }] = await db()
    .select({ semTipo: count() })
    .from(videos)
    .where(and(isNotNull(videos.analise), isNull(videos.tipoAbertura)));

  let totalAtualizados = 0;
  let totalComErro = 0;
  let ultimoId = 0;

  for (;;) {
    if (limite !== undefined && totalAtualizados >= limite) break;
    const restante = limite !== undefined ? Math.min(TAMANHO_LOTE, limite - totalAtualizados) : TAMANHO_LOTE;

    const lote = await db()
      .select({ id: videos.id, analise: videos.analise })
      .from(videos)
      .where(and(isNotNull(videos.analise), isNull(videos.tipoAbertura), gt(videos.id, ultimoId)))
      .orderBy(asc(videos.id))
      .limit(restante);

    if (lote.length === 0) break;

    const { atualizados, comErro } = await processarLote(lote as { id: number; analise: AnaliseVideo }[]);
    totalAtualizados += atualizados;
    totalComErro += comErro;
    ultimoId = lote[lote.length - 1].id;

    if (lote.length < restante) break;
  }

  return {
    videosSemTipoAberturaAntes: semTipo,
    videosAtualizados: totalAtualizados,
    videosComErro: totalComErro,
  };
}

if (require.main === module) {
  preencherTipoAbertura(limiteDaLinhaDeComando())
    .then((resultado) => {
      console.log(JSON.stringify(resultado, null, 2));
      process.exit(0);
    })
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}
