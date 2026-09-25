import { z } from "zod";

import { FORMATOS_ROTEIRO, type AnaliseVideo, type FigurinhaStory, type FormatoRoteiro, type Objetivo, type TipoAbertura } from "@/db/schema";

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

/**
 * A instrução de abertura por tipo (V4, roteiro sem vício, `prompts/roteiro.ts`,
 * `montarEntrada`): "abra este roteiro com X". Mesma razão de `NOME_OBJETIVO`
 * estar aqui, fora de `prompts/`, para o `checar-versao-prompt` só reagir a
 * mudança de instrução de verdade, não a este texto compartilhado.
 */
export const INSTRUCAO_TIPO_ABERTURA: Record<TipoAbertura, string> = {
  cena: "uma cena acontecendo, sem falar primeiro",
  resultado: "o resultado final, antes de explicar como chegou lá",
  objeto: "um objeto, produto ou ferramenta em destaque",
  fala_direta: "uma frase afirmativa direto para a câmera, sem cena, sem pergunta",
  numero: "um número ou dado concreto na primeira frase",
  contraste: "um antes e depois, ou dois jeitos diferentes de fazer a mesma coisa",
  pergunta: "uma pergunta direta para quem assiste",
  outro: "o jeito que fizer mais sentido para este vídeo, fora dos sete tipos acima",
};

/** V9c, item 1: o rótulo do controle segmentado (Objetivo, Gravar agora, o item do plano). */
export const ROTULO_FORMATO_ROTEIRO: Record<FormatoRoteiro, string> = {
  reels: "Reels",
  story: "Story",
};

/** Reels antes de Story, mesma ordem do controle segmentado nas três telas (V9c, item 1). */
export const FORMATOS_ROTEIRO_EM_ORDEM: FormatoRoteiro[] = [...FORMATOS_ROTEIRO];

/**
 * V9c, item 1 (R-IG-STORY-10 e R-IG-REEL-11, `estudo-stories.md`, seção 2):
 * quem puxa para "conhecer" nunca chega por Story, que alcança quase só
 * quem já segue; os outros dois objetivos (lembrar, comprar) vivem de
 * resposta e conversa, o que o Story faz melhor. Decisão por código, não
 * pelo modelo: a pessoa troca se quiser, o controle só já vem marcado.
 */
export function sugerirFormatoPeloObjetivo(objetivo: Objetivo): FormatoRoteiro {
  return objetivo === "alcance" ? "reels" : "story";
}

/** V9c, item 2: o rótulo de cada figurinha nativa do Story, para a tela do roteiro ("Por que assim" e o cartão). */
export const ROTULO_FIGURINHA: Record<FigurinhaStory, string> = {
  enquete: "enquete",
  emoji_deslizavel: "emoji deslizável",
  teste: "teste",
  perguntas: "caixinha de perguntas",
  link: "link",
  localizacao: "localização",
  mencao: "menção",
  contagem_regressiva: "contagem regressiva",
  nenhuma: "nenhuma",
};
