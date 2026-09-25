/**
 * As regras do Story, numeradas (V9c, item 2, E34 enxuta): o texto vem da
 * seção 9.1 de `estrategia/briefing-e-rubricas.md`, copiado, não reescrito
 * (a coluna "a regra, como o prompt recebe" dessa tabela, criada pelo Fable
 * em 22/09/2026 a partir de `pesquisa/estudo-stories.md`). Trocar uma regra
 * aqui sem trocar a seção 9 primeiro quebra a fonte da verdade; o cabeçalho
 * de cada uma diz onde a rubrica mora.
 *
 * Primeiro módulo dedicado da base numerada (o ensaio foi `planejarDia.ts`,
 * que levou só o texto de quatro regras direto no `montarSistemaEstavel`);
 * aqui vira o próprio módulo porque `roteiro.ts` (2.0.0) usa a lista duas
 * vezes: para montar o bloco do sistema estável e para o verificador
 * conferir que `porQueAssim` só cita números que existem.
 */

export type RegraFormato = { numero: string; texto: string };

/** `estrategia/briefing-e-rubricas.md`, seção 9.1, coluna "a regra, como o prompt recebe". */
export const REGRAS_STORY: RegraFormato[] = [
  {
    numero: "R-IG-STORY-01",
    texto: "Fale com quem já te segue: nunca se apresente do zero, nunca \"segue a gente\".",
  },
  {
    numero: "R-IG-STORY-02",
    texto:
      "O primeiro cartão dá a quem já segue um motivo para não deslizar: uma pergunta direta, uma cena " +
      "inesperada do bastidor, uma continuação do que ele já viu. Não é gancho para desconhecido.",
  },
  {
    numero: "R-IG-STORY-03",
    texto:
      "Saída em cartões numerados, de 2 a 5, um assunto por cartão, até 15 segundos de fala por cartão; " +
      "cada cartão traz o que falar, o que mostrar e o texto na tela.",
  },
  {
    numero: "R-IG-STORY-04",
    texto:
      "Pelo menos um cartão pede interação por figurinha, escolhida pelo objetivo: enquete, emoji " +
      "deslizável ou teste para \"que lembrem de você\"; caixinha de perguntas, link ou \"me responde aqui\" " +
      "para \"que te chamem para comprar\". Diga qual figurinha e o que escrever nela.",
  },
  {
    numero: "R-IG-STORY-05",
    texto: "Todo cartão com fala tem uma frase curta fixada na tela.",
  },
  {
    numero: "R-IG-STORY-06",
    texto: "Mostre a cena real: o bastidor, o trabalho acontecendo, o lugar. Nada de parede lisa.",
  },
  {
    numero: "R-IG-STORY-07",
    texto:
      "O último cartão fecha a conversa, não o vídeo: \"me responde aqui\", \"vota\", \"manda no Direct\", " +
      "\"toca no link\", conforme o objetivo.",
  },
  {
    numero: "R-IG-STORY-08",
    texto: "Se a cena tem lugar, use a figurinha de localização; se tem outra conta, mencione.",
  },
  {
    numero: "R-IG-STORY-09",
    texto: "Prefira áudio original a música da biblioteca quando o story vai virar destaque ou ser medido.",
  },
  {
    numero: "R-IG-STORY-10",
    texto: "Story não serve para ser descoberto: se o objetivo é \"que mais gente te conheça\", sugira Reels.",
  },
];

/** O texto das regras, uma por linha, com o número na frente (o que entra no bloco estável do prompt). */
export function textoRegrasStory(): string {
  return REGRAS_STORY.map((r) => `${r.numero}: ${r.texto}`).join("\n");
}

/** Os números válidos, para o verificador reprovar `porQueAssim` que cite uma regra inventada. */
export const NUMEROS_REGRAS_STORY = new Set(REGRAS_STORY.map((r) => r.numero));
