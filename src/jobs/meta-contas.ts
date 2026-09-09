/**
 * Job `meta-contas` (E6 parte 3, segunda rodada, item 2): a fonte da
 * vigilância do Instagram deixa de ser o Apify e passa a ser a Business
 * Discovery da Meta, uma conta vigiada por dia (uma chamada cada,
 * "50 contas vigiadas gastam 50 chamadas por dia", `estrategia/plano-de-execucao.md`,
 * item i). So roda quando `config.coleta.metaAtivo`; sem isso `rodarMetaContas`
 * lança `ErroColeta` (nao retentavel) em vez de fazer nada, e quem agenda
 * (`agenda.ts`) nem chega a inscrever o cron.
 *
 * Conta pessoal ou com restrição de idade: a Business Discovery devolve
 * erro (`ErroMetaApi`), marca `contas.api_indisponivel_em` e a conta volta
 * a ser coberta pelo Apify no `coleta-apify.ts` normal.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { contas, nichos } from "@/db/schema";
import { buscarBusinessDiscovery, ErroMetaApi } from "@/jobs/meta-api";
import { config } from "@/lib/config";
import { normalizarBusinessDiscovery } from "@/servicos/normalizadores/meta";

import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";

/** `nichoId` (etapa 24, parte 1): mesmo raciocinio de `rodarColetaYoutube`. */
export async function rodarMetaContas(nichoId?: number): Promise<Record<string, unknown>> {
  if (!config.coleta.metaAtivo) {
    throw new ErroColeta(
      "META_ATIVO nao esta ligado (ou faltam META_IG_ID/META_TOKEN); o Instagram continua pelo Apify",
      false,
    );
  }

  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select().from(nichos).where(condicao);

  let contasLidas = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  let viewsTotais = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const vigiadas = await db()
      .select()
      .from(contas)
      .where(
        and(
          eq(contas.plataforma, "instagram"),
          eq(contas.nichoId, nicho.id),
          eq(contas.vigiada, true),
          isNull(contas.apiIndisponivelEm),
        ),
      );

    for (const conta of vigiadas) {
      try {
        const discovery = await buscarBusinessDiscovery(conta.handle);
        if (!discovery) {
          erros.push(`instagram / "${conta.handle}": business discovery sem dado`);
          continue;
        }

        const { conta: contaNormalizada, videos: videosNormalizados } = normalizarBusinessDiscovery(
          conta.handle,
          discovery,
        );
        const contaId = await upsertConta(contaNormalizada, nicho.id);
        await db().update(contas).set({ ultimaLeituraMetaEm: new Date() }).where(eq(contas.id, contaId));

        for (const video of videosNormalizados) {
          const resultado = await upsertVideo(video, contaId, nicho.id, null, "meta");
          if (resultado === "novo") videosNovos += 1;
          else videosAtualizados += 1;
          viewsTotais += video.views;
        }
        contasLidas += 1;
      } catch (erro) {
        if (erro instanceof ErroMetaApi) {
          await db().update(contas).set({ apiIndisponivelEm: new Date() }).where(eq(contas.id, conta.id));
        }
        erros.push(`instagram / "${conta.handle}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  return {
    nichos: nichosAtivos.length,
    contasLidas,
    videosNovos,
    videosAtualizados,
    viewsTotais,
    erros: erros.length > 0 ? erros : undefined,
  };
}
