import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Modelo semanal do nicho (escopo 5.9.5, base lenta; usado a partir da
 * etapa 9). Guarda ganchos e fechamentos como frases reais, nao como
 * descricoes abstratas: o modelo imita exemplo melhor do que segue regra.
 *
 * M5b, achado 4 da revisao do motor (01/10/2026): a duracao tipica deixou de ser pedida ao
 * modelo (ele inventava, porque o schema exigia o campo e a entrada nunca trazia a duracao de
 * nenhum video). Agora e um fato calculado por SQL (`faixaDeDuracao`, `jobs/modelo-nicho.ts`,
 * percentis 25 a 75) e so entra na entrada, para o modelo escrever `resumo`/`formatos` cientes
 * dela; `modelarNicho` grava esse valor direto no `ModeloNicho`, nunca o que o modelo devolve.
 */
export const versao = "1.3.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

const ganchoComExemplo = z.object({
  tipo: z.string(),
  exemplo: z.string(),
  frequencia: z.string(),
});
const formatoComParticipacao = z.object({ formato: z.string(), participacao: z.string() });

export const schema = z.object({
  resumo: z.string(),
  ganchos: z.array(ganchoComExemplo),
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
  return `Você junta as análises de trinta a sessenta vídeos fora da curva das últimas doze
semanas de um nicho, mais dez análises visuais dos melhores da semana, e escreve o modelo do
nicho: o que estruturalmente funciona ali, para servir de referência a quem escreve roteiro
depois.

- resumo: como esse nicho fala e o que funciona nele, em poucas frases.
- ganchos: tipos de gancho que se repetem, cada um com um exemplo literal (copiado de um
  vídeo de verdade, nunca inventado) e a frequência com que aparece.
- estruturas: os jeitos mais comuns de organizar o vídeo.
- fechamentos: frases ou jeitos de fechamento que se repetem.
- chamadasFinais: o que os vídeos pedem no final, com frequência.
- formatos: fala_para_camera, podcast, caixinha, esquete ou outro, com o quanto cada um
  aparece.
- edicao: o texto na tela, o ritmo de corte, os recursos e o áudio que se repetem entre os
  melhores da semana.
- assuntosQuentes: os assuntos que mais aparecem nas evidências recebidas.

Sempre cite frases e exemplos literais das análises recebidas, nunca invente. Sem
travessão, sem emoji.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  videosAnalisados: {
    id: number;
    assunto: string;
    gancho: string;
    estrutura: string;
    fechamento: string;
    chamadaFinal: string;
    formato: string;
  }[];
  analisesVisuais: { id: number; ritmoDeCorte: string; recursos: string[] }[];
  /** M5b, achado 4: fato calculado por SQL, não pedido mais ao modelo (ver o cabeçalho do arquivo). */
  duracaoTipicaS: { min: number; max: number } | null;
}): string {
  const listaVideos = dados.videosAnalisados
    .map(
      (v) =>
        `id ${v.id}: assunto "${v.assunto}", gancho "${v.gancho}", estrutura "${v.estrutura}", fechamento "${v.fechamento}", chamada final "${v.chamadaFinal}", formato ${v.formato}`,
    )
    .join("\n");

  const listaVisuais = dados.analisesVisuais
    .map((v) => `id ${v.id}: ritmo ${v.ritmoDeCorte}, recursos ${v.recursos.join(", ")}`)
    .join("\n");

  const duracao = dados.duracaoTipicaS
    ? `Duração típica medida (percentis 25 a 75 dos vídeos analisados): de ${dados.duracaoTipicaS.min} a ${dados.duracaoTipicaS.max} segundos.`
    : "Duração típica: sem vídeo com duração registrada o bastante para medir.";

  return `Videos analisados (fora da curva, ultimas 12 semanas):\n${listaVideos}\n\nAnalise visual dos dez melhores da semana:\n${listaVisuais}\n\n${duracao}`;
}
