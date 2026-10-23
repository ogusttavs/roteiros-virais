/**
 * E17 parte 1 (refeita em 23/10/2026, ajustada pela medição com dados reais): o modelo barato escolhendo a prova do Tema livre por significado.
 *
 * `evidenciaParaTema` (`servicos/pesquisa.ts`), com `BUSCA_POR_SIGNIFICADO` ligada, chama `escolherComIA` em TODA busca do Tema livre com o conjunto elegível do setor (até
 * `MAXIMO_DE_CANDIDATOS_PARA_IA`); esta função devolve os ids que tratam do mesmo assunto, do mais próximo ao menos (lista vazia quando nenhum trata: é uma resposta válida), ou `null`
 * quando não houve escolha (sem candidato, modelo fora do ar), caso em que a prova fica a da busca por palavra de sempre.
 *
 * Travas de custo: (1) o teto de candidatos por chamada, cada um com uma linha curta (assunto e título; uns US$ 0,009 por tema com 170 vídeos, US$ 0,002 com 30) e uma saída de no
 * máximo `MAXIMO_DE_TOKENS_DE_SAIDA` tokens; (2) o cache: a mesma pergunta (mesmos setores, mesmo texto de tema, mesmos candidatos, mesma versão do prompt) responde do que já está em
 * `geracoes_ia`, sem pagar de novo, por `DIAS_DO_CACHE` dias (um vídeo novo no setor muda os candidatos e então a pergunta é outra); (3) só roda com `config.busca.porSignificado`.
 *
 * Isolamento: o cache guarda ids de vídeos do setor (dado compartilhado) e o texto do tema com o cliente que o escreveu, como toda geração; outra pessoa só reaproveita
 * a resposta se escrever o mesmo texto sobre os mesmos candidatos, e o que recebe são ids de vídeos públicos, nunca o texto dela.
 */
import { createHash } from "node:crypto";

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { geracoesIA } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as reordenarEvidencia from "@/ia/prompts/reordenarEvidencia";
import { registrarGeracao } from "@/ia/registro";
import { normalizarBusca } from "@/lib/buscar-ramo";
import { logger } from "@/lib/log";

/** O teto por chamada: nunca mais que isto vai ao modelo, qualquer que seja o tamanho do setor. */
export const MAXIMO_DE_CANDIDATOS_PARA_IA = 200;
const MAXIMO_DE_TOKENS_DE_SAIDA = 1500;
const DIAS_DO_CACHE = 14;
const DIA_MS = 24 * 60 * 60 * 1000;

export type CandidatoDeBusca = { id: number; assunto: string; titulo: string | null };

/** A identidade de uma pergunta ao modelo: a versão do prompt, os setores, o tema sem acento nem caixa e os candidatos (em qualquer ordem). */
export function chaveDoCache(versaoDoPrompt: string, setores: number[], tema: string, idsDosCandidatos: number[]): string {
  const material = JSON.stringify([
    versaoDoPrompt,
    [...setores].sort((a, b) => a - b),
    normalizarBusca(tema),
    [...idsDosCandidatos].sort((a, b) => a - b),
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

async function respostaEmCache(chave: string): Promise<number[] | null> {
  const [achada] = await db()
    .select({ saida: geracoesIA.saida })
    .from(geracoesIA)
    .where(
      and(
        eq(geracoesIA.tarefa, "reordenarEvidencia"),
        eq(geracoesIA.versaoPrompt, reordenarEvidencia.versao),
        sql`${geracoesIA.entradas} ->> 'chave' = ${chave}`,
        gte(geracoesIA.criadoEm, new Date(Date.now() - DIAS_DO_CACHE * DIA_MS)),
        isNotNull(geracoesIA.saida),
      ),
    )
    .orderBy(desc(geracoesIA.id))
    .limit(1);
  const ids = (achada?.saida as { mesmoAssunto?: unknown } | null | undefined)?.mesmoAssunto;
  if (!Array.isArray(ids)) return null;
  return ids.filter((id): id is number => typeof id === "number");
}

/** Só os ids que estavam na lista, sem repetir, na ordem do modelo, no máximo `limite`. */
function idsValidos(ids: number[], candidatos: CandidatoDeBusca[], limite: number): number[] {
  const permitidos = new Set(candidatos.map((c) => c.id));
  return [...new Set(ids)].filter((id) => permitidos.has(id)).slice(0, limite);
}

export async function escolherComIA(dados: {
  clienteId: number;
  tema: string;
  /** Os setores da busca (o principal primeiro): fazem parte da chave do cache e, o primeiro, do ramo a que o gasto pertence. */
  setores: number[];
  candidatos: CandidatoDeBusca[];
  /** Quantas provas o chamador usa; o modelo não precisa devolver mais. */
  limite: number;
}): Promise<number[] | null> {
  const candidatos = dados.candidatos.slice(0, MAXIMO_DE_CANDIDATOS_PARA_IA);
  if (candidatos.length === 0) return null;

  try {
    const chave = chaveDoCache(
      reordenarEvidencia.versao,
      dados.setores,
      dados.tema,
      candidatos.map((c) => c.id),
    );
    const guardada = await respostaEmCache(chave);
    if (guardada) return idsValidos(guardada, candidatos, dados.limite);

    const resultado = await gerarEstruturado({
      tarefa: "reordenarEvidencia",
      nivel: reordenarEvidencia.nivel,
      effort: reordenarEvidencia.esforco,
      schema: reordenarEvidencia.schema,
      sistemaEstavel: reordenarEvidencia.montarSistemaEstavel(),
      entrada: reordenarEvidencia.montarEntrada({ tema: dados.tema, candidatos }),
      maxTokens: MAXIMO_DE_TOKENS_DE_SAIDA,
    });
    // O código descarta todo item marcado como "não" ou sem frase (`itensDoMesmoAssunto`). O que fica guardado é a escolha inteira; o corte por `limite` é de quem pergunta, na hora.
    const escolhidos = idsValidos(reordenarEvidencia.itensDoMesmoAssunto(resultado.dados.itens), candidatos, candidatos.length);

    await registrarGeracao({
      tarefa: "reordenarEvidencia",
      versaoPrompt: reordenarEvidencia.versao,
      modelo: resultado.modelo,
      nivel: reordenarEvidencia.nivel,
      clienteId: dados.clienteId,
      entradas: { chave, tema: dados.tema, nichoId: dados.setores[0], setores: dados.setores, candidatos: candidatos.map((c) => c.id) },
      evidencias: escolhidos,
      // `mesmoAssunto` são os ids que ficaram depois do descarte do código; `itens` guarda o julgamento inteiro (a frase de cada vídeo), inclusive o que foi descartado.
      saida: { motivo: resultado.dados.motivo, itens: resultado.dados.itens, mesmoAssunto: escolhidos },
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });
    return escolhidos.slice(0, dados.limite);
  } catch (falha) {
    // A prova nunca quebra por causa disto: sem a escolha do modelo, vale a busca por palavra.
    logger.error({ err: falha, clienteId: dados.clienteId }, "nao foi possivel escolher a prova do tema pelo modelo barato");
    return null;
  }
}
