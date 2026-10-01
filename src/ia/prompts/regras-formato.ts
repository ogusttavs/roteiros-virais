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
 *
 * E40, item 3, primeira troca desde que o arquivo existe: `R-IG-STORY-03` mudou (decisão do
 * Gustavo, 1 a 5 stories em vez de 2 a 5, até 60s de fala em vez de 15s), e as regras 02, 04, 05
 * e 07 trocam "cartão" por "story" (a mesma troca que o resto do prompt e a tela fazem). Versao
 * 1.1.0.
 *
 * R1 (as 45 regras das plataformas dentro do roteiro e dos temas, pedido do Gustavo em
 * 29/09/2026): as outras 35 regras entram, copiadas das seções 9.2 a 9.4 das rubricas, nos
 * mesmos moldes da 9.1. `regrasDoReels` escolhe o conjunto certo pela rede principal da marca
 * (Instagram é o padrão do produto, sem rede escolhida); YouTube soma as regras de vídeo longo
 * às de Short quando a duração típica do nicho passa de 60s, porque as duas se aplicam ao mesmo
 * vídeo nesse caso. Versao 1.2.0.
 */
export const versao = "1.2.0";

export type RegraFormato = { numero: string; texto: string };

/** A rede de onde vieram as regras, e o conjunto delas: o que `roteiro.ts` precisa para montar o bloco e nomear a rede no texto. */
export type RegrasDaRede = { nome: string; regras: RegraFormato[] };

/** `estrategia/briefing-e-rubricas.md`, seção 9.1, coluna "a regra, como o prompt recebe". */
export const REGRAS_STORY: RegraFormato[] = [
  {
    numero: "R-IG-STORY-01",
    texto: 'Fale com quem já te segue: nunca se apresente do zero, nunca "segue a gente".',
  },
  {
    numero: "R-IG-STORY-02",
    texto:
      "O primeiro story dá a quem já segue um motivo para não deslizar: uma pergunta direta, uma cena " +
      "inesperada do bastidor, uma continuação do que ele já viu. Não é gancho para desconhecido.",
  },
  {
    numero: "R-IG-STORY-03",
    texto:
      "Saída em sequência de stories numerados, de 1 a 5, um assunto por story, até 60 segundos de fala " +
      "por story; cada story traz o que falar, o que mostrar e o texto na tela.",
  },
  {
    numero: "R-IG-STORY-04",
    texto:
      "Pelo menos um story pede interação por figurinha, escolhida pelo objetivo: enquete, emoji " +
      'deslizável ou teste para "que lembrem de você"; caixinha de perguntas, link ou "me responde aqui" ' +
      'para "que te chamem para comprar". Diga qual figurinha e o que escrever nela.',
  },
  {
    numero: "R-IG-STORY-05",
    texto: "Todo story com fala tem uma frase curta fixada na tela.",
  },
  {
    numero: "R-IG-STORY-06",
    texto: "Mostre a cena real: o bastidor, o trabalho acontecendo, o lugar. Nada de parede lisa.",
  },
  {
    numero: "R-IG-STORY-07",
    texto:
      'O último story fecha a conversa, não o vídeo: "me responde aqui", "vota", "manda no Direct", ' +
      '"toca no link", conforme o objetivo.',
  },
  {
    numero: "R-IG-STORY-08",
    texto: "Se a cena tem lugar, use a figurinha de localização; se tem outra conta, mencione.",
  },
  {
    numero: "R-IG-STORY-09",
    texto:
      "Prefira áudio original a música da biblioteca quando o story vai virar destaque ou ser medido.",
  },
  {
    numero: "R-IG-STORY-10",
    texto:
      'Story não serve para ser descoberto: se o objetivo é "que mais gente te conheça", sugira Reels.',
  },
];

/** `estrategia/briefing-e-rubricas.md`, seção 9.2, coluna "a regra, como o prompt recebe". */
export const REGRAS_REEL: RegraFormato[] = [
  {
    numero: "R-IG-REEL-01",
    texto: "Os dois primeiros segundos já mostram o assunto; o gancho não é saudação nem pergunta genérica.",
  },
  {
    numero: "R-IG-REEL-02",
    texto:
      "Escrito para ser assistido inteiro: um assunto, sem intro, resultado antes do fim; duração a " +
      "que o assunto pede, nunca acima de 3 minutos.",
  },
  {
    numero: "R-IG-REEL-03",
    texto:
      "Feito para ser compartilhado ou salvo: uma informação útil que a pessoa manda para alguém " +
      "(tutorial, instrução, avaliação).",
  },
  {
    numero: "R-IG-REEL-04",
    texto:
      "Cena real, gravada no lugar, com o resultado visível (antes e depois quando houver); nada de " +
      "parede lisa nem estúdio.",
  },
  {
    numero: "R-IG-REEL-05",
    texto: "Legenda na tela em toda fala; o texto nunca é a maior parte do vídeo.",
  },
  {
    numero: "R-IG-REEL-06",
    texto: "Vídeo original da conta: sem marca d'água de outra rede, sem borda, sem repostagem, com áudio.",
  },
  {
    numero: "R-IG-REEL-07",
    texto: "Áudio original preferido; áudio de tendência só quando o vídeo é feito para ele.",
  },
  {
    numero: "R-IG-REEL-08",
    texto:
      'Chamada final pede o que o sistema prevê: compartilhar com alguém, salvar, comentar, ir ao ' +
      'perfil; "me segue" só depois do motivo.',
  },
  {
    numero: "R-IG-REEL-09",
    texto: "Legenda do post curta e com o assunto; de 3 a 5 hashtags do nicho.",
  },
  {
    numero: "R-IG-REEL-10",
    texto: "Nunca cena gerada por IA; a pessoa real gravando é o que a plataforma não rotula.",
  },
  {
    numero: "R-IG-REEL-11",
    texto:
      'Objetivo "que te chamem para comprar" ou "que lembrem de você": sugerir Story junto; "que ' +
      'mais gente te conheça": Reel.',
  },
];

/** `estrategia/briefing-e-rubricas.md`, seção 9.3, coluna "a regra, como o prompt recebe". */
export const REGRAS_TIKTOK: RegraFormato[] = [
  {
    numero: "R-TT-VIDEO-01",
    texto:
      "Os três primeiros segundos mostram o problema ou o resultado, com contexto claro na tela; " +
      "nada de cumprimento, intro lenta ou silêncio.",
  },
  {
    numero: "R-TT-VIDEO-02",
    texto:
      "Escrito para ser assistido até o fim: um assunto só, sem pausa, com uma virada ou revelação " +
      "antes do fim.",
  },
  {
    numero: "R-TT-VIDEO-03",
    texto: "Duração alvo neste nicho: 30 a 90 segundos de fala; acima de 90 só com motivo escrito.",
  },
  {
    numero: "R-TT-VIDEO-04",
    texto: "Legenda na tela durante toda a fala, dentro da área segura.",
  },
  {
    numero: "R-TT-VIDEO-05",
    texto: "Cena real, gravado no lugar, sem produção.",
  },
  {
    numero: "R-TT-VIDEO-06",
    texto:
      "Original: fala própria, ângulo próprio; nunca repostagem, reação vazia, slide ou tela dividida.",
  },
  {
    numero: "R-TT-VIDEO-07",
    texto: "Ângulo específico com promessa mensurável (tempo, quantidade, prazo) no gancho.",
  },
  {
    numero: "R-TT-VIDEO-08",
    texto:
      "Legenda (caption) como segundo gancho, direta, com pergunta que convida comentário; de 2 a 4 " +
      "hashtags do nicho.",
  },
  {
    numero: "R-TT-VIDEO-09",
    texto: "Capa com o assunto visível e um título curto de valor.",
  },
  {
    numero: "R-TT-VIDEO-10",
    texto:
      'Nunca "me segue" como chamada; a chamada é comentar, salvar, compartilhar ou ir ao perfil.',
  },
  {
    numero: "R-TT-VIDEO-11",
    texto:
      "Estilo reconhecível entre vídeos (mesma abertura de cena, mesmo lugar ou frase de assinatura), " +
      "dentro do nicho.",
  },
  {
    numero: "R-TT-VIDEO-12",
    texto: "Música de fundo é opcional; se entrar, da biblioteca do app.",
  },
];

/** `estrategia/briefing-e-rubricas.md`, seção 9.4, coluna "a regra, como o prompt recebe" (Shorts). */
export const REGRAS_SHORT: RegraFormato[] = [
  {
    numero: "R-YT-SHORT-01",
    texto: "Short vertical de até 3 minutos; alvo neste nicho de 15 a 60 segundos.",
  },
  {
    numero: "R-YT-SHORT-02",
    texto: "Os primeiros segundos mostram o que o título prometeu; nada de intro.",
  },
  {
    numero: "R-YT-SHORT-03",
    texto: "Escrito para ser assistido inteiro: o melhor momento vem cedo e o vídeo acaba no resultado.",
  },
  {
    numero: "R-YT-SHORT-04",
    texto:
      "Título de até 100 caracteres que descreve o conteúdo com precisão, sem caixa alta nem " +
      "exclamações em série.",
  },
  {
    numero: "R-YT-SHORT-05",
    texto:
      "Uma receita ou um número concreto no gancho quando houver (quantidade, tempo, antes e depois).",
  },
  {
    numero: "R-YT-SHORT-06",
    texto: "Cena real, sem estúdio; o trabalho acontecendo.",
  },
  {
    numero: "R-YT-SHORT-07",
    texto: 'Chamada final pede o próximo vídeo ou o comentário; nunca só "se inscreva".',
  },
  {
    numero: "R-YT-SHORT-08",
    texto:
      "O roteiro nunca pede cena gerada por IA; roteiro feito com IA para pessoa real não precisa de " +
      "rótulo.",
  },
];

/** `estrategia/briefing-e-rubricas.md`, seção 9.4, coluna "a regra, como o prompt recebe" (vídeo longo). */
export const REGRAS_YT_VIDEO: RegraFormato[] = [
  {
    numero: "R-YT-VIDEO-01",
    texto: "Vídeo longo: os primeiros 30 segundos entregam o que o título prometeu.",
  },
  {
    numero: "R-YT-VIDEO-02",
    texto:
      "Vídeo longo precisa ter motivo para ser longo (etapas de verdade); o momento mais forte vem cedo.",
  },
  {
    numero: "R-YT-VIDEO-03",
    texto: "Título e descrição com as palavras que a pessoa pesquisaria; tags não importam.",
  },
  {
    numero: "R-YT-VIDEO-04",
    texto: "Série: o vídeo novo aponta para o anterior.",
  },
];

/** O texto das regras, uma por linha, com o número na frente (o que entra no bloco estável do prompt). */
export function textoRegras(regras: RegraFormato[]): string {
  return regras.map((r) => `${r.numero}: ${r.texto}`).join("\n");
}

/** O texto das regras do Story, uma por linha, com o número na frente (o que entra no bloco estável do prompt). */
export function textoRegrasStory(): string {
  return textoRegras(REGRAS_STORY);
}

/** Os números válidos, para o verificador reprovar `porQueAssim` que cite uma regra inventada. */
export const NUMEROS_REGRAS_STORY = new Set(REGRAS_STORY.map((r) => r.numero));

/**
 * R1, item 2: o roteiro de Reels recebe as regras da rede principal da marca
 * (`clientes.redePrincipal`); sem rede escolhida, Instagram é o padrão do produto. YouTube soma
 * as regras de vídeo longo às de Short quando a duração típica do nicho passa de 60s (as duas
 * valem para o mesmo vídeo nesse caso; `duracaoTipicaMaxS` vem de `modeloNicho.duracaoTipicaS.max`).
 */
export function regrasDoReels(
  redePrincipal: "youtube" | "tiktok" | "instagram" | null | undefined,
  duracaoTipicaMaxS: number | undefined,
): RegrasDaRede {
  if (redePrincipal === "tiktok") return { nome: "TikTok", regras: REGRAS_TIKTOK };
  if (redePrincipal === "youtube") {
    const comVideoLongo = duracaoTipicaMaxS !== undefined && duracaoTipicaMaxS > 60;
    return { nome: "YouTube", regras: comVideoLongo ? [...REGRAS_SHORT, ...REGRAS_YT_VIDEO] : REGRAS_SHORT };
  }
  return { nome: "Instagram", regras: REGRAS_REEL };
}
