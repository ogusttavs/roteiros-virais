import { z } from "zod";

import { puxaParaEnum } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Sugere de 1 a 3 gravações para um dia do plano, a partir do lugar e dos
 * compromissos daquele dia (V9b, item 2, "o plano colado"). Tarefa barata,
 * sem verificador (mesmo espírito de `lerMomento.ts` e `avaliarTema`'s
 * ângulo sugerido: uma sugestão curta, não o roteiro em si; o roteiro só
 * nasce quando a pessoa aceitar, `servicos/plano.ts`, `aceitar`).
 *
 * Primeiro uso da base numerada da seção 9 das rubricas (E36): o sistema
 * estável leva só o texto das regras R-IG-REEL-01 a 04, com o número na
 * frente, um ensaio para o prompt do roteiro usar a base inteira depois da
 * viagem.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

const sugestaoSchema = z.object({
  /** O compromisso que vira o momento (o "o que está acontecendo" do roteiro, quando aceito). */
  situacao: z.string(),
  /** A cena que dá para mostrar ali (o "o que dá para mostrar" do roteiro). */
  oQueMostrar: z.string(),
  objetivo: puxaParaEnum,
});

export const schema = z.object({ sugestoes: z.array(sugestaoSchema).min(1).max(3) });

export type SaidaPlanejarDia = z.infer<typeof schema>;

/**
 * R-IG-REEL-01 a 04 (`estrategia/briefing-e-rubricas.md`, seção 9.2), texto
 * literal das regras, sem o "conferível por código" nem a fonte (isso fica
 * no estudo; aqui é só o que orienta a sugestão).
 */
const REGRAS_REELS = `R-IG-REEL-01: os dois primeiros segundos já mostram o assunto; o gancho não é saudação nem
pergunta genérica.
R-IG-REEL-02: escrito para ser assistido inteiro, um assunto só, sem intro, o resultado antes
do fim.
R-IG-REEL-03: feito para ser compartilhado ou guardado, uma informação útil que a pessoa manda
para alguém.
R-IG-REEL-04: cena real, gravada no lugar, com o resultado visível; nada de parede lisa nem
estúdio.`;

export function montarSistemaEstavel(dados: { perfilCompilado: string; modeloNicho: string }): string {
  return `Você sugere, de 1 a 3, gravações que fazem sentido para um dono de pequeno negócio
fazer num dia específico da agenda dele, a partir do lugar onde ele vai estar e do que ele tem
para fazer nesse dia.

Cada sugestão é uma cena real desse dia, nunca um tema genérico do nicho: prefira o compromisso
que dá o lugar e a situação mais concretos (uma visita, uma reunião, uma viagem), não uma tarefa
qualquer. Cada sugestão tem: a situação (o que está acontecendo, nas palavras do compromisso), o
que dá para mostrar ali (a cena), e o objetivo que combina mais com aquele momento.

Regras do que funciona no Reels, use para escolher a cena e a situação (não escreva o roteiro,
só a sugestão):
${REGRAS_REELS}

Perfil do cliente:
${dados.perfilCompilado}

Modelo do nicho:
${dados.modeloNicho}

Nunca invente um compromisso que não está na entrada. Português do Brasil, com acentuação
correta.`;
}

export function montarEntrada(dados: { lugar: string; compromissos: string[] }): string {
  const lugar = dados.lugar.trim() || "não informado";
  return `Lugar: ${lugar}\nCompromissos do dia:\n${dados.compromissos.map((c) => `- ${c}`).join("\n")}`;
}
