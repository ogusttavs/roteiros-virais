/**
 * Regras do briefing (briefing-e-rubricas.md, secoes 3 e 4; plano de
 * execucao, etapa 5): rascunho sem IA, avaliar uma resposta com verificador,
 * nota geral ponderada, gate de liberacao, perfil compilado e camada
 * exclusiva.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { briefings, clientes, type AvaliacaoResposta, type Briefing } from "@/db/schema";
import * as avaliarRespostaIA from "@/ia/prompts/avaliarResposta";
import * as compilarPerfilIA from "@/ia/prompts/compilarPerfil";
import { gerarComVerificacao } from "@/ia/verificador";
import { config } from "@/lib/config";

import { perguntaPorId, PERGUNTAS_BRIEFING } from "../config/briefing";

import { clientePorId } from "./clientes";

export class ErroBriefing extends Error {}

/** Cria a linha do briefing na primeira visita; depois so le e atualiza. */
export async function garantirBriefing(clienteId: number): Promise<Briefing> {
  const existente = await buscarBriefing(clienteId);
  if (existente) return existente;

  const [criado] = await db()
    .insert(briefings)
    .values({ clienteId })
    .onConflictDoNothing()
    .returning();
  if (criado) return criado;

  const linha = await buscarBriefing(clienteId);
  if (!linha) throw new ErroBriefing("nao foi possivel criar o briefing.");
  return linha;
}

async function buscarBriefing(clienteId: number): Promise<Briefing | null> {
  const [linha] = await db().select().from(briefings).where(eq(briefings.clienteId, clienteId));
  return linha ?? null;
}

/**
 * Nota geral ponderada (secao 4): media ponderada das doze notas, P1, P5,
 * P9 e P11 pesam 2. Pergunta sem avaliacao ainda conta nota 0 na media.
 */
export function calcularNotaGeral(avaliacoes: Record<string, AvaliacaoResposta>): number {
  const somaPesos = PERGUNTAS_BRIEFING.reduce((soma, p) => soma + p.peso, 0);
  const somaPonderada = PERGUNTAS_BRIEFING.reduce(
    (soma, p) => soma + p.peso * (avaliacoes[p.id]?.nota ?? 0),
    0,
  );
  return Math.round((somaPonderada / somaPesos) * 100) / 100;
}

/** Salva o texto da resposta sem chamar IA (debounce fica na tela). */
export async function salvarRascunho(
  clienteId: number,
  perguntaId: string,
  resposta: string,
): Promise<void> {
  if (!perguntaPorId(perguntaId)) {
    throw new ErroBriefing(`pergunta desconhecida: ${perguntaId}`);
  }
  const briefing = await garantirBriefing(clienteId);
  const respostas = { ...briefing.respostas, [perguntaId]: resposta };
  await db()
    .update(briefings)
    .set({ respostas, atualizadoEm: new Date() })
    .where(eq(briefings.id, briefing.id));
}

export type ResultadoAvaliarResposta = {
  avaliacao: AvaliacaoResposta;
  notaGeral: number;
  completo: boolean;
  /** true quando a resposta nao mudou e a avaliacao guardada foi reusada, sem chamar IA. */
  reusada: boolean;
};

/**
 * Avalia uma resposta (ou reusa a avaliacao guardada se o texto nao mudou),
 * recalcula a nota geral, atualiza o gate de liberacao e, quando o
 * briefing esta completo depois de uma avaliacao nova, recompila o perfil.
 */
export async function avaliarResposta(
  clienteId: number,
  perguntaId: string,
  resposta: string,
): Promise<ResultadoAvaliarResposta> {
  const pergunta = perguntaPorId(perguntaId);
  if (!pergunta) {
    throw new ErroBriefing(`pergunta desconhecida: ${perguntaId}`);
  }

  const briefing = await garantirBriefing(clienteId);
  const avaliacaoGuardada = briefing.avaliacoes[perguntaId];
  const respostaGuardada = briefing.respostas[perguntaId];

  let avaliacao: AvaliacaoResposta;
  let reusada = false;

  if (avaliacaoGuardada && respostaGuardada === resposta) {
    avaliacao = avaliacaoGuardada;
    reusada = true;
  } else {
    avaliacao = await gerarComVerificacao({
      tarefa: "avaliarResposta",
      nivel: avaliarRespostaIA.nivel,
      effort: avaliarRespostaIA.esforco,
      versaoPrompt: avaliarRespostaIA.versao,
      clienteId,
      schema: avaliarRespostaIA.schema,
      sistemaEstavel: avaliarRespostaIA.montarSistemaEstavel(),
      entrada: avaliarRespostaIA.montarEntrada({
        pergunta: pergunta.enunciado,
        oQueAIAProcura: pergunta.oQueAIAProcura,
        resposta,
      }),
      extrairCampos: (d) => ({ bom: d.bom, melhorar: d.melhorar, como: d.como, impacto: d.impacto }),
    });
  }

  const respostas = { ...briefing.respostas, [perguntaId]: resposta };
  const avaliacoes = { ...briefing.avaliacoes, [perguntaId]: avaliacao };
  const notaGeral = calcularNotaGeral(avaliacoes);
  const completo = notaGeral >= config.regras.notaMinimaBriefing;

  await db()
    .update(briefings)
    .set({
      respostas,
      avaliacoes,
      notaGeral: notaGeral.toFixed(2),
      completo,
      atualizadoEm: new Date(),
    })
    .where(eq(briefings.id, briefing.id));

  if (completo && !reusada) {
    await compilarEGravarPerfil(clienteId, briefing.id, respostas);
  }

  return { avaliacao, notaGeral, completo, reusada };
}

/**
 * Perfil compilado (secao 4) e camada exclusiva (concorrentes e perfis
 * admirados de secao 5.9.1, mais cidade, bairro e o que vende como termos
 * de busca, escopo 5.6). Roda na liberacao e a cada edicao posterior.
 */
async function compilarEGravarPerfil(
  clienteId: number,
  briefingId: number,
  respostas: Record<string, string>,
): Promise<void> {
  const respostasPorEnunciado: Record<string, string> = {};
  for (const pergunta of PERGUNTAS_BRIEFING) {
    respostasPorEnunciado[pergunta.enunciado] = respostas[pergunta.id] ?? "";
  }

  const perfil = await gerarComVerificacao({
    tarefa: "compilarPerfil",
    nivel: compilarPerfilIA.nivel,
    effort: compilarPerfilIA.esforco,
    versaoPrompt: compilarPerfilIA.versao,
    clienteId,
    schema: compilarPerfilIA.schema,
    sistemaEstavel: compilarPerfilIA.montarSistemaEstavel(),
    entrada: compilarPerfilIA.montarEntrada({ respostas: respostasPorEnunciado }),
    extrairCampos: (d) => ({ resumo: d.resumo }),
  });

  await db().update(briefings).set({ perfil }).where(eq(briefings.id, briefingId));

  const cliente = await clientePorId(clienteId);
  const termos = [cliente?.cidade, cliente?.bairro, perfil.fatos.oQueVende].filter(
    (termo): termo is string => Boolean(termo?.trim()),
  );

  await db()
    .update(clientes)
    .set({
      camadaExclusiva: {
        concorrentes: perfil.fatos.concorrentes,
        perfisAdmirados: perfil.fatos.perfisAdmirados,
        termos,
      },
    })
    .where(eq(clientes.id, clienteId));
}
