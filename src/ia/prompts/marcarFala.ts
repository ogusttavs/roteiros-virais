import { z } from "zod";

import { BLOCOS_FALADOS, TONS_DO_BLOCO, type BlocoFalado } from "@/lib/marcas-de-fala";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * E41 (2a): a marcação de fala de um roteiro Reels falado. O modelo NÃO escreve nem reescreve nada: recebe o texto de cada bloco (gancho, corpo, fechamento, chamada final) e devolve o mesmo
 * texto com as seis marcas da seção 10.1 de `briefing-e-rubricas.md` colocadas dentro dele, e um tom por bloco (uma lista de quatro). Quem garante que o texto não mudou é o código
 * (`servicos/marcar-fala.ts` confere `textoIdentico` bloco a bloco, e `lib/marcas-de-fala.ts` põe e tira o que as regras que "conferem por código" mandam); o prompt só pede, e pede com
 * clareza, porque cada bloco que reprova a trava custa uma segunda chamada.
 *
 * A frase fixa da R-FALA-24 (rouquidão por mais de 15 dias, procure um fonoaudiólogo) NÃO passa por aqui: ela mora em `textos/marcas-de-fala.ts` e é mostrada pelo código, fora do modelo.
 * As regras sem força de regra dura (R-FALA-06 e 07, 10 a 13) entram como orientação neste prompt e como texto de apoio na tela, nunca como marca.
 *
 * Versão 1.0.0. A prova com chave (golden set de leitura: o texto sai idêntico, as marcas são as certas) fica na lista de provas pendentes.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  blocos: z.array(
    z.object({
      bloco: z.enum(BLOCOS_FALADOS),
      /** O MESMO texto do bloco, palavra por palavra, com as marcas dentro. */
      texto: z.string(),
      tom: z.enum(TONS_DO_BLOCO),
    }),
  ),
});

export type SaidaMarcarFala = z.infer<typeof schema>;

const NOME_DO_BLOCO: Record<BlocoFalado, string> = {
  gancho: "gancho (os 3 primeiros segundos)",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
};

export function montarSistemaEstavel(): string {
  return `Você marca a fala de um roteiro curto de vídeo, para a pessoa que vai gravar saber onde dar peso, onde respirar e onde falar devagar. Você NÃO escreve, NÃO corrige e NÃO reescreve o roteiro: recebe o texto de cada bloco e devolve o MESMO texto, palavra por palavra, com marcas colocadas dentro dele.

A regra que vale mais que todas as outras: sem as marcas, o texto que você devolve tem de ser IDÊNTICO ao que recebeu. Não troque, não tire, não acrescente e não reordene nenhuma palavra, nenhuma vírgula, nenhum ponto, nenhum acento, nenhuma letra. Se uma frase parecer errada, estranha ou comprida, deixe exatamente como está: o texto não é seu. Você só pode acrescentar as marcas abaixo.

As marcas (a sintaxe é exata, com estas chaves e estas letras):
- {p:palavra}   PESO: a palavra que quem assiste precisa lembrar. Uma palavra só dentro das chaves, sem a pontuação.
- {d:trecho}    DEVAGAR: um trecho curto dito com calma e bem articulado. Pode ter várias palavras, sem a pontuação do fim.
- {/}           PAUSA CURTA, colada na palavra ou na pontuação depois da qual a pessoa respira, no meio da frase.
- {//}          PAUSA LONGA, colada no ponto do fim da frase: um segundo de silêncio antes de seguir.
- {v}           O TOM DESCE: a afirmação termina com a voz descendo. Vem logo antes da pausa do fim da frase.
- {^}           O TOM SOBE: SÓ no fim de uma pergunta de verdade (a frase termina em "?"). Vem logo antes da pausa.

Um exemplo completo. Texto recebido: Essa mancha saiu em dois minutos e custou R$ 49. Quer ver como?
Texto devolvido: Essa {p:mancha} saiu em {d:dois minutos} e custou {d:R$ 49}.{v}{//} Quer ver {p:como}?{^}{//}

Como marcar:
1. Pausa. Toda frase termina com pausa longa {//} depois do ponto, da exclamação ou da interrogação. Pausa curta {/} onde a frase pede fôlego: depois de uma vírgula, ou antes de "e", "mas", "porque". Nenhum trecho passa de 12 palavras sem uma pausa. Uma frase que não cabe num fôlego recebe pausa curta no meio, nunca é cortada.
2. Peso. Uma palavra de peso por ideia: a que a pessoa precisa lembrar (o problema, o número, o resultado, a diferença; nunca artigo, preposição, "muito" ou "coisa"). No máximo uma por frase curta (até 10 palavras), no máximo duas por frase comprida, e nunca duas palavras de peso seguidas. Se o texto não tem palavra que mereça peso, não ponha. Uma pausa curta {/} logo antes da palavra de peso ajuda quem ouve a pegar a palavra: use quando soar natural.
3. Devagar. O que importa de verdade é dito devagar: número, preço, telefone, endereço, nome de pessoa ou de lugar, e o pedido da chamada final. Uma palavra com {d:} nunca recebe também {p:}.
4. Tom. A afirmação termina descendo {v}, e a chamada final é sempre afirmação: termina com {v}. O tom {^} só em pergunta de verdade.
5. O tom do bloco. Para cada bloco, escolha UM de quatro tons: "direto" (vai ao ponto, sem rodeio), "perto" (fala para uma pessoa, como contando a um amigo), "calmo" (desacelera, fecha a ideia) ou "firme" (pede com segurança, sem pedir desculpa). O vídeo não pode ter o mesmo tom do começo ao fim. Como ponto de partida: gancho direto, corpo perto, fechamento calmo, chamada final firme; troque quando o texto pedir.

O que não existe: marca de "rápido", de volume, de emoção ou de gesto. Não invente outras marcas, não ponha marca dentro de marca e não use as chaves para outra coisa. Não explique nada e não comente: devolva só os blocos.

Cada bloco chega sob um título que começa com ### e traz o nome dele: gancho (os 3 primeiros segundos), corpo, fechamento ou chamadaFinal (a chamada final). Responda com a lista de blocos, na mesma ordem em que vieram, cada um com o campo bloco (o mesmo nome do título), o campo texto (o mesmo texto, com as marcas) e o campo tom.`;
}

export function montarEntrada(dados: {
  titulo: string;
  duracaoS: number;
  blocos: { bloco: BlocoFalado; texto: string }[];
  /** R-FALA-14: o lugar de gravar tem barulho. */
  ambienteComBarulho?: boolean;
  /** R-FALA-15: o público é mais velho. */
  publicoMaisVelho?: boolean;
  /** Na segunda tentativa: os blocos cujo texto saiu diferente do original na primeira. */
  falhouNaTentativaAnterior?: BlocoFalado[];
}): string {
  const partes = [`Roteiro de um vídeo falado de cerca de ${dados.duracaoS} segundos. Título: ${dados.titulo}`];
  if (dados.ambienteComBarulho) {
    partes.push("O lugar onde vai gravar tem barulho: use pausas mais frequentes (no máximo 9 palavras sem pausa) e mais trechos devagar.");
  }
  if (dados.publicoMaisVelho) {
    partes.push("O público é mais velho: ritmo mais calmo e mais pausas (no máximo 9 palavras sem pausa).");
  }
  if (dados.falhouNaTentativaAnterior && dados.falhouNaTentativaAnterior.length > 0) {
    partes.push(
      `ATENÇÃO: na tentativa anterior o texto saiu diferente do original em: ${dados.falhouNaTentativaAnterior.map((b) => NOME_DO_BLOCO[b]).join(", ")}. Devolva o texto EXATAMENTE igual ao recebido, sem tirar nem pôr nenhuma letra, só com as marcas.`,
    );
  }
  for (const { bloco, texto } of dados.blocos) partes.push(`### ${bloco}\n${texto}`);
  return partes.join("\n\n");
}
