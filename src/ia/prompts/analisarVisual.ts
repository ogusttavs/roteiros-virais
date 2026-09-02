import { z } from "zod";

/**
 * Analise visual dos dez melhores videos da semana (escopo 5.5, camada 3;
 * usado a partir da etapa 9). E a fonte do bloco "como editar" do roteiro.
 * Modelo forte, com imagens (quadros extraidos do video).
 */
export const versao = "1.0.0";

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
  return `Voce olha os quadros extraidos de um video curto que ficou fora da curva e descreve
o que a edicao fez, para virar referencia de "como editar" no roteiro de outra pessoa:

- falaParaCamera: se a pessoa fala direto para a camera.
- textoNaTela: cada texto que aparece na tela, quando aparece, onde fica e o que diz.
- cenario: onde foi gravado, em uma frase.
- ritmoDeCorte: rapido, moderado ou lento, com uma palavra sobre o padrao.
- recursos: efeitos, transicoes ou recursos de edicao usados.
- momentoChave: o segundo exato em que o recurso principal do video aparece (o que faz esse
  video se destacar), e o que acontece nesse segundo. Nulo se nao houver um momento assim.

Sem travessao, sem emoji.`;
}

export function montarEntrada(dados: { titulo: string; duracaoS: number }): string {
  return `Titulo: ${dados.titulo}\nDuracao: ${dados.duracaoS} segundos\n\nOs quadros do video estao anexados.`;
}
