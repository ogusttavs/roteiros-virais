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
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { contas, nichos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import { buscarBusinessDiscovery, erroMetaEhDaConta, erroMetaEhTokenOuLimite, ErroMetaApi, PausaDaMeta } from "@/jobs/meta-api";
import { config } from "@/lib/config";
import { normalizarBusinessDiscovery } from "@/servicos/normalizadores/meta";

import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";
import { agendarRetomadaDaMeta } from "./meta-retomada";

/**
 * `nichoId` (etapa 24, parte 1): mesmo raciocinio de `rodarColetaYoutube`.
 *
 * `retomada` (o limite do aplicativo na Meta): quando a Meta passa de 80% do limite, a rotina para com o motivo "limite da Meta, continua na próxima hora" (não é erro),
 * enfileira a si mesma para depois da pausa e a retomada pula as contas que já foram lidas desde o começo da primeira passada (`desde`), em vez de recomeçar do zero.
 */
export async function rodarMetaContas(nichoId?: number, retomada?: { desde?: string }): Promise<Record<string, unknown>> {
  if (!config.coleta.metaAtivo) {
    throw new ErroColeta(
      "META_ATIVO nao esta ligado (ou faltam META_IG_ID/META_TOKEN); o Instagram continua pelo Apify",
      false,
    );
  }

  const condicao = nichoId ? and(eq(nichos.ativo, true), eq(nichos.id, nichoId)) : eq(nichos.ativo, true);
  const nichosAtivos = await db().select().from(nichos).where(condicao);
  const desdeDaPassada = retomada?.desde && !Number.isNaN(new Date(retomada.desde).getTime()) ? new Date(retomada.desde) : new Date();
  let pausa: PausaDaMeta | null = null;
  let contasQueFaltam = 0;

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
          // Na retomada, quem já foi lido desde o começo da primeira passada fica para a próxima rotina.
          retomada?.desde ? or(isNull(contas.ultimaLeituraMetaEm), lt(contas.ultimaLeituraMetaEm, desdeDaPassada)) : undefined,
        ),
      )
      .orderBy(asc(contas.id));

    for (const conta of vigiadas) {
      if (pausa) {
        contasQueFaltam += 1;
        continue;
      }
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
        /**
         * Classificacao do erro (achado da leitura previa do Fable,
         * correcao 1): token vencido ou limite de taxa afeta TODAS as
         * contas, nao so esta, entao para o job na hora (`ErroColeta`
         * retentavel) em vez de marcar `apiIndisponivelEm` em todas as
         * contas vigiadas uma a uma. So um erro da propria conta (pessoal
         * ou com restricao de idade) marca ela como indisponivel.
         */
        if (erro instanceof PausaDaMeta) {
          // Não é erro: a conta atual não foi lida e a rotina continua na hora seguinte.
          pausa = erro;
          contasQueFaltam += 1;
          continue;
        }
        if (erro instanceof ErroMetaApi) {
          if (erroMetaEhTokenOuLimite(erro)) {
            throw new ErroColeta(`meta api indisponivel (codigo ${erro.codigo}): ${erro.message}`, true);
          }
          if (erroMetaEhDaConta(erro)) {
            await db().update(contas).set({ apiIndisponivelEm: new Date() }).where(eq(contas.id, conta.id));
          }
        }
        erros.push(`instagram / "${conta.handle}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  if (pausa) {
    const agendou = await agendarRetomadaDaMeta(FILAS.metaContas, { ...(nichoId ? { nichoId } : {}), retomadaDesde: desdeDaPassada.toISOString() }, pausa.retomaEm);
    return {
      pausadoPorLimite: true,
      motivo: pausa.motivo,
      retomaEm: pausa.retomaEm.toISOString(),
      retomadaAgendada: agendou,
      contasQueFaltam,
      nichos: nichosAtivos.length,
      contasLidas,
      videosNovos,
      videosAtualizados,
      viewsTotais,
      erros: erros.length > 0 ? erros : undefined,
    };
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
