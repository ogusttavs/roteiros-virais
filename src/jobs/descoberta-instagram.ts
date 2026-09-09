/**
 * Job `descoberta-instagram` (E6 parte 3, segunda rodada, item 4): com a
 * Meta ativa, a busca por hashtag no Apify deixa de rodar todo dia dentro
 * de `coleta-apify.ts` (guarda do item 2) e vira so isto, uma vez por
 * semana, 30 resultados por termo do nicho.
 *
 * O efeito nas contas e so criar handle ainda desconhecido (nenhuma conta
 * ja existente e atualizada por este job: a vigilancia dela, se houver, ja
 * vem da Business Discovery em `meta-contas.ts`). O efeito nos videos segue
 * uma regra a parte: gravado sempre que a conta dona nao e coberta pela
 * API da Meta, seja porque acabou de ser descoberta agora (nunca lida pela
 * API) ou porque ja esta marcada `api_indisponivel_em` (pessoal ou com
 * restricao de idade, `meta-contas.ts` nunca mais tenta essas de novo, e
 * `contas-base` para de tentar assim que a base dela fica completa); e
 * pulado quando a conta ja e coberta (a Meta ja cuida do dado dela, mais
 * completo, de graca).
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { normalizarVideoInstagram } from "@/servicos/normalizadores/instagram";

import { buscarInstagram } from "./apify-api";
import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";

const FONTE = "apify";
const RESULTADOS_POR_TERMO = 30;

async function consumoDeHoje(): Promise<number> {
  const [linha] = await db()
    .select({ unidades: consumoApi.unidades })
    .from(consumoApi)
    .where(and(eq(consumoApi.fonte, FONTE), eq(consumoApi.data, hojeISO())));
  return linha?.unidades ?? 0;
}

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

/** `nichoId` (mesmo raciocinio das outras coletas): so aquele nicho, sem mudar o resto. */
export async function rodarDescobertaInstagram(nichoId?: number): Promise<Record<string, unknown>> {
  if (!config.coleta.metaAtivo) {
    throw new ErroColeta(
      "descoberta de conta nova no instagram pelo apify so roda com config.coleta.metaAtivo (sem a meta, o instagram inteiro ja e coletado todo dia por coleta-apify)",
      false,
    );
  }

  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select().from(nichos).where(condicao);

  const teto = config.coleta.apifyMaxResultadosDia;
  let resultadosUsados = await consumoDeHoje();
  let resultadosDevolvidos = 0;
  const cabe = () => resultadosUsados < teto;

  let termosBuscados = 0;
  let contasNovas = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    if (!cabe()) break;

    for (const termo of nicho.termos) {
      if (!cabe()) break;
      termosBuscados += 1;

      try {
        const { itens, devolvidos } = await buscarInstagram([termo], [], RESULTADOS_POR_TERMO);
        resultadosUsados += itens.length;
        resultadosDevolvidos += devolvidos;
        await registrarConsumo(itens.length);

        for (const item of itens) {
          try {
            const { video, conta, audio } = normalizarVideoInstagram(item);
            const [existente] = await db()
              .select({ id: contas.id, apiIndisponivelEm: contas.apiIndisponivelEm })
              .from(contas)
              .where(and(eq(contas.plataforma, "instagram"), eq(contas.handle, conta.handle)));

            // Conta ja coberta pela Meta: o dado dela ja vem, mais completo,
            // de graca por la (item 4, "os videos que ela traz nao sao
            // gravados se a conta ja e coberta pela API").
            if (existente && existente.apiIndisponivelEm === null) continue;

            const contaId = existente ? existente.id : await upsertConta(conta, nicho.id);
            if (!existente) contasNovas += 1;

            const resultado = await upsertVideo(video, contaId, nicho.id, audio);
            if (resultado === "novo") videosNovos += 1;
            else videosAtualizados += 1;
          } catch (erroItem) {
            erros.push(
              `instagram / nicho "${nicho.slug}" / termo "${termo}" / item "${item.id}": ${erroItem instanceof Error ? erroItem.message : String(erroItem)}`,
            );
          }
        }
      } catch (erro) {
        erros.push(
          `instagram / nicho "${nicho.slug}" / termo "${termo}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }
  }

  if (termosBuscados === 0) {
    throw new ErroColeta(
      "nenhum termo de nicho para descobrir conta nova no instagram (sem nichos ativos com termos, ou teto diario do apify ja zerado)",
      false,
    );
  }

  return {
    nichos: nichosAtivos.length,
    termosBuscados,
    contasNovas,
    videosNovos,
    videosAtualizados,
    resultadosDevolvidos,
    resultadosConsumidosHoje: resultadosUsados,
    tetoAtingido: !cabe(),
    erros: erros.length > 0 ? erros : undefined,
  };
}
