/**
 * Texto de tela das marcas de fala (E41, parte 2; design v2 passo 24, `Roteiro.dc.html` e `Gravacao.dc.html`). Primeira letra maiúscula em toda frase, sem travessão, sem emoji e sem jargão.
 * 2a: o que o serviço devolve (a frase fixa da voz e os textos de apoio de cada conferência por código). 2b: a chave, a folha "Como ler as marcas", o tom do bloco e a espera.
 */
export const textosMarcasDeFala = {
  /**
   * R-FALA-24, fixa e mostrada pelo código, nunca escrita pelo modelo (`ia/prompts/marcarFala.ts` nem a menciona). Vai no pé de "Como ler as marcas" e na legenda curta do PDF. Antes de ir
   * para cliente pagante, a recomendação da seção 10 de `briefing-e-rubricas.md` é uma fonoaudióloga ler as 24 regras.
   */
  fraseDaVoz:
    "Rouquidão, ardência, falha ou cansaço para falar por mais de 15 dias: procure um fonoaudiólogo ou um otorrinolaringologista. O produto não avalia voz.",

  /** A chave de ligar e desligar, no roteiro e no modo gravação (`Roteiro.dc.html` e `Gravacao.dc.html`, passo 24). */
  chave: "Marcas de fala",
  comoLer: "Como ler as marcas",
  /** No modo gravação, em letra pequena embaixo. */
  comoLerCurto: "Como ler",
  /** A espera da primeira vez (a claquete e a frase), com o texto do roteiro já à vista. */
  marcando: "Marcando a fala",
  marcandoDetalhe: "Leva alguns segundos. O texto continua aí.",
  /** O título dos avisos que valem só para este roteiro (R-FALA-01, 04, 14 e 15), dentro de "Como ler as marcas". */
  paraEsteRoteiro: "Para este roteiro",

  /** O nome das marcas desenhadas, para o leitor de tela. */
  rotulosDasMarcas: { pausaCurta: "pausa curta", pausaLonga: "pausa longa", tomDesce: "tom desce", tomSobe: "tom sobe" },

  /** A folha "Como ler as marcas": uma marca por linha, na ordem do design (`lista-marcas-fala`), com o que a pessoa faz. */
  legenda: {
    titulo: "Como ler as marcas",
    peso: { nome: "Peso", explica: "A palavra que tem de ficar na cabeça de quem assiste. Destaque do seu jeito: suba o tom, alongue a sílaba forte ou pare um instante antes." },
    pausaCurta: { nome: "Pausa curta", explica: "Respire aqui: fim de um pedaço da ideia." },
    pausaLonga: { nome: "Pausa longa", explica: "Fim da ideia: um segundo de silêncio antes de seguir." },
    devagar: { nome: "Devagar", explica: "O que importa (preço, endereço, nome, número, o pedido final): com calma, abrindo bem a boca." },
    tomDesce: { nome: "Tom desce", explica: "Termine afirmando, com a voz descendo." },
    tomSobe: { nome: "Tom sobe", explica: "Pergunta de verdade: a voz sobe no fim." },
    tomDoBloco: { nome: "O tom do bloco", explica: "Uma palavra para o jeito do trecho, como numa conversa: direto, perto, calmo, firme. Sem teatro." },
    exemplos: { peso: "ordem", fim: "fim", devagar: "assim", desce: "certo", sobe: "será", tom: "perto" },
    notaRapido: 'Não existe marca de "rápido": para a câmera, o ritmo é de conversa, não de leitura.',
  },

  /** A linha "Tom: calmo." embaixo do bloco e o que a pessoa faz com ele (R-FALA-10 e 11: sugestão, nunca regra dura). */
  tom: {
    rotulo: (tom: "direto" | "perto" | "calmo" | "firme") => `Tom: ${tom}.`,
    dica: {
      direto: "Vá direto à ideia: a primeira frase sai inteira e com energia.",
      perto: "Fale para uma pessoa, como contando a um amigo.",
      calmo: "Desacelere e deixe a ideia assentar.",
      firme: "Peça com segurança, devagar, e termine com a voz descendo.",
    },
  },

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
    /** O limite de marcações do dia (laço ou abuso); sem número, a pessoa não vê contador. */
    limiteDoDia: "Você chegou ao limite de marcações de hoje. Amanhã a conta volta ao normal.",
    /** O roteiro foi editado enquanto as marcas eram escritas: a tela pede de novo. */
    editadoNoMeio: "O roteiro mudou enquanto marcávamos a fala. Tente de novo.",
    /** A IA falhou (saldo, limite, fora do ar): o roteiro continua inteiro, só sem as marcas. */
    naoDeu: "Não consegui marcar a fala agora. O roteiro continua aqui, tente de novo em instantes.",
  },
} as const;
