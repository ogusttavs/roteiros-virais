import { z } from "zod";

import type { Objetivo } from "@/db/schema";

/**
 * Enums Zod usados nos schemas de saida das tarefas, e a traducao do
 * objetivo interno para o nome que o cliente ve. Ficam fora de
 * src/ia/prompts/ (que o checar-texto varre) porque os valores de puxaPara
 * e as chaves de NOME_OBJETIVO sao os nomes internos de
 * escopo-e-arquitetura.md 4.3, que coincidem com jargao proibido em texto
 * de tela (alcance, engajamento, conversao nunca aparecem para o cliente,
 * so os nomes da secao 5 de briefing-e-rubricas.md: "mais gente me
 * conhecer" e as outras duas).
 */
export const puxaParaEnum = z.enum(["alcance", "engajamento", "conversao"]);

/** roteiro.ts usa isso em montarEntrada para nunca escrever o nome interno como texto. */
export const NOME_OBJETIVO: Record<Objetivo, string> = {
  alcance: "mais gente me conhecer",
  engajamento: "as pessoas lembrarem de mim quando precisarem",
  conversao: "gente me chamar para comprar",
};

/**
 * Rótulo curto do `TemaCartao` em `/hoje` (etapa 10, brief-frontend.md
 * 6.3): mesma razão de `NOME_OBJETIVO` estar aqui, fora do `checar-texto`.
 */
export const ROTULO_TEMA_CARTAO: Record<Objetivo, string> = {
  alcance: "para te conhecerem",
  engajamento: "para lembrarem de você",
  conversao: "para te chamarem",
};
