/**
 * Coleta do Apify (etapa 6, parte 2): TikTok e Instagram, por termo do
 * nicho (hashtag, PROXIMO.md decisao 2) e por conta vigiada (perfil). Mesmo
 * padrao de idempotencia das outras coletas (ON CONFLICT em
 * plataforma+id_externo, `src/jobs/coleta-comum.ts`). Credito contado em
 * `consumo_api` com fonte "apify", em resultados consumidos, o que sobra
 * depois do corte de `rodarAtor` (nao em dolar, decisao 4), TikTok e
 * Instagram somados num teto diario so. O resumo tambem registra
 * `resultadosDevolvidos`, o que o ator de fato cobrou antes do corte
 * (PROXIMO.md, item 1): os dois divergem quando `resultsPerPage` pede mais
 * por alvo do que o teto desta chamada permite guardar. Ao chegar no teto,
 * o job para (nao tenta mais nichos) e registra `tetoAtingido` no resumo.
 *
 * E6 parte 3, terceira rodada: o TikTok deixa de mandar hashtag e perfil
 * numa chamada so, dividindo o teto entre os alvos (`limitePorAlvo`, ainda
 * usado pelo Instagram). Agora sao duas chamadas separadas, cada uma com um
 * limite fixo por alvo: a busca por hashtag (item 1) so nos dias do
 * rodizio (item 2, `termosDaRodada`), e a vigilancia por perfil (item 3)
 * todo dia. As duas contam para o mesmo teto diario e o mesmo consumo
 * "apify". `resultadosConsumidos` no resumo e so desta execucao (para a
 * taxa de acerto do admin de jobs, item 5); `resultadosConsumidosHoje`
 * continua sendo o total acumulado do dia, incluindo execucoes anteriores.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { normalizarVideoInstagram } from "@/servicos/normalizadores/instagram";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";

import {
  buscarInstagram,
  buscarTiktokPorHashtag,
  buscarTiktokVigilancia,
  RESULTADOS_POR_TERMO_HASHTAG,
  VIDEOS_POR_PERFIL_VIGILANCIA,
} from "./apify-api";
import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";

const FONTE = "apify";
const FUSO = "America/Sao_Paulo";

/**
 * Os termos do nicho em rodizio, tres grupos fixos pelo indice (0, 1, 2
 * modulo 3), um grupo por dia (E6 parte 3, terceira rodada, item 2):
 * segunda o grupo 0, quarta o grupo 1, sexta o grupo 2. Nos demais dias
 * (dia sem rodada) devolve vazio, so a vigilancia roda nesse dia. Funcao
 * pura, testada com data explicita; `rodarColetaApify` chama sem segundo
 * argumento (usa "agora").
 */
const GRUPO_DO_DIA: Record<string, number> = { Mon: 0, Wed: 1, Fri: 2 };

export function termosDaRodada(termos: string[], data: Date = new Date()): string[] {
  const diaDaSemana = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short" }).format(data);
  const grupo = GRUPO_DO_DIA[diaDaSemana];
  if (grupo === undefined) return [];
  return termos.filter((_, indice) => indice % 3 === grupo);
}

/**
 * Exportada (ajuste 2 da revisão do PR #36) para `coleta-meio-dia.ts`
 * reaproveitar em vez de copiar: mesma fonte "apify", mesmo teto diário.
 */
export async function consumoDeHoje(): Promise<number> {
  const [linha] = await db()
    .select({ unidades: consumoApi.unidades })
    .from(consumoApi)
    .where(and(eq(consumoApi.fonte, FONTE), eq(consumoApi.data, hojeISO())));
  return linha?.unidades ?? 0;
}

export async function registrarConsumo(unidades: number): Promise<void> {
  if (unidades === 0) return;
  await db()
    .insert(consumoApi)
    .values({ fonte: FONTE, data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

/**
 * `nichoId` (etapa 24, parte 1): mesmo raciocinio de `rodarColetaYoutube`.
 * `execucaoId` (E6 parte 3, terceira rodada, item 5): id da propria linha
 * de `execucoes_job`, que `executarComRegistro` passa; gravado em todo
 * video novo desta execucao, para o admin de jobs medir a taxa de acerto.
 */
export async function rodarColetaApify(nichoId?: number, execucaoId?: number): Promise<Record<string, unknown>> {
  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select().from(nichos).where(condicao);

  const teto = config.coleta.apifyMaxResultadosDia;
  let resultadosUsados = await consumoDeHoje();
  let resultadosDevolvidos = 0;
  let resultadosConsumidos = 0;
  const cabe = () => resultadosUsados < teto;
  const idDaExecucao = execucaoId ?? null;
  const apifyDesligado = teto <= 0;
  /**
   * Capturado antes do laço (ajuste 4 da revisão do PR #36): distingue "sem
   * orçamento desde o início" (teto zero, ou já esgotado por outra execução
   * hoje) de "o laço gastou tudo no meio". Só o primeiro caso, junto com
   * `apifyDesligado`, dispensa o `ErroColeta` abaixo: um estado escolhido
   * (decisão do Gustavo em 09/09, TikTok pelo Apify suspenso), não falha.
   */
  const tinhaOrcamentoNoInicio = cabe();

  let chamadasTiktok = 0;
  let chamadasInstagram = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  const erros: string[] = [];

  const agora = new Date();

  for (const nicho of nichosAtivos) {
    if (!cabe()) break;

    const termosRodada = termosDaRodada(nicho.termos, agora);
    if (termosRodada.length > 0 && cabe()) {
      chamadasTiktok += 1;
      try {
        const maxItens = Math.min(RESULTADOS_POR_TERMO_HASHTAG * termosRodada.length, teto - resultadosUsados);
        const { itens, devolvidos } = await buscarTiktokPorHashtag(termosRodada, maxItens);
        resultadosUsados += itens.length;
        resultadosConsumidos += itens.length;
        resultadosDevolvidos += devolvidos;
        await registrarConsumo(itens.length);
        for (const item of itens) {
          try {
            const normalizado = normalizarVideoTiktok(item);
            if (!normalizado) {
              // Sem authorMeta.name nao da para gravar a conta (rodada de
              // acabamento de 06/09, item 3): pula o item com um aviso em
              // vez de deixar o erro estourar e derrubar o resto do lote.
              erros.push(
                `tiktok / hashtag / nicho "${nicho.slug}" / item "${item.id ?? "sem id"}": sem nome do autor, pulado`,
              );
              continue;
            }
            const { video, conta, audio } = normalizado;
            const contaId = await upsertConta(conta, nicho.id);
            const resultado = await upsertVideo(video, contaId, nicho.id, audio, "coleta", idDaExecucao);
            if (resultado === "novo") videosNovos += 1;
            else videosAtualizados += 1;
          } catch (erroItem) {
            erros.push(
              `tiktok / hashtag / nicho "${nicho.slug}" / item "${item.id ?? "sem id"}": ${erroItem instanceof Error ? erroItem.message : String(erroItem)}`,
            );
          }
        }
      } catch (erro) {
        erros.push(
          `tiktok / hashtag / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }

    if (!cabe()) continue;

    const vigiadasTiktok = await db()
      .select()
      .from(contas)
      .where(
        and(
          eq(contas.plataforma, "tiktok"),
          eq(contas.nichoId, nicho.id),
          eq(contas.vigiada, true),
        ),
      );

    if (vigiadasTiktok.length > 0 && cabe()) {
      chamadasTiktok += 1;
      try {
        const maxItens = Math.min(VIDEOS_POR_PERFIL_VIGILANCIA * vigiadasTiktok.length, teto - resultadosUsados);
        const { itens, devolvidos } = await buscarTiktokVigilancia(
          vigiadasTiktok.map((c) => c.handle),
          VIDEOS_POR_PERFIL_VIGILANCIA,
          maxItens,
        );
        resultadosUsados += itens.length;
        resultadosConsumidos += itens.length;
        resultadosDevolvidos += devolvidos;
        await registrarConsumo(itens.length);
        for (const item of itens) {
          try {
            const normalizado = normalizarVideoTiktok(item);
            if (!normalizado) {
              erros.push(
                `tiktok / vigilancia / nicho "${nicho.slug}" / item "${item.id ?? "sem id"}": sem nome do autor, pulado`,
              );
              continue;
            }
            const { video, conta, audio } = normalizado;
            const contaId = await upsertConta(conta, nicho.id);
            const resultado = await upsertVideo(video, contaId, nicho.id, audio, "coleta", idDaExecucao);
            if (resultado === "novo") videosNovos += 1;
            else videosAtualizados += 1;
          } catch (erroItem) {
            erros.push(
              `tiktok / vigilancia / nicho "${nicho.slug}" / item "${item.id ?? "sem id"}": ${erroItem instanceof Error ? erroItem.message : String(erroItem)}`,
            );
          }
        }
      } catch (erro) {
        erros.push(
          `tiktok / vigilancia / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }

    if (!cabe()) continue;

    /**
     * Com a Meta ativa (E6 parte 3, segunda rodada), a vigilancia do
     * Instagram vem da Business Discovery (`meta-contas.ts`, item 2) e a
     * descoberta de conta nova por hashtag e semanal, so pelo Apify
     * (`descoberta-instagram.ts`, item 4). O Instagram fica fora deste job
     * diario quando `metaAtivo`, para nao coletar (e pagar) duas vezes a
     * mesma coisa; sem a Meta, o Instagram continua inteiro aqui, todo dia,
     * como sempre foi.
     */
    if (config.coleta.metaAtivo) continue;

    const vigiadasInstagram = await db()
      .select()
      .from(contas)
      .where(
        and(
          eq(contas.plataforma, "instagram"),
          eq(contas.nichoId, nicho.id),
          eq(contas.vigiada, true),
        ),
      );

    if (nicho.termos.length > 0 || vigiadasInstagram.length > 0) {
      chamadasInstagram += 1;
      try {
        const maxItens = Math.min(config.coleta.apifyMaxItems, teto - resultadosUsados);
        const { itens, devolvidos } = await buscarInstagram(
          nicho.termos,
          vigiadasInstagram.map((c) => c.handle),
          maxItens,
        );
        resultadosUsados += itens.length;
        resultadosConsumidos += itens.length;
        resultadosDevolvidos += devolvidos;
        await registrarConsumo(itens.length);
        for (const item of itens) {
          try {
            const { video, conta, audio } = normalizarVideoInstagram(item);
            const contaId = await upsertConta(conta, nicho.id);
            const resultado = await upsertVideo(video, contaId, nicho.id, audio, "coleta", idDaExecucao);
            if (resultado === "novo") videosNovos += 1;
            else videosAtualizados += 1;
          } catch (erroItem) {
            erros.push(
              `instagram / nicho "${nicho.slug}" / item "${item.id}": ${erroItem instanceof Error ? erroItem.message : String(erroItem)}`,
            );
          }
        }
      } catch (erro) {
        erros.push(
          `instagram / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }
  }

  /**
   * Ajuste 4 da revisão do PR #36: com `apifyDesligado` ou sem orçamento
   * desde o início, zero chamadas é o estado esperado, não uma falha de
   * configuração; o `ErroColeta` fica só para quando havia orçamento e
   * nenhum nicho tinha termo nem conta vigiada mesmo assim.
   */
  if (!apifyDesligado && tinhaOrcamentoNoInicio && chamadasTiktok === 0 && chamadasInstagram === 0) {
    throw new ErroColeta(
      "nenhum termo nem conta vigiada para coletar no apify (nenhum nicho ativo tem termo nem conta vigiada)",
      false,
    );
  }
  if (videosNovos === 0 && videosAtualizados === 0 && erros.length > 0) {
    throw new ErroColeta(`coleta do apify falhou em tudo: ${erros.join("; ")}`, true);
  }

  return {
    nichos: nichosAtivos.length,
    chamadasTiktok,
    chamadasInstagram,
    videosNovos,
    videosAtualizados,
    resultadosDevolvidos,
    resultadosConsumidos,
    resultadosConsumidosHoje: resultadosUsados,
    apifyDesligado,
    tetoAtingido: !apifyDesligado && !cabe(),
    erros: erros.length > 0 ? erros : undefined,
  };
}
