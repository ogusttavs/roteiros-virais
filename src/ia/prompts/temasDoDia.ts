import { z } from "zod";

import { puxaParaEnum } from "../enums";

/**
 * Os tres temas do dia (escopo 5.2, camada rapida; usado a partir da etapa
 * 10). puxaParaEnum vem de src/ia/enums.ts para o valor interno nao aparecer
 * como texto literal aqui (ver comentario la).
 */
export const versao = "1.0.0";

const temaDoDia = z.object({
  titulo: z.string(),
  descricao: z.string(),
  porQue: z.string(),
  evidencias: z.array(z.number()),
  puxaPara: puxaParaEnum,
});

export const schema = z.object({
  temas: z.array(temaDoDia).length(3),
});

export type SaidaTemasDoDia = z.infer<typeof schema>;

export function montarSistemaEstavel(dados: { modeloNicho: string }): string {
  return `Voce sugere tres temas de video (nao titulos, temas) para donos de pequeno negocio
de um nicho, a partir do que esta subindo mais rapido nos ultimos dias e das noticias
relevantes do setor. Cada tema cita ids de video do banco como evidencia; nunca sugira um
tema sem pelo menos uma evidencia.

Para cada tema, diga em duas linhas por que ele esta funcionando agora, e classifique qual
efeito ele mais puxa: mais gente conhecer o negocio, as pessoas lembrarem dele quando
precisarem, ou gente ser chamado para comprar.

Sem travessao, sem emoji, sem jargao em titulo nem em descricao.

Modelo do nicho:
${dados.modeloNicho}`;
}

export function montarEntrada(dados: {
  subindoHoje: { id: number; assunto: string; velocidadeRelativa: number }[];
  noticias: { titulo: string; resumo: string }[];
}): string {
  const listaVideos =
    dados.subindoHoje.length > 0
      ? dados.subindoHoje
          .map((v) => `id ${v.id}: ${v.assunto} (velocidade ${v.velocidadeRelativa.toFixed(1)}x)`)
          .join("\n")
      : "nenhum video subindo hoje";

  const listaNoticias =
    dados.noticias.length > 0
      ? dados.noticias.map((n) => `${n.titulo}: ${n.resumo}`).join("\n")
      : "nenhuma noticia relevante hoje";

  return `Subindo hoje:\n${listaVideos}\n\nNoticias do nicho:\n${listaNoticias}`;
}
