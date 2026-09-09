/**
 * Job `coleta-meio-dia` (E6 parte 3, terceira rodada, item 6, parágrafo
 * "Saiu uma trend ontem" do plano): passada leve ao meio-dia, so nas 20
 * contas do TikTok mais fora da curva (`contas.taxa_fora_da_curva`, todos os
 * nichos ativos juntos, não por nicho: é o que faz o custo bater com os
 * "100 resultados, cerca de US$ 0,30" da conta do plano, fixo, sem escalar
 * com o número de nichos), 5 vídeos cada. Pega a trend que nasceu de manhã,
 * sem esperar a vigilância da madrugada seguinte.
 *
 * Depois da coleta, `rodarPontuarVelocidade` recalcula só velocidade e
 * velocidade relativa (não a mediana de views nem fora_da_curva, que não
 * mudam com meia dúzia de vídeos novos e já foram calculados às 03:45): é
 * "velocidade" (views/hora desde a postagem) que decide se algo está
 * "subindo hoje", não o múltiplo de mediana. Roda mesmo sem nenhum vídeo
 * novo (ajuste 2 da revisão do PR #36): a leitura do Instagram pela Meta às
 * 11:55 (item 10) só ganha velocidade aqui, e não pode ficar presa a uma
 * condição do TikTok.
 *
 * A chamada ao Apify respeita o teto diário do mesmo jeito que
 * `rodarColetaApify` e `rodarContasBase` (ajuste 2: era o único uso do
 * Apify no projeto que não olhava o teto, e é o que roda depois de a
 * madrugada já ter gasto a cota); `consumoDeHoje`/`registrarConsumo` vêm de
 * `coleta-apify.ts`, mesma fonte "apify", em vez de duplicados aqui.
 *
 * Só agenda com `config.coleta.coletaMeioDia` (`agenda.ts`); desligado, este
 * arquivo nunca roda. O "tema extra" em Hoje quando algo passar de 5x fica
 * fora desta rodada (mexe em tela, passa pelo design v2); registrado no
 * `TODO.md`.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { contas } from "@/db/schema";
import { config } from "@/lib/config";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";

import { buscarTiktokVigilancia } from "./apify-api";
import { consumoDeHoje, registrarConsumo } from "./coleta-apify";
import { upsertVideo } from "./coleta-comum";
import { rodarPontuarVelocidade } from "./pontuar";

const CONTAS_DA_PASSADA = 20;
const VIDEOS_POR_CONTA = 5;

export async function rodarColetaMeioDia(execucaoId?: number): Promise<Record<string, unknown>> {
  const contasDaPassada = await db()
    .select()
    .from(contas)
    .where(and(eq(contas.plataforma, "tiktok"), eq(contas.vigiada, true)))
    .orderBy(desc(contas.taxaForaDaCurva))
    .limit(CONTAS_DA_PASSADA);

  const teto = config.coleta.apifyMaxResultadosDia;
  const usado = await consumoDeHoje();
  const espaco = teto - usado;
  /** Ajuste 4 da revisão do PR #36: mesma distinção de `coleta-apify.ts`. */
  const apifyDesligado = teto <= 0;

  let videosNovos = 0;
  let videosAtualizados = 0;
  let resultadosDevolvidos = 0;
  let resultadosConsumidos = 0;
  const erros: string[] = [];

  // Sem conta vigiada, ou sem espaço no teto (a madrugada já gastou a cota
  // do dia): pula a parte do Apify sem lançar, para a velocidade rodar do
  // mesmo jeito (ajuste 2).
  if (contasDaPassada.length > 0 && espaco > 0) {
    const maxItens = Math.min(VIDEOS_POR_CONTA * contasDaPassada.length, espaco);
    const { itens, devolvidos } = await buscarTiktokVigilancia(
      contasDaPassada.map((c) => c.handle),
      VIDEOS_POR_CONTA,
      maxItens,
    );
    resultadosDevolvidos = devolvidos;
    resultadosConsumidos = itens.length;
    await registrarConsumo(itens.length);

    for (const item of itens) {
      try {
        const normalizado = normalizarVideoTiktok(item);
        if (!normalizado) {
          erros.push(`item "${item.id ?? "sem id"}": sem nome do autor, pulado`);
          continue;
        }
        const { video, conta, audio } = normalizado;
        // A conta ja e uma das `contasDaPassada` (e vigiada, ja gravada); so
        // precisa do nicho dela para gravar o video, sem `upsertConta` de novo.
        const contaVigiada = contasDaPassada.find((c) => c.handle === conta.handle);
        if (!contaVigiada || contaVigiada.nichoId === null) {
          erros.push(`item "${item.id ?? "sem id"}": conta "${conta.handle}" sem nicho, pulado`);
          continue;
        }
        const resultado = await upsertVideo(
          video,
          contaVigiada.id,
          contaVigiada.nichoId,
          audio,
          "coleta",
          execucaoId ?? null,
        );
        if (resultado === "novo") videosNovos += 1;
        else videosAtualizados += 1;
      } catch (erroItem) {
        erros.push(`item "${item.id ?? "sem id"}": ${erroItem instanceof Error ? erroItem.message : String(erroItem)}`);
      }
    }
  }

  const resumoPontuar = await rodarPontuarVelocidade();

  return {
    contas: contasDaPassada.length,
    apifyDesligado,
    tetoAtingido: !apifyDesligado && espaco <= 0,
    resultadosDevolvidos,
    resultadosConsumidos,
    videosNovos,
    videosAtualizados,
    ...resumoPontuar,
    erros: erros.length > 0 ? erros : undefined,
  };
}
