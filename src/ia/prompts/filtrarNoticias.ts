import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Filtra as notícias do RSS por relevância ao nicho (etapa 10, decisão 1 do
 * PROXIMO.md). Tarefa barata, roda dentro do job `temasDoDia` antes da
 * chamada forte: reduz até 60 notícias brutas do dia para no máximo 8
 * relevantes, cada uma já com um ângulo pronto para virar tema.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  relevantes: z.array(z.object({ indice: z.number().int(), angulo: z.string() })).max(8),
});

export type SaidaFiltrarNoticias = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você recebe uma lista numerada de notícias das últimas 24 horas e escolhe só as que
importam para o dono de um pequeno negócio do nicho recebido, entre os termos dele.

Para cada notícia relevante, devolva o índice dela na lista (o número antes do título) e uma
frase de ângulo pronta para virar tema de vídeo, no formato "saiu hoje que X, explique o que
muda para o seu cliente". Descarte notícia genérica, de outro assunto, ou sem relação nenhuma
com quem toca esse negócio. No máximo 8 notícias, mesmo que mais de 8 pareçam relevantes:
escolha as mais importantes. Sem notícia relevante nenhuma, devolva a lista vazia.

Sem travessão, sem emoji, sem jargão.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  nomeNicho: string;
  termosNicho: string[];
  noticias: { titulo: string; resumo: string | null }[];
}): string {
  const listaNoticias =
    dados.noticias.length > 0
      ? dados.noticias.map((n, i) => `${i + 1}. ${n.titulo}${n.resumo ? `: ${n.resumo}` : ""}`).join("\n")
      : "nenhuma noticia nas ultimas 24 horas";

  return `Nicho: ${dados.nomeNicho} (termos: ${dados.termosNicho.join(", ")})\n\nNoticias:\n${listaNoticias}`;
}
