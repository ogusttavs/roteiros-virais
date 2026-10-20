/**
 * E50 parte 2, PR 3: o pedido do "por quê" de cada bloco, comum ao roteiro curto (`roteiro.ts`) e ao
 * longo (`roteiroLongo.ts`). O modelo devolve só números de regra, o id de um vídeo da evidência e
 * um "para quê" de uma lista fechada; o texto que a pessoa lê sai da tabela, por código
 * (`lib/por-que-do-bloco.ts`). Arquivo novo, sem versão própria: quem o usa (os dois prompts) sobe
 * a sua.
 */
import { z } from "zod";

import { PARA_QUE } from "@/lib/por-que-do-bloco";

export const porQueDoBlocoSchema = z.object({
  bloco: z.string(),
  regras: z.array(z.string()),
  videoId: z.number().nullable(),
  para: z.enum(PARA_QUE).nullable().catch(null),
});

export type FormaParaOPedido = "reels" | "cartoes" | "longo";

const BLOCOS: Record<FormaParaOPedido, string> = {
  reels: '"gancho", "corpo", "fechamento", "chamada" e, para cada frase em edicao.textoNaTela, "tela:N" (N é a posição dela na lista, a primeira é "tela:0")',
  cartoes: '"cartao:N" (N é a posição do cartão, o primeiro é "cartao:0"; o primeiro vale como gancho e o último como chamada)',
  longo: '"gancho", "chamada", "capitulo:N" (N é a posição do capítulo, o primeiro é "capitulo:0") e, para cada frase em edicao.textoNaTela, "tela:N" (a primeira é "tela:0")',
};

/** O pedido do `porQueDosBlocos`, fixo por formato (entra no sistema estável, com cache). */
export function pedidoPorQueDosBlocos(forma: FormaParaOPedido): string {
  return [
    "Depois de escrever, preencha também porQueDosBlocos: uma entrada para cada bloco em que você seguiu pelo menos uma das regras de texto e de estrutura listadas acima.",
    `Em "bloco", escreva a chave do bloco: ${BLOCOS[forma]}.`,
    'Em "regras", os números (por exemplo "R-COPY-08") das regras daquela lista que você de fato seguiu naquele bloco, no máximo três, só as que valem para aquele bloco (o que está entre parênteses na regra), nunca uma regra que não está na lista acima e nunca as regras de plataforma.',
    'Em "videoId", o id de um vídeo da evidência que você de fato usou como modelo para aquele bloco, ou nulo; nunca o segundo.',
    `Em "para", o que o bloco busca em quem assiste, uma destas palavras: ${PARA_QUE.map((p) => `"${p}"`).join(", ")} (continuem assistindo, confiem, guardem para usar depois, chamem), ou nulo.`,
    "Neste campo não escreva nenhum texto de explicação: o texto que a pessoa lê sai da tabela, pelo número. Bloco em que você não seguiu regra nenhuma fica de fora; sem nenhuma, devolva a lista vazia.",
  ].join(String.fromCharCode(10));
}
