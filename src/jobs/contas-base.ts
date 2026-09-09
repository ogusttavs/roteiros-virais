/**
 * Job `contas-base` (E6 parte 3, item 5): a coleta por termo (hashtag) traz
 * so 1 a 2 vídeos por conta, então a maioria nunca chega aos 5 vídeos que
 * `pontuar.ts` exige para uma mediana de verdade. Este job faz o catch-up:
 * por nicho e por dia, pega as 30 contas que ainda não têm base (menos de
 * `MINIMO_VIDEOS_MEDIANA` vídeos nos últimos 90 dias, com pelo menos 1 vídeo
 * para priorizar por views) e busca até 10 vídeos recentes de cada. Roda
 * antes de `pontuar` na agenda, para a mediana de hoje já contar com o que
 * este job trouxe de manhã.
 *
 * YouTube por `playlistItems` do canal; TikTok sempre pelo Apify em modo
 * perfil (`buscarTiktok` com só um handle no array de perfis, sem
 * hashtag: o mesmo mecanismo que já busca as contas vigiadas). Instagram
 * pela Business Discovery da Meta quando `config.coleta.metaAtivo` (E6
 * parte 3, segunda rodada, item 2), com o Apify como reserva quando a
 * conta é pessoal ou tem restrição de idade (`contas.api_indisponivel_em`)
 * ou quando a Meta está desligada.
 *
 * O teto diário do Apify é a única trava do TikTok e do Instagram-por-Apify
 * (decisão do `PROXIMO.md`): ao bater, o job pula só as candidatas que
 * dependem dele (ajuste da revisão do PR #34, item 0b: antes o job inteiro
 * parava, e as candidatas do YouTube que vinham depois na lista nunca
 * recebiam catch-up nenhum enquanto o Apify estivesse pausado) e continua
 * tentando as do YouTube (e as do Instagram pela Meta), no nicho atual e
 * nos seguintes; `tetoAtingido` no resumo registra que isso aconteceu.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { buscarBusinessDiscovery, erroMetaEhDaConta, erroMetaEhTokenOuLimite, ErroMetaApi } from "@/jobs/meta-api";
import { config, hojeISO } from "@/lib/config";
import { normalizarVideoInstagram } from "@/servicos/normalizadores/instagram";
import { normalizarBusinessDiscovery } from "@/servicos/normalizadores/meta";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";
import { normalizarVideoYoutube } from "@/servicos/normalizadores/youtube";

import { buscarInstagram, buscarTiktok } from "./apify-api";
import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";
import { MINIMO_VIDEOS_MEDIANA } from "./pontuar";
import { buscarCanal, buscarUploadsDoCanal, buscarVideosPorId, CUSTO_LISTA } from "./youtube-api";

const CONTAS_POR_NICHO_POR_DIA = 30;
const VIDEOS_POR_CONTA = 10;
const FONTE_APIFY = "apify";
const FONTE_YOUTUBE = "youtube";

type ContaCandidata = {
  contaId: number;
  plataforma: "youtube" | "tiktok" | "instagram";
  handle: string;
  apiIndisponivelEm: Date | null;
};

async function contasCandidatas(nichoId: number): Promise<ContaCandidata[]> {
  const linhas = await db().execute<{
    conta_id: number;
    plataforma: "youtube" | "tiktok" | "instagram";
    handle: string;
    api_indisponivel_em: Date | null;
  }>(sql`
    SELECT c.id AS conta_id, c.plataforma, c.handle, c.api_indisponivel_em
    FROM contas c
    JOIN videos v ON v.conta_id = c.id AND v.publicado_em >= now() - interval '90 days'
    WHERE c.nicho_id = ${nichoId}
      AND c.base_completa_em IS NULL
    GROUP BY c.id, c.plataforma, c.handle, c.api_indisponivel_em
    HAVING count(v.id) < ${MINIMO_VIDEOS_MEDIANA}
    ORDER BY max(v.views) DESC
    LIMIT ${CONTAS_POR_NICHO_POR_DIA}
  `);
  return linhas.rows.map((l) => ({
    contaId: l.conta_id,
    plataforma: l.plataforma,
    handle: l.handle,
    apiIndisponivelEm: l.api_indisponivel_em,
  }));
}

/** Instagram usa o Apify so quando a Meta esta desligada, ou essa conta ja foi marcada indisponivel na API. */
function instagramUsaApify(candidata: ContaCandidata): boolean {
  return !config.coleta.metaAtivo || candidata.apiIndisponivelEm !== null;
}

/** TikTok e Instagram-por-Apify contam para o teto diario do Apify; YouTube e Instagram-por-Meta nao. */
function usaApify(candidata: ContaCandidata): boolean {
  if (candidata.plataforma === "tiktok") return true;
  if (candidata.plataforma === "instagram") return instagramUsaApify(candidata);
  return false;
}

async function consumoDeHoje(fonte: string): Promise<number> {
  const [linha] = await db()
    .select({ unidades: consumoApi.unidades })
    .from(consumoApi)
    .where(and(eq(consumoApi.fonte, fonte), eq(consumoApi.data, hojeISO())));
  return linha?.unidades ?? 0;
}

async function registrarConsumo(fonte: string, unidades: number): Promise<void> {
  if (unidades === 0) return;
  await db()
    .insert(consumoApi)
    .values({ fonte, data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

async function marcarBaseCompleta(contaId: number): Promise<void> {
  await db().update(contas).set({ baseCompletaEm: new Date() }).where(eq(contas.id, contaId));
}

/**
 * `usadosApify` e o que de fato conta para `consumo_api` e para o teto (o
 * mesmo `itens.length`, ja cortado, que `coleta-apify.ts` usa: decisao 4
 * da etapa 6, "o teto e o que processamos"); `devolvidosApify` e so
 * telemetria, o bruto do Apify antes do corte (ajuste da revisao do PR
 * #34, item 0c: antes este job registrava `devolvidos` como consumo, uma
 * regua diferente da coleta).
 */
type ResultadoCatchUp = {
  novos: number;
  atualizados: number;
  usadosApify: number;
  devolvidosApify: number;
  /**
   * A Meta falhou para essa conta (marcada indisponivel) e o teto do Apify
   * ja nao cabe mais nada hoje (correcao 4 da leitura previa): a conta fica
   * sem base completa, para tentar de novo amanha (a Meta ja marcou
   * `apiIndisponivelEm`, entao amanha ela vai direto para o caminho do
   * Apify, sujeito ao mesmo teto).
   */
  tetoAtingido?: boolean;
};

async function catchUpTiktok(nichoId: number, candidata: ContaCandidata): Promise<ResultadoCatchUp> {
  const { itens, devolvidos } = await buscarTiktok([], [candidata.handle], VIDEOS_POR_CONTA);
  await registrarConsumo(FONTE_APIFY, itens.length);

  let novos = 0;
  let atualizados = 0;
  for (const item of itens) {
    const normalizado = normalizarVideoTiktok(item);
    if (!normalizado) continue;
    const { video, conta, audio } = normalizado;
    const contaId = await upsertConta(conta, nichoId);
    const resultado = await upsertVideo(video, contaId, nichoId, audio);
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: itens.length, devolvidosApify: devolvidos };
}

/**
 * Business Discovery da Meta em vez do Apify (E6 parte 3, segunda rodada,
 * item 2): uma conta, um perfil e ate 50 posts de uma vez, de graca. Sem
 * `discovery`, lanca (item 0b da revisao do PR #35): o chamador
 * (`catchUpInstagram`) nao e um `ErroMetaApi`, entao sobe direto para
 * `rodarContasBase`, que registra em `erros` e NAO marca a conta como base
 * completa, para ela ser tentada de novo no dia seguinte. Antes disto, a
 * funcao devolvia um resultado vazio "de sucesso", e a conta era marcada
 * completa sem nunca ter recebido nenhum dado.
 */
async function catchUpInstagramMeta(nichoId: number, candidata: ContaCandidata): Promise<ResultadoCatchUp> {
  const discovery = await buscarBusinessDiscovery(candidata.handle);
  if (!discovery) throw new Error("business discovery sem dado");

  const { conta, videos: videosNormalizados } = normalizarBusinessDiscovery(candidata.handle, discovery);
  const contaId = await upsertConta(conta, nichoId);
  await db().update(contas).set({ ultimaLeituraMetaEm: new Date() }).where(eq(contas.id, contaId));

  let novos = 0;
  let atualizados = 0;
  for (const video of videosNormalizados) {
    const resultado = await upsertVideo(video, contaId, nichoId, null, "meta");
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: 0, devolvidosApify: 0 };
}

async function catchUpInstagram(
  nichoId: number,
  candidata: ContaCandidata,
  apifyCabe: () => boolean,
): Promise<ResultadoCatchUp> {
  if (!instagramUsaApify(candidata)) {
    try {
      return await catchUpInstagramMeta(nichoId, candidata);
    } catch (erro) {
      if (!(erro instanceof ErroMetaApi)) throw erro;
      /**
       * Classificacao do erro (achado da leitura previa do Fable, correcao
       * 1): token vencido ou limite de taxa afeta a chamada inteira, entao
       * para o job na hora (`ErroColeta` retentavel) em vez de marcar
       * qualquer conta; erro de outra natureza so registra e segue, sem
       * marcar nem cair para o Apify (a conta continua tentando a Meta
       * amanha).
       */
      if (erroMetaEhTokenOuLimite(erro)) {
        throw new ErroColeta(`meta api indisponivel (codigo ${erro.codigo}): ${erro.message}`, true);
      }
      if (!erroMetaEhDaConta(erro)) throw erro;

      // Conta pessoal ou com restricao de idade: marca indisponivel e cai
      // para o Apify abaixo, na mesma tentativa, se ainda couber no teto.
      await db().update(contas).set({ apiIndisponivelEm: new Date() }).where(eq(contas.id, candidata.contaId));
      /**
       * Correcao 4 da leitura previa: sem isso, com o teto do Apify em
       * zero (como esta enquanto o Instagram passa pela Meta), a queda para
       * o Apify abaixo pagava mesmo assim, ignorando o teto diario.
       */
      if (!apifyCabe()) {
        return { novos: 0, atualizados: 0, usadosApify: 0, devolvidosApify: 0, tetoAtingido: true };
      }
    }
  }

  const { itens, devolvidos } = await buscarInstagram([], [candidata.handle], VIDEOS_POR_CONTA);
  await registrarConsumo(FONTE_APIFY, itens.length);

  let novos = 0;
  let atualizados = 0;
  for (const item of itens) {
    const { video, conta, audio } = normalizarVideoInstagram(item);
    const contaId = await upsertConta(conta, nichoId);
    const resultado = await upsertVideo(video, contaId, nichoId, audio);
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: itens.length, devolvidosApify: devolvidos };
}

/**
 * `playlistItems` já devolve do mais novo para o mais antigo (mesma
 * suposição de `coleta-youtube.ts`); os 10 primeiros da fixture de uploads
 * são os 10 mais recentes. Sem trava de cota (o teto diário do Apify é a
 * única trava do job, decisão do `PROXIMO.md`); o custo por conta (3
 * chamadas de 1 unidade) é desprezível contra a cota de 9000 do dia.
 */
async function catchUpYoutube(nichoId: number, candidata: ContaCandidata): Promise<ResultadoCatchUp> {
  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const canalResp = await buscarCanal(candidata.handle);
  const canal = canalResp.items?.[0];
  if (!canal) return { novos: 0, atualizados: 0, usadosApify: 0, devolvidosApify: 0 };

  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const uploadsResp = await buscarUploadsDoCanal(canal.contentDetails.relatedPlaylists.uploads);
  const ids = (uploadsResp.items ?? []).slice(0, VIDEOS_POR_CONTA).map((item) => item.snippet.resourceId.videoId);
  if (ids.length === 0) return { novos: 0, atualizados: 0, usadosApify: 0, devolvidosApify: 0 };

  await registrarConsumo(FONTE_YOUTUBE, CUSTO_LISTA);
  const videosResp = await buscarVideosPorId(ids);

  let novos = 0;
  let atualizados = 0;
  for (const item of videosResp.items ?? []) {
    const { video, conta } = normalizarVideoYoutube(item);
    const contaId = await upsertConta(conta, nichoId);
    const resultado = await upsertVideo(video, contaId, nichoId);
    if (resultado === "novo") novos += 1;
    else atualizados += 1;
  }
  return { novos, atualizados, usadosApify: 0, devolvidosApify: 0 };
}

export async function rodarContasBase(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  const teto = config.coleta.apifyMaxResultadosDia;
  let resultadosApifyUsados = await consumoDeHoje(FONTE_APIFY);
  let resultadosApifyDevolvidos = 0;
  const apifyCabe = () => resultadosApifyUsados < teto;

  let contasProcessadas = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  let tetoAtingido = false;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    const candidatas = await contasCandidatas(nicho.id);
    for (const candidata of candidatas) {
      if (usaApify(candidata) && !apifyCabe()) {
        tetoAtingido = true;
        continue;
      }

      try {
        const resultado =
          candidata.plataforma === "tiktok"
            ? await catchUpTiktok(nicho.id, candidata)
            : candidata.plataforma === "instagram"
              ? await catchUpInstagram(nicho.id, candidata, apifyCabe)
              : await catchUpYoutube(nicho.id, candidata);

        resultadosApifyUsados += resultado.usadosApify;
        resultadosApifyDevolvidos += resultado.devolvidosApify;
        videosNovos += resultado.novos;
        videosAtualizados += resultado.atualizados;
        if (resultado.tetoAtingido) {
          tetoAtingido = true;
        } else {
          await marcarBaseCompleta(candidata.contaId);
          contasProcessadas += 1;
        }
      } catch (erro) {
        /**
         * Token vencido ou limite de taxa da Meta (correcao 1 da leitura
         * previa): para o job na hora, em vez de engolir e seguir tentando
         * as outras candidatas, que falhariam do mesmo jeito.
         */
        if (erro instanceof ErroColeta) throw erro;
        erros.push(
          `${candidata.plataforma} "${candidata.handle}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }
  }

  if (nichosAtivos.length === 0) {
    throw new ErroColeta("nenhum nicho ativo para o job contas-base", false);
  }

  return {
    nichos: nichosAtivos.length,
    contasProcessadas,
    videosNovos,
    videosAtualizados,
    resultadosApifyDevolvidos,
    tetoAtingido,
    erros: erros.length > 0 ? erros : undefined,
  };
}
