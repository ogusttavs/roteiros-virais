import type { DataMarcada, TipoDeData } from "@/config/datas";

/**
 * O calendário de datas (E60): feriados, datas que vendem e dias do ramo, no Planejar, no Hoje, no Criar e no aviso de manhã.
 * Linguagem de gente: "Hoje é Dia das Mães", nunca "sazonalidade" nem "data de oportunidade".
 */
export const textosDatas = {
  /** O selo pequeno que diz que tipo de data é. */
  tipo: {
    feriado: "Feriado",
    "ponto-facultativo": "Ponto facultativo",
    comercial: "Data que vende",
    "do-ramo": "Data do seu ramo",
  } satisfies Record<TipoDeData, string>,

  /** O nome de uma ou mais datas do mesmo dia, para o dia do calendário: "Dia das Mães" ou "Dia das Crianças e Nossa Senhora Aparecida". */
  nomesDoDia: (datas: readonly Pick<DataMarcada, "nome">[]): string => {
    const nomes = datas.map((data) => data.nome);
    if (nomes.length <= 1) return nomes.join("");
    return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  },
  /** Para o leitor de tela e para o calendário do mês, onde o dia é um botão. */
  rotuloDoDiaComData: (dia: string, nomes: string) => `${dia}, ${nomes}`,
  legendaDoMes: "Data no calendário",

  /** O título do cartão do Hoje. */
  titulo: "Datas para lembrar",

  /** O Hoje: o que é hoje e o que vem aí. */
  hoje: (nome: string) => `Hoje é ${nome}.`,
  emDias: (nome: string, dias: number) => (dias === 1 ? `Amanhã é ${nome}.` : `Daqui a ${dias} dias é ${nome}.`),
  /** A linha de baixo do cartão do Hoje: o que fazer com a data. */
  seDaTempo: "Dá tempo de gravar sobre isso.",
  seEHoje: "Dá para gravar sobre isso ainda hoje.",
  gravarSobre: "Gravar sobre esta data",
  abrindo: "Abrindo",

  /** Na tela de temas (Criar): a data como ponto de partida, com a fonte dita. */
  sugestao: {
    titulo: "Uma data que vem aí",
    porQue: (nome: string) => `A sugestão vem da data (${nome}), não de uma pesquisa de vídeos. É um ponto de partida: você ajusta o assunto na próxima tela.`,
    fonte: (fonte: string) => `Fonte da data: ${fonte}.`,
    botao: "Escrever sobre esta data",
  },
  /** O assunto que já chega escrito no campo do Tema livre. */
  pontoDePartida: (nome: string) => `${nome}: o que eu posso gravar sobre essa data no meu negócio`,

  /** O aviso de manhã (e-mail e push): uma linha só. */
  aviso: {
    linha: (nome: string, dias: number) => `${dias === 1 ? "Amanhã" : `Daqui a ${dias} dias`} é ${nome}.`,
    ajuda: "Dá tempo de gravar sobre isso: abra o painel e escolha esse assunto.",
    nomeDaMarca: (marca: string) => ` Para ${marca}.`,
  },
} as const;
