/**
 * Texto de `/criar` (E39a, design v2, `entregaveis/design-v2/entrega/telas/Criar.dc.html`,
 * estado `inicio`, e a dúvida 14 da primeira entrega do passo 10) e do bloco "para quando é" e
 * "em que momento do dia", compartilhado por `ObjetivoTela` e `FolhaGravarAgora` (dúvida 10: o
 * mesmo bloco, só muda de lugar em cada caminho).
 */

export const textosCriar = {
  titulo: "Criar roteiros",
  subtitulo: "Escolha por onde começar. Para quando é, você diz no caminho.",
  caminhoTemas: {
    titulo: "Os temas de hoje",
    ajuda: "Três assuntos que estão funcionando no seu setor agora.",
  },
  caminhoAssuntoSeu: {
    titulo: "Um assunto seu",
    ajuda: "Você escreve sobre o que quer falar, e a gente dá a nota antes de escrever.",
  },
  caminhoMomento: {
    titulo: "Contar o momento",
    ajuda: "Fale ou escreva onde você está, ou onde vai estar, e o que está acontecendo.",
  },
  caminhoPlano: {
    titulo: "Planejar os próximos dias",
    /** E39c, parte 2a: a porta leva à aba Planejar, na visão Semana. */
    ajuda: "Veja a semana e o mês e marque o que gravar em cada dia.",
  },
  notaAgenda: "Tudo o que você cria fica marcado no dia, em Hoje.",

  /**
   * E55 PR 2b (passo 21 do Opus, `Criar.dc.html`, estados `inicioEmAlta` e `inicioSemEncaixe`): o cartão do assunto do momento no alto da oficina, e a lista dos assuntos que não couberam no
   * ramo. Nunca a palavra "tendência" na tela.
   */
  emAlta: {
    trazerDeOutroJeito: "Trazer para o meu ramo de outro jeito",
    semEncaixe: {
      origem: "Em alta no Brasil hoje",
      titulo: "Nada disso cabe bem no seu ramo hoje",
      trazer: "Trazer para o meu ramo",
      trazerAria: (assunto: string) => `Trazer para o meu ramo: ${assunto}`,
      explicacao: "Por isso a gente não sugeriu tema. Se você vê um jeito, ele abre em \"Um assunto seu\", já escrito, e recebe a nota antes do roteiro.",
      delicado: "Assunto delicado, como política e tragédia, não aparece aqui. Se quiser falar de um, escreva o seu assunto.",
    },
  },

  /** O bloco "Para quando é?" (dúvida 12): o momento do dia completa o rótulo que aparece em Hoje. */
  paraQuando: "Para quando é?",
  hoje: "Hoje",
  amanha: "Amanhã",
  escolherData: "Escolher a data",
  avisoFrescor: (dia: string) =>
    `Ele vai ser escrito com o que está subindo hoje. Até ${dia} pode aparecer coisa mais nova.`,

  momentoDoDia: "Em que momento do dia?",
  momentoDoDiaAjuda: "É a ordem em que os Stories do dia aparecem em Hoje.",
  manha: "Manhã",
  meioDia: "Meio do dia",
  fimDaTarde: "Fim da tarde",
  noite: "Noite",
};
