/**
 * Texto de tela das marcas de fala (E41, parte 2; design v2 passo 24, `Roteiro.dc.html` e `Gravacao.dc.html`). Primeira letra maiúscula em toda frase, sem travessão, sem emoji e sem jargão.
 * Nesta parte (2a) entra o que o serviço devolve: a frase fixa da voz e os textos de apoio de cada conferência por código. As chaves, a folha "Como ler as marcas" e o tom do bloco na tela
 * entram na 2b.
 */
export const textosMarcasDeFala = {
  /**
   * R-FALA-24, fixa e mostrada pelo código, nunca escrita pelo modelo (`ia/prompts/marcarFala.ts` nem a menciona). Vai no pé de "Como ler as marcas" e na legenda curta do PDF. Antes de ir
   * para cliente pagante, a recomendação da seção 10 de `briefing-e-rubricas.md` é uma fonoaudióloga ler as 24 regras.
   */
  fraseDaVoz:
    "Rouquidão, ardência, falha ou cansaço para falar por mais de 15 dias: procure um fonoaudiólogo ou um otorrinolaringologista. O aplicativo não avalia a voz.",

  /** Os textos de apoio das conferências por código (`conferirFala`): aparecem em "Como ler as marcas", nunca como marca no texto. */
  avisos: {
    /** R-FALA-01: a primeira palavra do vídeo é uma muleta. */
    muleta: (palavra: string) => `O vídeo começa com "${palavra}". Entre direto na ideia: a primeira frase sai inteira e com energia, sem nada antes.`,
    /** R-FALA-04: uma frase comprida demais para um fôlego só. */
    fraseComprida: (comeco: string) => `A frase que começa com "${comeco}" é comprida para um fôlego só. Respire na pausa curta que marcamos no meio.`,
    /** R-FALA-14: o lugar de gravar tem barulho. */
    barulho: "O lugar onde você vai gravar tem barulho: fale mais devagar, com mais pausa e a boca bem aberta, sem gritar. Se der, grave a fala num lugar silencioso.",
    /** R-FALA-15: o público é mais velho. */
    publicoMaisVelho: "Seu público é mais velho: um ritmo mais calmo e mais pausas ajudam quem assiste a acompanhar.",
  },

  erros: {
    /** O roteiro não existe ou não é desta marca. */
    naoEncontrado: "Não achei este roteiro.",
    /** Story e vídeo sem fala não têm fala para marcar. */
    semFala: "Este vídeo não tem fala para marcar.",
    /** O roteiro foi editado enquanto as marcas eram escritas: a tela pede de novo. */
    editadoNoMeio: "O roteiro mudou enquanto marcávamos a fala. Tente de novo.",
    /** A IA falhou (saldo, limite, fora do ar): o roteiro continua inteiro, só sem as marcas. */
    naoDeu: "Não consegui marcar a fala agora. O roteiro continua aqui, tente de novo em instantes.",
  },
} as const;
