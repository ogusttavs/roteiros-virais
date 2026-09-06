import { z } from "zod";

import { puxaParaEnum } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Os tres temas do dia (escopo 5.2, camada rapida; usado a partir da etapa
 * 10). puxaParaEnum vem de src/ia/enums.ts para o valor interno nao aparecer
 * como texto literal aqui (ver comentario la).
 *
 * 1.2.0 (dia 1 da etapa 14, `PROXIMO.md`): notícia vira evidência citável,
 * com id próprio, igual a vídeo. Antes, com vídeo zero e notícia relevante,
 * o job chamava o modelo pedindo evidência de uma lista de ids vazia, que
 * sempre reprova.
 */
export const versao = "1.2.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

const temaDoDia = z.object({
  titulo: z.string(),
  descricao: z.string(),
  porQue: z.string(),
  evidencias: z.array(z.number()),
  evidenciasNoticias: z.array(z.number()).default([]),
  puxaPara: puxaParaEnum,
});

export const schema = z.object({
  temas: z.array(temaDoDia).length(3),
});

export type SaidaTemasDoDia = z.infer<typeof schema>;

export function montarSistemaEstavel(dados: { modeloNicho: string }): string {
  return `Você sugere três temas de vídeo (não títulos, temas) para donos de pequeno negócio
de um nicho, a partir do que está subindo mais rápido nos últimos dias e das notícias
relevantes do setor. Cada tema cita ids de vídeo ou de notícia do banco como evidência;
nunca sugira um tema sem pelo menos um id de evidência, de vídeo ou de notícia.

Para cada tema, diga em duas linhas por que ele está funcionando agora, e classifique qual
efeito ele mais puxa: mais gente conhecer o negócio, as pessoas lembrarem dele quando
precisarem, ou gente ser chamado para comprar.

Sem travessão, sem emoji, sem jargão em título nem em descrição.

Modelo do nicho:
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  subindoHoje: { id: number; assunto: string; velocidadeRelativa: number }[];
  noticias: { id: number; titulo: string; resumo: string }[];
}): string {
  const listaVideos =
    dados.subindoHoje.length > 0
      ? dados.subindoHoje
          .map((v) => `id ${v.id}: ${v.assunto} (velocidade ${v.velocidadeRelativa.toFixed(1)}x)`)
          .join("\n")
      : "nenhum video subindo hoje";

  const listaNoticias =
    dados.noticias.length > 0
      ? dados.noticias.map((n) => `noticia ${n.id}: ${n.titulo}: ${n.resumo}`).join("\n")
      : "nenhuma noticia relevante hoje";

  return `Subindo hoje:\n${listaVideos}\n\nNoticias do nicho:\n${listaNoticias}`;
}
