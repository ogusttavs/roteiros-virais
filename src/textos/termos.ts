import { config } from "@/lib/config";

/**
 * Termos de uso e política de privacidade (etapa 12, decisão 7 do
 * `PROXIMO.md`). Texto base escrito pelo Sonnet, em português simples, sem
 * jargão: marcar "texto base, revisão jurídica pendente" só fora de
 * produção (`avisoRevisaoPendente`, mostrado pelas próprias páginas quando
 * `process.env.NODE_ENV !== "production"`). A regra do escopo 4.9 (so
 * circula padrao, nunca o roteiro nem o video de um cliente especifico)
 * esta por extenso nas duas paginas, escrita sem a palavra generica que o
 * checar-texto reprova como jargao (regras-de-texto.ts, JARGAO).
 */
export const textosTermos = {
  avisoRevisaoPendente: "texto base, revisão jurídica pendente",
  atualizadoEm: "atualizado em 4 de setembro de 2026",
  voltar: "voltar",

  termos: {
    titulo: "Termos de uso",
    secoes: [
      {
        titulo: "1. O que você contrata",
        paragrafos: [
          `Uma assinatura mensal que entrega, todo dia, temas e roteiros para você gravar vídeos sobre o seu negócio. Você grava, edita e publica; ${config.appName} não publica nada em seu nome.`,
          "Os roteiros são sugestões escritas com ajuda de inteligência artificial, a partir do que você respondeu no briefing e da pesquisa do seu nicho. Quem decide o que vai para o vídeo, grava e publica é sempre você.",
        ],
      },
      {
        titulo: "2. As suas respostas e os seus dados",
        paragrafos: [
          "O que você escreve no briefing é usado para escrever os seus roteiros e para acompanhar o seu negócio. Você pode editar as respostas quando quiser, em Briefing e em Conta.",
        ],
      },
      {
        titulo: "3. O que aprendemos entre clientes",
        paragrafos: [
          "Cada vídeo que você posta vira um ponto de dado com resultado real, e esse resultado ajuda a melhorar os roteiros de outros clientes, do seu nicho e de outros nichos.",
          "A regra é fixa: só circula o padrão que funcionou, nunca o roteiro, o vídeo ou os números de um cliente específico. Você nunca vê o roteiro nem os números de outro cliente, e nenhum outro cliente vê os seus. O que chega até você é uma frase como \"vídeos respondendo uma dúvida, com 25 segundos, estão rendendo o dobro no seu setor\", nunca um vídeo, um roteiro ou um número de alguém que dá para identificar.",
        ],
      },
      {
        titulo: "4. Cancelamento",
        paragrafos: [
          "Você cancela quando quiser, em Conta. O acesso continua até o fim do período já pago, sem multa.",
        ],
      },
      {
        titulo: "5. Contato",
        paragrafos: [`Dúvida sobre estes termos, escreva para ${config.emailContato}.`],
      },
    ],
  },

  privacidade: {
    titulo: "Política de privacidade",
    secoes: [
      {
        titulo: "1. O que guardamos",
        paragrafos: [
          "O briefing (as respostas sobre o seu negócio), os roteiros gerados para você, e os links dos vídeos que você marca como postado. Guardamos também os perfis que você informa em Conta (Instagram, TikTok, YouTube).",
        ],
      },
      {
        titulo: "2. Por quanto tempo",
        paragrafos: [
          "Enquanto a sua conta estiver ativa, e por até 12 meses depois do cancelamento, para o caso de você voltar a assinar. Passado esse prazo, ou a qualquer momento a seu pedido, apagamos o briefing e os roteiros.",
        ],
      },
      {
        titulo: "3. Uso de inteligência artificial",
        paragrafos: [
          "Usamos modelos de IA (da Anthropic) para escrever os seus roteiros e avaliar os seus temas, a partir do seu briefing e da pesquisa do nicho. As suas respostas não são usadas para treinar modelo nenhum; são contexto de uma chamada, como uma pergunta feita à IA a cada roteiro.",
        ],
      },
      {
        titulo: "4. O que aprendemos entre clientes",
        paragrafos: [
          "Como explicado nos termos de uso: só circula o padrão que funcionou, nunca o roteiro, o vídeo ou os números de um cliente específico. O resultado dos seus vídeos ajuda a melhorar o sistema para todo mundo, mas ninguém vê o seu roteiro, o seu número ou o seu vídeo além de você.",
        ],
      },
      {
        titulo: "5. Seus direitos",
        paragrafos: [
          "Você pode ver, editar ou pedir a exclusão dos seus dados a qualquer momento, escrevendo para o contato abaixo.",
        ],
      },
      {
        titulo: "6. Contato",
        paragrafos: [`Dúvida sobre os seus dados, escreva para ${config.emailContato}.`],
      },
    ],
  },

  aceite: {
    titulo: "Antes de entrar",
    itens: [
      "Os roteiros são sugestões; quem grava e publica é você.",
      "As suas respostas servem só para escrever os seus roteiros.",
      "Você cancela quando quiser, em Conta.",
    ],
    lerTermos: "ler os termos",
    aceitar: "li e aceito",
    erro: "não conseguimos salvar agora; tente de novo em um minuto",
  },
};
