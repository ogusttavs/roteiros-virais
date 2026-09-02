import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Analise visual dos dez melhores videos da semana (escopo 5.5, camada 3;
 * usado a partir da etapa 9). E a fonte do bloco "como editar" do roteiro.
 * Modelo forte, com imagens (quadros extraidos do video).
 */
export const versao = "1.1.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

const textoNaTelaItem = z.object({ quando: z.string(), onde: z.string(), oQue: z.string() });
const momentoChave = z.object({ segundo: z.number(), oQue: z.string() }).nullable();

export const schema = z.object({
  falaParaCamera: z.boolean(),
  textoNaTela: z.array(textoNaTelaItem),
  cenario: z.string(),
  ritmoDeCorte: z.string(),
  recursos: z.array(z.string()),
  /** O segundo em que o recurso principal aparece ("olha como ele faz aos 0:04"). */
  momentoChave,
});

export type SaidaAnalisarVisual = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você olha os quadros extraídos de um vídeo curto que ficou fora da curva e descreve
o que a edição fez, para virar referência de "como editar" no roteiro de outra pessoa:

- falaParaCamera: se a pessoa fala direto para a câmera.
- textoNaTela: cada texto que aparece na tela, quando aparece, onde fica e o que diz.
- cenario: onde foi gravado, em uma frase.
- ritmoDeCorte: rápido, moderado ou lento, com uma palavra sobre o padrão.
- recursos: efeitos, transições ou recursos de edição usados.
- momentoChave: o segundo exato em que o recurso principal do vídeo aparece (o que faz esse
  vídeo se destacar), e o que acontece nesse segundo. Nulo se não houver um momento assim.

Sem travessão, sem emoji.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { titulo: string; duracaoS: number }): string {
  return `Titulo: ${dados.titulo}\nDuracao: ${dados.duracaoS} segundos\n\nOs quadros do video estao anexados.`;
}
