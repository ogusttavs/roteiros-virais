/**
 * Regras do briefing (briefing-e-rubricas.md, secoes 3 e 4; plano de
 * execucao, etapa 5): rascunho sem IA, avaliar uma resposta com verificador,
 * nota geral ponderada, gate de liberacao, perfil compilado e camada
 * exclusiva.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { briefings, clientes, type AvaliacaoResposta, type Briefing } from "@/db/schema";
import * as avaliarRespostaIA from "@/ia/prompts/avaliarResposta";
import * as compilarPerfilIA from "@/ia/prompts/compilarPerfil";
import { gerarComVerificacao } from "@/ia/verificador";
import { config } from "@/lib/config";

import { perguntaPorId, PERGUNTAS_BRIEFING } from "../config/briefing";

import { calcularNotaGeral, perguntaQueMaisAjuda, blocoInicial } from "./briefing-regras";
import { clientePorId } from "./clientes";

export { calcularNotaGeral, perguntaQueMaisAjuda, blocoInicial };

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
 * Salva o texto da resposta sem chamar IA (debounce fica na tela). Mesclagem
 * atomica no proprio SQL (revisao da parte 1): duas chamadas em sequencia
 * rapida, uma por pergunta, gravavam sobre o objeto lido pela outra e podiam
 * perder uma resposta. O operador `||` do jsonb mescla so a chave desta
 * pergunta, sem ler o resto do objeto antes.
 *
 * Se o texto do rascunho for diferente do que ja estava salvo, a avaliacao
 * guardada desta pergunta e apagada na mesma escrita. Achado no teste manual
 * desta parte: sem isto, um rascunho que muda o texto depois de uma edicao
 * podia deixar `avaliacoes[perguntaId]` de uma resposta antiga ao lado de
 * `respostas[perguntaId]` com o texto novo, e o "reusa a avaliacao guardada"
 * de `avaliarResposta` (que compara so o texto) reusava a nota errada em vez
 * de chamar a IA de novo. O `case` roda sobre o valor antigo da linha, dentro
 * do mesmo UPDATE, entao a comparacao e sempre com o que estava salvo antes
 * desta escrita.
 */
export async function salvarRascunho(
  clienteId: number,
  perguntaId: string,
  resposta: string,
): Promise<void> {
  if (!perguntaPorId(perguntaId)) {
    throw new ErroBriefing(`pergunta desconhecida: ${perguntaId}`);
  }
  const briefing = await garantirBriefing(clienteId);
  await db()
    .update(briefings)
    .set({
      respostas: sql`${briefings.respostas} || ${JSON.stringify({ [perguntaId]: resposta })}::jsonb`,
      avaliacoes: sql`case
        when ${briefings.respostas} ->> ${perguntaId} is distinct from ${resposta}
        then ${briefings.avaliacoes} - ${perguntaId}
        else ${briefings.avaliacoes}
      end`,
      atualizadoEm: new Date(),
    })
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
 *
 * O gate e de mao unica (revisao da parte 1): uma vez `completo = true`, uma
 * edicao que derruba a nota geral abaixo da meta nunca volta a fechar o
 * painel do cliente.
 *
 * A leitura e a escrita que recalculam a nota geral rodam dentro de uma
 * transacao com `SELECT ... FOR UPDATE` (revisao da parte 1): duas avaliacoes
 * na mesma pergunta ou em perguntas diferentes, disparadas quase juntas (a
 * tela avalia ao sair do campo), liam o mesmo objeto `avaliacoes` antigo e a
 * que gravava por ultimo apagava a da outra. A chamada de IA, que e a parte
 * lenta, roda antes da transacao comecar, para o lock nao segurar a espera
 * da rede.
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

  const { respostas, notaGeral, completo } = await db().transaction(async (tx) => {
    const [linha] = await tx
      .select()
      .from(briefings)
      .where(eq(briefings.id, briefing.id))
      .for("update");
    if (!linha) throw new ErroBriefing("briefing nao encontrado.");

    const respostas = { ...linha.respostas, [perguntaId]: resposta };
    const avaliacoes = { ...linha.avaliacoes, [perguntaId]: avaliacao };
    const notaGeral = calcularNotaGeral(avaliacoes);
    const completo = linha.completo || notaGeral >= config.regras.notaMinimaBriefing;

    await tx
      .update(briefings)
      .set({
        respostas,
        avaliacoes,
        notaGeral: notaGeral.toFixed(2),
        completo,
        atualizadoEm: new Date(),
      })
      .where(eq(briefings.id, briefing.id));

    return { respostas, notaGeral, completo };
  });

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
