/**
 * Regras do briefing (briefing-e-rubricas.md, secoes 3 e 4; plano de
 * execucao, etapa 5): rascunho sem IA, avaliar uma resposta com verificador,
 * nota geral ponderada, gate de liberacao, perfil compilado e camada
 * exclusiva.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { briefings, clientes, type AvaliacaoResposta, type Briefing, type PerfilCompilado } from "@/db/schema";
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
 * O perfil compilado do cliente (etapa 10: `avaliarTema` precisa dele no
 * bloco estável). `null` até o briefing chegar à nota mínima e liberar a
 * primeira compilação.
 */
export async function perfilDoCliente(clienteId: number): Promise<PerfilCompilado | null> {
  const briefing = await buscarBriefing(clienteId);
  return briefing?.perfil ?? null;
}

/**
 * Salva o texto da resposta sem chamar IA (debounce fica na tela). Lock e
 * mesclagem em JS dentro de uma transacao (revisao da parte 2, achado no
 * code review desta rodada), no mesmo padrao de `avaliarResposta`: duas
 * chamadas em sequencia rapida, uma por pergunta, liam o mesmo objeto e
 * podiam perder uma resposta.
 *
 * Se o texto do rascunho for diferente do que ja estava salvo, a avaliacao
 * guardada desta pergunta e apagada e a nota geral recalculada na mesma
 * transacao. Antes, isso rodava como um merge atomico direto em SQL, mas so
 * mexia em `respostas`/`avaliacoes`; `notaGeral` (e por tabela `completo`,
 * que so olha para a nota) ficava com o valor de antes da edicao ate a
 * proxima chamada a `avaliarResposta`, e a tela podia mostrar uma nota mais
 * alta do que a soma das avaliacoes guardadas de verdade sustenta.
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

  await db().transaction(async (tx) => {
    const [linha] = await tx
      .select()
      .from(briefings)
      .where(eq(briefings.id, briefing.id))
      .for("update");
    if (!linha) throw new ErroBriefing("briefing nao encontrado.");

    const textoMudou = linha.respostas[perguntaId] !== resposta;
    const respostas = { ...linha.respostas, [perguntaId]: resposta };
    const avaliacoes = textoMudou
      ? Object.fromEntries(Object.entries(linha.avaliacoes).filter(([id]) => id !== perguntaId))
      : linha.avaliacoes;
    const notaGeral = textoMudou ? calcularNotaGeral(avaliacoes) : Number(linha.notaGeral ?? 0);

    await tx
      .update(briefings)
      .set({
        respostas,
        avaliacoes,
        notaGeral: notaGeral.toFixed(2),
        atualizadoEm: new Date(),
      })
      .where(eq(briefings.id, briefing.id));
  });
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
 * briefing fica completo por causa desta chamada, recompila o perfil.
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
 *
 * Isso abre uma segunda janela (achada no code review desta rodada): entre
 * o momento em que `resposta` e lida (antes da chamada de IA) e o momento em
 * que a transacao pega o lock, outra chamada (outro `avaliarResposta` mais
 * rapido, ou um `salvarRascunho`) pode ja ter gravado um texto mais novo
 * para a mesma pergunta. Escrever `resposta` (o parametro, capturado antes
 * da IA) por cima, sem checar, perderia essa edicao mais nova. Por isso a
 * transacao confere se `linha.respostas[perguntaId]` ainda e o texto que
 * gerou esta avaliacao (`respostaGuardada`); se nao for, a avaliacao que
 * acabamos de calcular nao vale mais para o texto atual e a chamada nao
 * sobrescreve nada, so recalcula a nota geral com o que ja esta la.
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
      extrairCampos: (d) => ({
        bom: d.bom,
        melhorar: d.melhorar,
        como: d.como,
        exemplo: d.exemplo,
        impacto: d.impacto,
      }),
    });
  }

  const {
    avaliacao: avaliacaoFinal,
    respostas,
    notaGeral,
    completo,
    deveCompilarPerfil,
  } = await db().transaction(async (tx) => {
    const [linha] = await tx
      .select()
      .from(briefings)
      .where(eq(briefings.id, briefing.id))
      .for("update");
    if (!linha) throw new ErroBriefing("briefing nao encontrado.");

    const aindaValida = linha.respostas[perguntaId] === respostaGuardada;
    const respostas = aindaValida ? { ...linha.respostas, [perguntaId]: resposta } : linha.respostas;
    const avaliacoes = aindaValida
      ? { ...linha.avaliacoes, [perguntaId]: avaliacao }
      : linha.avaliacoes;

    const notaGeral = calcularNotaGeral(avaliacoes);
    const completoAntes = linha.completo;
    const completo = completoAntes || notaGeral >= config.regras.notaMinimaBriefing;
    /** Nao recompila so por causa de uma reavaliacao reusada que nao mudou nada. */
    const deveCompilarPerfil = completo && !(completoAntes && reusada);

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

    return {
      avaliacao: avaliacoes[perguntaId] ?? avaliacao,
      respostas,
      notaGeral,
      completo,
      deveCompilarPerfil,
    };
  });

  if (deveCompilarPerfil) {
    await compilarEGravarPerfil(clienteId, briefing.id, respostas);
  }

  return { avaliacao: avaliacaoFinal, notaGeral, completo, reusada };
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

/**
 * `PerfilCompilado` em texto corrido para o bloco estável de um prompt (nota
 * de tema, roteiro): os dois usam o mesmo perfil, então o formato vive aqui
 * em vez de duplicado em cada um.
 */
export function formatarPerfilCompilado(perfil: PerfilCompilado): string {
  const linhas = [
    perfil.resumo,
    `O que vende: ${perfil.fatos.oQueVende}`,
    `Preço: ${perfil.fatos.preco}`,
    `Cliente ideal: ${perfil.fatos.clienteIdeal}`,
  ];
  if (perfil.fatos.medos.length > 0) linhas.push(`Medos do cliente: ${perfil.fatos.medos.join("; ")}`);
  if (perfil.fatos.frasesDaFala.length > 0) {
    linhas.push(`Frases que ele fala: ${perfil.fatos.frasesDaFala.join("; ")}`);
  }
  if (perfil.fatos.proibicoes.length > 0) linhas.push(`Nunca diria ou faria: ${perfil.fatos.proibicoes.join("; ")}`);
  if (perfil.fatos.cenasFilmaveis.length > 0) {
    linhas.push(`Cenas que dá para filmar: ${perfil.fatos.cenasFilmaveis.join("; ")}`);
  }
  return linhas.join("\n");
}
