/**
 * Job `temasDoDia` (etapa 10, fila `temas-do-dia`, diário 05:30 de
 * Brasília, decisão 2 do `PROXIMO.md`, depois de `transcrever`): por nicho
 * ativo, filtra as notícias das últimas 24h com a tarefa barata
 * `filtrarNoticias`, junta com o que está subindo hoje (com análise), e
 * chama a tarefa `temasDoDia` (modelo forte, com o modelo do nicho no bloco
 * estável, cache de prompt). Cada tema precisa citar pelo menos um id de
 * evidência que de fato foi enviado; se algum tema não citar, refaz a
 * chamada uma vez, e se falhar de novo o nicho fica sem tema novo (a regra
 * de estabilidade em `src/servicos/temas.ts` usa o de um dos últimos 3
 * dias). Sem `subindoHoje` e sem notícia relevante, o nicho não gera tema
 * (sem chamar a IA), e o resumo diz por quê.
 */
import { and, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import { nichos, noticias, temasDia, type TemaDoDia } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as filtrarNoticiasIA from "@/ia/prompts/filtrarNoticias";
import * as temasDoDiaIA from "@/ia/prompts/temasDoDia";
import { registrarGeracao } from "@/ia/registro";
import { hojeISO } from "@/lib/config";
import { formatarModeloNicho, modeloNichoAtual, subindoHojeComAnalise } from "@/servicos/pesquisa";

const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
const LIMITE_NOTICIAS = 60;
const LIMITE_SUBINDO = 30;

type NoticiaCandidata = { id: number; titulo: string; resumo: string | null };
type NichoAtivo = { id: number; slug: string; nome: string; termos: string[] };

async function noticiasCandidatas(nichoId: number): Promise<NoticiaCandidata[]> {
  return db()
    .select({ id: noticias.id, titulo: noticias.titulo, resumo: noticias.resumo })
    .from(noticias)
    .where(
      and(
        eq(noticias.nichoId, nichoId),
        gte(noticias.coletadoEm, new Date(Date.now() - VINTE_QUATRO_HORAS_MS)),
        isNull(noticias.relevante),
      ),
    )
    .limit(LIMITE_NOTICIAS);
}

/**
 * Chama `filtrarNoticias`, grava `relevante`/`angulo` em cada notícia (para
 * nunca reprocessar a mesma notícia dia depois de dia) e devolve só as
 * relevantes, no formato que `temasDoDia` espera.
 */
async function filtrarEGravarNoticias(
  nicho: NichoAtivo,
  candidatas: NoticiaCandidata[],
): Promise<{ titulo: string; resumo: string | null }[]> {
  if (candidatas.length === 0) return [];

  const resultado = await gerarEstruturado({
    tarefa: "filtrarNoticias",
    nivel: filtrarNoticiasIA.nivel,
    effort: filtrarNoticiasIA.esforco,
    schema: filtrarNoticiasIA.schema,
    sistemaEstavel: filtrarNoticiasIA.montarSistemaEstavel(),
    entrada: filtrarNoticiasIA.montarEntrada({
      nomeNicho: nicho.nome,
      termosNicho: nicho.termos,
      noticias: candidatas.map((n) => ({ titulo: n.titulo, resumo: n.resumo })),
    }),
  });

  await registrarGeracao({
    tarefa: "filtrarNoticias",
    versaoPrompt: filtrarNoticiasIA.versao,
    modelo: resultado.modelo,
    nivel: filtrarNoticiasIA.nivel,
    entradas: { nichoId: nicho.id, noticias: candidatas.length },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  const anguloPorIndice = new Map(resultado.dados.relevantes.map((r) => [r.indice, r.angulo]));

  for (const [i, candidata] of candidatas.entries()) {
    const angulo = anguloPorIndice.get(i + 1) ?? null;
    await db()
      .update(noticias)
      .set({ relevante: angulo !== null, angulo })
      .where(eq(noticias.id, candidata.id));
  }

  return candidatas
    .filter((_, i) => anguloPorIndice.has(i + 1))
    .map((n) => ({ titulo: n.titulo, resumo: n.resumo }));
}

/** Todo tema precisa citar ao menos uma evidencia que de fato foi enviada ao modelo. */
function evidenciaValida(temas: TemaDoDia[], idsValidos: Set<number>): boolean {
  return temas.every((tema) => tema.evidencias.length > 0 && tema.evidencias.every((id) => idsValidos.has(id)));
}

async function gerarTemasDoNicho(nicho: NichoAtivo): Promise<"gerado" | "sem_evidencia"> {
  const [subindo, candidatasNoticias] = await Promise.all([
    subindoHojeComAnalise(nicho.id, LIMITE_SUBINDO),
    noticiasCandidatas(nicho.id),
  ]);

  const noticiasRelevantes = await filtrarEGravarNoticias(nicho, candidatasNoticias);

  if (subindo.length === 0 && noticiasRelevantes.length === 0) {
    return "sem_evidencia";
  }

  const modeloNicho = await modeloNichoAtual(nicho.id);
  const idsValidos = new Set(subindo.map((v) => v.id));
  const sistemaEstavel = temasDoDiaIA.montarSistemaEstavel({
    modeloNicho: formatarModeloNicho(modeloNicho?.modelo ?? null),
  });
  const entrada = temasDoDiaIA.montarEntrada({
    subindoHoje: subindo,
    noticias: noticiasRelevantes.map((n) => ({ titulo: n.titulo, resumo: n.resumo ?? "" })),
  });

  const gerar = () =>
    gerarEstruturado({
      tarefa: "temasDoDia",
      nivel: temasDoDiaIA.nivel,
      effort: temasDoDiaIA.esforco,
      schema: temasDoDiaIA.schema,
      sistemaEstavel,
      entrada,
    });

  let resultado = await gerar();
  if (!evidenciaValida(resultado.dados.temas, idsValidos)) {
    resultado = await gerar();
    if (!evidenciaValida(resultado.dados.temas, idsValidos)) {
      throw new Error("tema sem evidencia valida depois de refazer a chamada uma vez");
    }
  }

  await registrarGeracao({
    tarefa: "temasDoDia",
    versaoPrompt: temasDoDiaIA.versao,
    modelo: resultado.modelo,
    nivel: temasDoDiaIA.nivel,
    entradas: { nichoId: nicho.id, subindoHoje: subindo.length, noticias: noticiasRelevantes.length },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  await db()
    .insert(temasDia)
    .values({ nichoId: nicho.id, data: hojeISO(), temas: resultado.dados.temas })
    .onConflictDoUpdate({
      target: [temasDia.nichoId, temasDia.data],
      set: { temas: resultado.dados.temas },
    });

  return "gerado";
}

export async function rodarTemasDoDia(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let gerados = 0;
  let semEvidencia = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    try {
      const resultado = await gerarTemasDoNicho(nicho);
      if (resultado === "gerado") gerados += 1;
      else semEvidencia += 1;
    } catch (erro) {
      falhas += 1;
      erros.push(`nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    nichos: nichosAtivos.length,
    gerados,
    semEvidencia,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
