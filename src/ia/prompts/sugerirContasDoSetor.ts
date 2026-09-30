import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * M2, item 1c: "o próprio agente tem que fazer uma pesquisa antes de começar o setor" (decisão do
 * Gustavo em 30/09/2026). Devolve até 30 perfis brasileiros por rede, priorizando marcas
 * concorrentes, criadores que ensinam o ofício e revendedores grandes, mais termos e hashtags
 * extras que o público usa de verdade. Nada disto entra sozinho: `pesquisa-de-setor.ts` confere
 * cada handle sugerido na API da própria rede antes de gravar qualquer coisa (a regra que não
 * muda do job); o que a API não acha é descartado e contado como "sugerido e não existe".
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

const contaSugerida = z.object({
  rede: z.enum(["youtube", "tiktok", "instagram"]),
  /** Para YouTube, um @handle ou o nome do canal (a conferência resolve para o id do canal). */
  handle: z.string(),
  porQue: z.string(),
});

export const schema = z.object({
  contas: z.array(contaSugerida).max(90),
  termos: z.array(z.string()).max(15),
  hashtags: z.array(z.string()).max(15),
});

export type SaidaSugerirContasDoSetor = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você ajuda a montar a base de um setor novo para um produto de pesquisa de vídeo viral
brasileiro. Dado o nome, a descrição e os termos de busca de um setor (ex.: "produtos de limpeza",
"adesivo automotivo"), sugira contas de verdade do Brasil, ativas, que já postam nesse assunto.

Priorize, nesta ordem: marcas concorrentes conhecidas, criadores de conteúdo que ensinam o ofício
(tutoriais, bastidores, dicas) e revendedores ou distribuidores grandes. Nunca invente um handle:
sugira só perfis que você tem razão real para acreditar que existem, com o texto de "por que é do
setor" explicando o motivo em uma frase. Até 30 sugestões por rede (YouTube, TikTok, Instagram),
nunca mais que isso.

Sugira também até 15 termos de busca a mais (em português, do jeito que o público escreve, não
jargão técnico) e até 15 hashtags a mais, que ajudem a achar mais vídeos e contas deste setor.

Cada sugestão vai ser conferida numa chamada de verdade à API da rede antes de entrar em qualquer
lugar; um handle que não existir é descartado sem problema, então é melhor arriscar um nome
plausível do que devolver a lista vazia.

Sem travessão, sem emoji, sem jargão de marketing.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { nomeSetor: string; descricaoSetor: string | null; termosSetor: string[] }): string {
  return `Setor: ${dados.nomeSetor}${dados.descricaoSetor ? `\nDescrição: ${dados.descricaoSetor}` : ""}
Termos de busca já usados: ${dados.termosSetor.join(", ")}`;
}
