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
 * "subindo hoje", não o múltiplo de mediana.
 *
 * Só agenda com `config.coleta.coletaMeioDia` (`agenda.ts`); desligado, este
 * arquivo nunca roda. O "tema extra" em Hoje quando algo passar de 5x fica
 * fora desta rodada (mexe em tela, passa pelo design v2); registrado no
 * `TODO.md`.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";

import { buscarTiktokVigilancia } from "./apify-api";
import { upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";
import { rodarPontuarVelocidade } from "./pontuar";

const FONTE = "apify";
const CONTAS_DA_PASSADA = 20;
const VIDEOS_POR_CONTA = 5;

async function registrarConsumo(unidades: number): Promise<void> {
  if (unidades === 0) return;
  await db()
    .insert(consumoApi)
    .values({ fonte: FONTE, data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

export async function rodarColetaMeioDia(execucaoId?: number): Promise<Record<string, unknown>> {
  const contasDaPassada = await db()
    .select()
    .from(contas)
    .where(and(eq(contas.plataforma, "tiktok"), eq(contas.vigiada, true)))
    .orderBy(desc(contas.taxaForaDaCurva))
    .limit(CONTAS_DA_PASSADA);

  if (contasDaPassada.length === 0) {
    throw new ErroColeta("nenhuma conta vigiada do tiktok para a passada do meio-dia", false);
  }

  const { itens, devolvidos } = await buscarTiktokVigilancia(
    contasDaPassada.map((c) => c.handle),
    VIDEOS_POR_CONTA,
    VIDEOS_POR_CONTA * contasDaPassada.length,
  );
  await registrarConsumo(itens.length);

  let videosNovos = 0;
  let videosAtualizados = 0;
  const erros: string[] = [];

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

  const resumoPontuar = await rodarPontuarVelocidade();

  return {
    contas: contasDaPassada.length,
    resultadosDevolvidos: devolvidos,
    resultadosConsumidos: itens.length,
    videosNovos,
    videosAtualizados,
    ...resumoPontuar,
    erros: erros.length > 0 ? erros : undefined,
  };
}
