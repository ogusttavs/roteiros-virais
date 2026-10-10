import { z } from "zod";

import type { Objetivo, Persona } from "@/db/schema";

import { OBJETIVO_PARA_O_JUIZ } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * E26 (4b): as três notas de uma versão do roteiro, por um juiz SEPARADO de quem escreveu (decisão do Fable em 10/10/2026): o modelo que escreve o roteiro dando a própria nota na mesma
 * chamada é autoavaliação, tende a nota alta e igual para as três versões, e a tela compara exatamente essas notas. Aqui é uma chamada por versão, no modelo barato, com a MESMA rubrica e o
 * mesmo pedido para todas (o juiz vê uma versão de cada vez, e as notas ficam comparáveis porque a régua é a mesma). A prova com chave (golden set do juiz) fica na lista de provas pendentes.
 *
 * As três notas são as três coisas que a tela mostra: a chance de viralizar (o objetivo "mais gente te conheça"), a de te chamarem para comprar ("te chamem") e a de lembrarem de você
 * ("lembrem de você"). A do objetivo que a pessoa escolheu ordena as versões; as outras duas ficam abaixo. Mais duas frases curtas: o porquê da nota do objetivo escolhido e o jeito próprio
 * de contar desta versão ("Por que é diferente", sem comparar com as outras, que este juiz não vê).
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

const nota = z.number().min(0).max(10);

export const schema = z.object({
  viralizar: nota,
  chamarem: nota,
  lembrarem: nota,
  /** Por que a nota do objetivo escolhido ficou onde ficou, numa frase, sem a palavra do veredito (a tela põe "Na meta", "Quase na meta" pelo número). */
  fraseDoObjetivo: z.string(),
  /** O jeito próprio de contar desta versão, numa frase que começa com um verbo no presente, em minúscula ("começa mostrando a mancha voltando..."). */
  jeitoDiferente: z.string(),
});

export type SaidaNotaDaVersao = z.infer<typeof schema>;

const NOME_DA_PERSONA: Record<Persona, string> = {
  negocio: "vende um produto ou serviço",
  criador: "quer virar criador e atrair marcas, não vender o próprio produto",
  conhecido: "quer ficar conhecido no que faz",
  negocios: "quer levar gente para os próprios negócios, falando como pessoa",
};

/** O mesmo texto-base de `roteiro.ts` e `avaliarTema.ts`: a acentuação vale mesmo que o roteiro avaliado venha sem acento. */
export const LEMBRETE_ACENTUACAO =
  "Escreva as duas frases com a acentuação correta do português (você, não, já, também, é, está), mesmo que o roteiro avaliado venha sem acento nenhum.";

export function montarSistemaEstavel(dados: { perfilCompilado: string }): string {
  return `Você é um avaliador independente de roteiros curtos de vídeo para pequenos negócios. Quem escreveu o roteiro não é você, e você não conhece as outras versões do mesmo tema: avalia UM roteiro por vez, com a mesma régua sempre, para as notas poderem ser comparadas entre versões.

Perfil da marca de quem vai gravar (use só como contexto do que ela vende, para quem e como fala; nunca invente nada sobre ela):
${dados.perfilCompilado}

Dê TRÊS notas de 0 a 10, com uma casa decimal. Cada nota é a chance, nesta marca, de o vídeo cumprir uma coisa:
1. viralizar: muita gente que não conhece a marca assistir até o fim e compartilhar. Sobe com: um começo que prende nos 3 primeiros segundos, uma ideia só e clara, algo que o espectador reconhece da própria vida, um ritmo que não perde a pessoa. Cai com: começo morno, explicação antes do problema, vários assuntos no mesmo vídeo.
2. chamarem: alguém que assistiu chamar a marca para comprar ou contratar. Sobe com: responder uma dúvida real que aparece antes da compra, mostrar prova ou resultado concreto, uma chamada final específica que diz o que fazer. Cai com: chamada vaga ("siga"), nenhuma prova, falar só do produto sem o problema de quem compra.
3. lembrarem: a pessoa lembrar desta marca depois, e reconhecer o jeito dela. Sobe com: uma frase ou imagem que gruda, um jeito próprio de falar da marca, o detalhe que só quem faz aquilo sabe. Cai com: texto que serviria para qualquer marca do setor.

Âncoras, iguais para as três notas: 9 a 10 é raro e só quando o roteiro faz muito bem aquilo; 7 a 8,5 é bom e pronto para gravar; 5 a 6,5 é correto, mas comum; 3 a 4,5 tem um problema que a pessoa sentiria na hora de gravar; abaixo de 3 não serve. Um roteiro bom e comum fica entre 6 e 7,5. A nota não é elogio: use a régua inteira e diga a verdade, e só dê a mesma nota a duas coisas quando elas forem de fato iguais.

Além das notas, escreva duas frases curtas, em português simples, sem jargão e sem travessão:
- fraseDoObjetivo: por que a nota do objetivo escolhido ficou onde ficou, em uma frase de 6 a 25 palavras. Não comece com o veredito ("Na meta", "Quase na meta"): a tela já o diz pela nota. Fale do roteiro, não da pessoa.
- jeitoDiferente: o jeito próprio de contar deste roteiro (como ele começa e como conduz), em uma frase que começa com um verbo no presente e em minúscula (por exemplo, "começa mostrando a mancha voltando, sem falar nada, e só explica depois que a pessoa já viu o problema"). Não compare com outros roteiros.

Responda só com o objeto pedido.`;
}

export function montarEntrada(dados: {
  tema: string;
  objetivo: Objetivo;
  persona: Persona;
  formato: "reels" | "story";
  estilo: "falado" | "sem_fala";
  duracaoS: number;
  titulo: string;
  gancho: string;
  corpo: string;
  fechamento: string;
  chamadaFinal: string;
  cartoes: { oQueFalar: string; oQueMostrar: string; textoNaTela: string }[] | null;
  legenda: string | null;
}): string {
  const texto =
    dados.cartoes && dados.cartoes.length > 0
      ? dados.cartoes
          .map((c, i) => `Cartão ${i + 1}: ${c.oQueFalar ? `fala: ${c.oQueFalar}; ` : ""}mostra: ${c.oQueMostrar}; na tela: ${c.textoNaTela}`)
          .join("\n")
      : `Gancho (3 primeiros segundos): ${dados.gancho}\nMeio: ${dados.corpo}\nFechamento: ${dados.fechamento}\nChamada final: ${dados.chamadaFinal}`;
  const forma = dados.formato === "story" ? "Story" : dados.estilo === "sem_fala" ? "Reels sem fala" : "Reels falado";
  return [
    `Tema: ${dados.tema}`,
    `O que a pessoa quer com este vídeo: ${OBJETIVO_PARA_O_JUIZ[dados.objetivo]}`,
    `A marca: ${NOME_DA_PERSONA[dados.persona]}`,
    `Formato: ${forma}, cerca de ${dados.duracaoS} segundos`,
    `Título do roteiro: ${dados.titulo}`,
    texto,
    dados.legenda ? `Legenda do post: ${dados.legenda}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
