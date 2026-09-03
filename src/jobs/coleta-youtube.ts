/**
 * Coleta do YouTube (etapa 6): por termo do nicho (search.list, ultimos 7
 * dias, so vertical curto) e por canal vigiado (playlistItems da playlist
 * de uploads), depois videos.list em lote para estatisticas e duracao.
 * Idempotente (ON CONFLICT em plataforma+id_externo, atualiza views, likes,
 * comentarios). Para de gastar cota ao chegar perto do limite diario.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { normalizarVideoYoutube } from "@/servicos/normalizadores/youtube";

import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";
import {
  buscarCanal,
  buscarPorTermo,
  buscarUploadsDoCanal,
  buscarVideosPorId,
  CUSTO_LISTA,
  CUSTO_SEARCH,
} from "./youtube-api";

const LIMITE_DIARIO_UNIDADES = 9000;
const JANELA_DIAS = 7;
const FONTE = "youtube";

async function consumoDeHoje(): Promise<number> {
  const [linha] = await db()
    .select({ unidades: consumoApi.unidades })
    .from(consumoApi)
    .where(and(eq(consumoApi.fonte, FONTE), eq(consumoApi.data, hojeISO())));
  return linha?.unidades ?? 0;
}

async function registrarConsumo(unidades: number): Promise<void> {
  await db()
    .insert(consumoApi)
    .values({ fonte: FONTE, data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

export async function rodarColetaYoutube(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));
  const publicadoApos = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000);

  let unidadesUsadas = await consumoDeHoje();
  let termosBuscados = 0;
  let canaisChecados = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  const erros: string[] = [];

  const cabe = (custo: number) => unidadesUsadas + custo <= LIMITE_DIARIO_UNIDADES;
  async function gastar(custo: number): Promise<void> {
    unidadesUsadas += custo;
    await registrarConsumo(custo);
  }

  for (const nicho of nichosAtivos) {
    const idsCandidatos = new Set<string>();

    for (const termo of nicho.termos) {
      if (!cabe(CUSTO_SEARCH)) break;
      termosBuscados += 1;
      try {
        /**
         * A cota e contada antes da chamada (revisao da etapa 6, parte 1,
         * PROXIMO.md): a API do YouTube desconta a unidade mesmo quando a
         * chamada falha, entao gastar depois do await subestimaria o gasto
         * real numa falha de rede.
         */
        await gastar(CUSTO_SEARCH);
        const resultado = await buscarPorTermo(termo, publicadoApos);
        for (const item of resultado.items ?? []) {
          if (item.id.videoId) idsCandidatos.add(item.id.videoId);
        }
      } catch (erro) {
        erros.push(`termo "${termo}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }

    const contasVigiadas = await db()
      .select()
      .from(contas)
      .where(and(eq(contas.plataforma, "youtube"), eq(contas.nichoId, nicho.id), eq(contas.vigiada, true)));

    for (const conta of contasVigiadas) {
      if (!cabe(CUSTO_LISTA * 2)) break;
      canaisChecados += 1;
      try {
        await gastar(CUSTO_LISTA);
        const canalResp = await buscarCanal(conta.handle);
        /**
         * Achado rodando com chave real: um handle que nao existe de verdade
         * (as contas do seed sao ficticias) volta sem o campo `items` (nem
         * um array vazio), nao so com zero resultados nele.
         */
        const canal = canalResp.items?.[0];
        if (!canal) continue;

        await gastar(CUSTO_LISTA);
        const uploadsResp = await buscarUploadsDoCanal(canal.contentDetails.relatedPlaylists.uploads);
        for (const item of uploadsResp.items ?? []) {
          idsCandidatos.add(item.snippet.resourceId.videoId);
        }
      } catch (erro) {
        erros.push(`canal "${conta.handle}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }

    const ids = [...idsCandidatos];
    for (let i = 0; i < ids.length; i += 50) {
      if (!cabe(CUSTO_LISTA)) break;
      const lote = ids.slice(i, i + 50);
      try {
        await gastar(CUSTO_LISTA);
        const resposta = await buscarVideosPorId(lote);
        for (const item of resposta.items ?? []) {
          const { video, conta } = normalizarVideoYoutube(item);
          const contaId = await upsertConta(conta, nicho.id);
          const resultado = await upsertVideo(video, contaId, nicho.id);
          if (resultado === "novo") videosNovos += 1;
          else videosAtualizados += 1;
        }
      } catch (erro) {
        erros.push(`videos.list (lote a partir de ${i}): ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  if (termosBuscados === 0 && canaisChecados === 0) {
    throw new ErroColeta("nenhum termo nem canal para coletar (sem nichos ativos ou cota diaria zerada)", false);
  }
  if (videosNovos === 0 && videosAtualizados === 0 && erros.length > 0) {
    throw new ErroColeta(`coleta do youtube falhou em tudo: ${erros.join("; ")}`, true);
  }

  return {
    nichos: nichosAtivos.length,
    termosBuscados,
    canaisChecados,
    videosNovos,
    videosAtualizados,
    unidadesConsumidasHoje: unidadesUsadas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
