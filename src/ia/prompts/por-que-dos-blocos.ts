/**
 * E50 parte 2, PR 3: o pedido do "por quê" de cada bloco, comum ao roteiro curto (`roteiro.ts`) e ao
 * longo (`roteiroLongo.ts`). O modelo devolve só números de regra, o id de um vídeo da evidência e
 * um "para quê" de uma lista fechada; o texto que a pessoa lê sai da tabela, por código
 * (`lib/por-que-do-bloco.ts`). Arquivo novo, sem versão própria: quem o usa (os dois prompts) sobe
 * a sua.
 */
import { z } from "zod";

/** 1.1.0 (22/10/2026): o campo vira um texto de uma linha por bloco (`bloco | regras | vídeo | para`); 1.0.0 era a lista de objetos. */
export const versao = "1.1.0";

import { PARA_QUE } from "@/lib/por-que-do-bloco";

/**
 * Um texto só, uma linha por bloco (`bloco | regras | vídeo | para`); o servidor lê com `lerPorQueEmLinhas` (`lib/por-que-do-bloco.ts`). Texto e não lista de objetos porque a gramática do schema do
 * roteiro curto estourava o limite da API com a lista (medido em 22/10/2026).
 */
export const porQueDosBlocosSchema = z.string().catch("");

export type FormaParaOPedido = "reels" | "cartoes" | "longo";

const BLOCOS: Record<FormaParaOPedido, string> = {
  reels: '"gancho", "corpo", "fechamento", "chamada" e, para cada frase em edicao.textoNaTela, "tela:N" (N é a posição dela na lista, a primeira é "tela:0")',
  cartoes: '"cartao:N" (N é a posição do cartão, o primeiro é "cartao:0"; o primeiro vale como gancho e o último como chamada)',
  longo: '"gancho", "chamada", "capitulo:N" (N é a posição do capítulo, o primeiro é "capitulo:0") e, para cada frase em edicao.textoNaTela, "tela:N" (a primeira é "tela:0")',
};

/** O pedido do `porQueDosBlocos`, fixo por formato (entra no sistema estável, com cache). */
export function pedidoPorQueDosBlocos(forma: FormaParaOPedido): string {
  return [
    "Depois de escrever, preencha também porQueDosBlocos: um texto com UMA LINHA para cada bloco em que você seguiu pelo menos uma das regras de texto e de estrutura listadas acima.",
    'Cada linha tem quatro partes separadas por "|": bloco | regras | vídeo | para. Exemplo: gancho | R-COPY-05, R-COPY-13 | 12 | fiquem',
    `Bloco: a chave do bloco: ${BLOCOS[forma]}.`,
    'Regras: os números (por exemplo "R-COPY-08") das regras daquela lista que você de fato seguiu naquele bloco, separados por vírgula, no máximo três, só as que valem para aquele bloco (o que está entre parênteses na regra), nunca uma regra que não está na lista acima e nunca as regras de plataforma.',
    'Vídeo: o id de um vídeo da evidência que você de fato usou como modelo para aquele bloco, ou "-"; nunca o segundo.',
    `Para: o que o bloco busca em quem assiste, uma destas palavras: ${PARA_QUE.join(", ")} (continuem assistindo, confiem, guardem para usar depois, chamem), ou "-".`,
    "Neste campo não escreva nenhum texto de explicação: o texto que a pessoa lê sai da tabela, pelo número. Bloco em que você não seguiu regra nenhuma fica de fora; sem nenhuma, deixe o texto vazio.",
  ].join(String.fromCharCode(10));
}
