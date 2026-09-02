import { z } from "zod";

/**
 * Modelo semanal do nicho (escopo 5.9.5, base lenta; usado a partir da
 * etapa 9). Guarda ganchos e fechamentos como frases reais, nao como
 * descricoes abstratas: o modelo imita exemplo melhor do que segue regra.
 */
export const versao = "1.0.0";

const ganchoComExemplo = z.object({
  tipo: z.string(),
  exemplo: z.string(),
  frequencia: z.string(),
});
const formatoComParticipacao = z.object({ formato: z.string(), participacao: z.string() });

export const schema = z.object({
  resumo: z.string(),
  ganchos: z.array(ganchoComExemplo),
  duracaoTipicaS: z.object({ min: z.number(), max: z.number() }),
  estruturas: z.array(z.string()),
  fechamentos: z.array(z.string()),
  chamadasFinais: z.array(z.string()),
  formatos: z.array(formatoComParticipacao),
  edicao: z.object({
    textoNaTela: z.string(),
    ritmoDeCorte: z.string(),
    recursos: z.array(z.string()),
    audio: z.string().nullable(),
  }),
  assuntosQuentes: z.array(z.string()),
});

export type SaidaModeloNicho = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Voce junta as analises de trinta a sessenta videos fora da curva das ultimas doze
semanas de um nicho, mais dez analises visuais dos melhores da semana, e escreve o modelo do
nicho: o que estruturalmente funciona ali, para servir de referencia a quem escreve roteiro
depois.

- resumo: como esse nicho fala e o que funciona nele, em poucas frases.
- ganchos: tipos de gancho que se repetem, cada um com um exemplo literal (copiado de um
  video de verdade, nunca inventado) e a frequencia com que aparece.
- duracaoTipicaS: a faixa de duracao dos videos que mais funcionam.
- estruturas: os jeitos mais comuns de organizar o video.
- fechamentos: frases ou jeitos de fechamento que se repetem.
- chamadasFinais: o que os videos pedem no final, com frequencia.
- formatos: fala_para_camera, podcast, caixinha, esquete ou outro, com o quanto cada um
  aparece.
- edicao: o texto na tela, o ritmo de corte, os recursos e o audio que se repetem entre os
  melhores da semana.
- assuntosQuentes: os assuntos que mais aparecem nas evidencias recebidas.

Sempre cite frases e exemplos literais das analises recebidas, nunca invente. Sem
travessao, sem emoji.`;
}

export function montarEntrada(dados: {
  videosAnalisados: {
    id: number;
    assunto: string;
    gancho: string;
    fechamento: string;
    formato: string;
  }[];
  analisesVisuais: { id: number; ritmoDeCorte: string; recursos: string[] }[];
}): string {
  const listaVideos = dados.videosAnalisados
    .map(
      (v) =>
        `id ${v.id}: assunto "${v.assunto}", gancho "${v.gancho}", fechamento "${v.fechamento}", formato ${v.formato}`,
    )
    .join("\n");

  const listaVisuais = dados.analisesVisuais
    .map((v) => `id ${v.id}: ritmo ${v.ritmoDeCorte}, recursos ${v.recursos.join(", ")}`)
    .join("\n");

  return `Videos analisados (fora da curva, ultimas 12 semanas):\n${listaVideos}\n\nAnalise visual dos dez melhores da semana:\n${listaVisuais}`;
}
