/**
 * Job `guardar-capas` (hotfix de 22/10/2026): baixa e guarda a capa dos vídeos do Instagram (e do TikTok, quando a coleta trouxer) enquanto o link assinado do CDN ainda vale, e marca como
 * vencida a que já não abre. É idempotente e retoma de onde parou: só pega quem ainda não tem linha em `capas_video`, quem falhou por motivo passageiro, ou quem ganhou link novo numa
 * recoleta (`servicos/capas.ts`, `videosComCapaPorGuardar`).
 *
 * Roda logo depois de cada coleta que traz capa nova (o worker enfileira ao terminar `meta-contas`, `coleta-apify`, `coleta-meio-dia` e `contas-base`), duas vezes por dia como reserva
 * (`agenda.ts`), e uma vez na partida do worker, o que cobre o deploy: o que já estava coletado e ainda tem link vivo é guardado ali, e o que venceu é marcado.
 */
import { logger } from "@/lib/log";
import { baixarCapa, gravarResultadoDaCapa, videosComCapaPorGuardar } from "@/servicos/capas";

import { buscarComAgenteSeguro } from "./busca-segura";

/** Quantos downloads ao mesmo tempo: o CDN aguenta e são imagens pequenas, mas a coleta e a VPS compartilhada não precisam de mais que isto. */
const SIMULTANEOS = 4;
const POR_LOTE = 200;
/** Teto de uma rodada (a próxima continua). */
const TEMPO_MAXIMO_MS = 10 * 60 * 1000;

export type ResumoGuardarCapas = {
  tentadas: number;
  guardadas: number;
  vencidas: number;
  grandes: number;
  tentandoDeNovo: number;
  interrompidoPeloTempo: boolean;
};

export async function rodarGuardarCapas(opcoes: { buscar?: typeof fetch; agora?: () => number; tempoMaximoMs?: number } = {}): Promise<ResumoGuardarCapas> {
  const buscar = opcoes.buscar ?? buscarComAgenteSeguro;
  const agora = opcoes.agora ?? Date.now;
  const limite = agora() + (opcoes.tempoMaximoMs ?? TEMPO_MAXIMO_MS);
  const resumo: ResumoGuardarCapas = { tentadas: 0, guardadas: 0, vencidas: 0, grandes: 0, tentandoDeNovo: 0, interrompidoPeloTempo: false };
  /** O que já foi tentado nesta rodada: o `tentando` volta na consulta seguinte, e a rodada não gasta as três tentativas de uma vez. */
  const jaTentados = new Set<number>();

  for (;;) {
    if (agora() >= limite) {
      resumo.interrompidoPeloTempo = true;
      break;
    }
    const lote = (await videosComCapaPorGuardar(POR_LOTE + jaTentados.size)).filter((v) => !jaTentados.has(v.id)).slice(0, POR_LOTE);
    if (lote.length === 0) break;

    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < lote.length && agora() < limite) {
        const video = lote[proximo++];
        jaTentados.add(video.id);
        const resultado = await baixarCapa(video.capaUrl, buscar);
        const situacao = await gravarResultadoDaCapa(video.id, video.capaUrl, resultado);
        resumo.tentadas += 1;
        if (situacao === "guardada") resumo.guardadas += 1;
        else if (situacao === "vencida") resumo.vencidas += 1;
        else if (situacao === "grande") resumo.grandes += 1;
        else resumo.tentandoDeNovo += 1;
      }
    };
    await Promise.all(Array.from({ length: SIMULTANEOS }, trabalhador));
  }

  logger.info(resumo, "guardar-capas: rodada terminada");
  return resumo;
}
