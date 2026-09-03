/**
 * Coleta do Apify (etapa 6, parte 2): TikTok e Instagram, por termo do
 * nicho (hashtag, PROXIMO.md decisao 2) e por conta vigiada (perfil). Mesmo
 * padrao de idempotencia das outras coletas (ON CONFLICT em
 * plataforma+id_externo, `src/jobs/coleta-comum.ts`). Credito contado em
 * `consumo_api` com fonte "apify", em resultados devolvidos (nao em dolar,
 * decisao 4), TikTok e Instagram somados num teto diario so. Ao chegar no
 * teto, o job para (nao tenta mais nichos) e registra `tetoAtingido` no
 * resumo.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas, nichos } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { normalizarVideoInstagram } from "@/servicos/normalizadores/instagram";
import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";

import { buscarInstagram, buscarTiktok } from "./apify-api";
import { upsertConta, upsertVideo } from "./coleta-comum";
import { ErroColeta } from "./execucoes";

const FONTE = "apify";

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

export async function rodarColetaApify(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  const teto = config.coleta.apifyMaxResultadosDia;
  const maxPorChamada = config.coleta.apifyMaxItems;
  let resultadosUsados = await consumoDeHoje();
  const cabe = () => resultadosUsados < teto;

  let chamadasTiktok = 0;
  let chamadasInstagram = 0;
  let videosNovos = 0;
  let videosAtualizados = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    if (!cabe()) break;

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

    if (nicho.termos.length > 0 || vigiadasTiktok.length > 0) {
      chamadasTiktok += 1;
      try {
        const maxItens = Math.min(maxPorChamada, teto - resultadosUsados);
        const itens = await buscarTiktok(
          nicho.termos,
          vigiadasTiktok.map((c) => c.handle),
          maxItens,
        );
        resultadosUsados += itens.length;
        await registrarConsumo(itens.length);
        for (const item of itens) {
          try {
            const { video, conta, audio } = normalizarVideoTiktok(item);
            const contaId = await upsertConta(conta, nicho.id);
            const resultado = await upsertVideo(video, contaId, nicho.id, audio);
            if (resultado === "novo") videosNovos += 1;
            else videosAtualizados += 1;
          } catch (erroItem) {
            // Um item malformado nao pode derrubar o resto do lote (achado
            // rodando com chave real: um item do apify sem dado essencial).
            erros.push(
              `tiktok / nicho "${nicho.slug}" / item "${item.id}": ${erroItem instanceof Error ? erroItem.message : String(erroItem)}`,
            );
          }
        }
      } catch (erro) {
        erros.push(
          `tiktok / nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }

    if (!cabe()) continue;

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
        const maxItens = Math.min(maxPorChamada, teto - resultadosUsados);
        const itens = await buscarInstagram(
          nicho.termos,
          vigiadasInstagram.map((c) => c.handle),
          maxItens,
        );
        resultadosUsados += itens.length;
        await registrarConsumo(itens.length);
        for (const item of itens) {
          try {
            const { video, conta, audio } = normalizarVideoInstagram(item);
            const contaId = await upsertConta(conta, nicho.id);
            const resultado = await upsertVideo(video, contaId, nicho.id, audio);
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

  if (chamadasTiktok === 0 && chamadasInstagram === 0) {
    throw new ErroColeta(
      "nenhum termo nem conta vigiada para coletar no apify (sem nichos ativos ou teto diario zerado)",
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
    resultadosConsumidosHoje: resultadosUsados,
    tetoAtingido: !cabe(),
    erros: erros.length > 0 ? erros : undefined,
  };
}
