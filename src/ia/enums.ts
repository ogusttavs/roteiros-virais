import { z } from "zod";

import type { AnaliseVideo, Objetivo } from "@/db/schema";

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
/**
 * Frase completa do design v2 (`entrega/telas/Hoje.dc.html`, `.rotulo`; `PROXIMO.md`, revisão
 * do PR #31, item 3), com a primeira letra maiúscula como o resto do produto (`BRIEF.md`,
 * seção 3, revisão do lote 6).
 */
export const ROTULO_TEMA_CARTAO: Record<Objetivo, string> = {
  alcance: "Para mais gente te conhecer",
  engajamento: "Para lembrarem de você",
  conversao: "Para te chamarem para comprar",
};

/**
 * A frase de ajuda de cada opção em `/hoje/objetivo` (etapa 11,
 * `ObjetivoFluxo.dc.html`): mesma razão de `NOME_OBJETIVO` estar aqui.
 */
export const AJUDA_OBJETIVO: Record<Objetivo, string> = {
  alcance: "para quem ainda não te viu",
  engajamento: "para quem já te segue",
  conversao: "para quem está quase decidindo",
};

/**
 * "O objetivo continua: X" na folha de reprovar (E27, parte 1;
 * `entrega/telas/Roteiro.dc.html`): mesma razão de `NOME_OBJETIVO` estar
 * aqui, sem o "Para" de `ROTULO_TEMA_CARTAO`.
 */
export const ROTULO_OBJETIVO_TRAVADO: Record<Objetivo, string> = {
  alcance: "mais gente te conhecer",
  engajamento: "lembrarem de você",
  conversao: "te chamarem para comprar",
};

/** As três opções de objetivo, na ordem fixa em que a tela mostra (etapa 11). */
export const OBJETIVOS_EM_ORDEM: Objetivo[] = ["alcance", "engajamento", "conversao"];

/**
 * Rótulo do formato em `/referencias` (etapa 12, decisão 1 do
 * `PROXIMO.md`): mesma razão de `NOME_OBJETIVO` estar aqui, fora do
 * `checar-texto`. Ordem bate com `textosReferencias.formatos`.
 */
export const ROTULO_FORMATO: Record<AnaliseVideo["formato"], string> = {
  fala_para_camera: "fala para câmera",
  podcast: "podcast",
  caixinha: "caixinha de pergunta",
  esquete: "esquete",
  outro: "outro",
};

/** Mesma ordem de `ROTULO_FORMATO`, para os chips de filtro. */
export const FORMATOS_EM_ORDEM: AnaliseVideo["formato"][] = [
  "fala_para_camera",
  "podcast",
  "caixinha",
  "esquete",
  "outro",
];
