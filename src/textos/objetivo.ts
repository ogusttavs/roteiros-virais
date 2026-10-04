/**
 * Texto de tela de `/criar/objetivo` (etapa 11, brief-frontend.md, seção
 * 6.5, passo intermediário; `ObjetivoFluxo.dc.html`;
 * `entrega/textos.ts`, bloco `objetivo`).
 *
 * O título de cada opção ("Mais gente me conhecer") e a frase de ajuda
 * ficam em `src/ia/enums.ts` (`NOME_OBJETIVO`, `AJUDA_OBJETIVO`), não aqui:
 * a chave do objeto seria um dos três nomes internos do objetivo, que
 * coincidem com o jargão proibido em `regras-de-texto.ts` (mesmo motivo
 * de `ROTULO_TEMA_CARTAO`, etapa 10).
 */

export const textosObjetivo = {
  temaEscolhido: "Tema escolhido",
  /** Na tela de erro (V7, item 2 do PROXIMO.md): o que a pessoa tinha escolhido continua na tela, ao lado do "Tentar de novo". */
  objetivoEscolhido: "Objetivo escolhido",
  pergunta: "O que você quer que esse vídeo faça?",
  recomendado: "Recomendado hoje",
  /** E49 PR 1: o apoio abaixo da pergunta das cinco fichas. */
  apoio: "A resposta muda o texto inteiro, não só o final: o começo, o jeito de contar e o que você pede no fim. Dá para trocar depois.",
  /** E49 PR 1: por que a ficha recomendada, uma frase por ficha. */
  recomendaPeloTema: "A gente recomenda pelo tema: ",
  recomendaPeloHistorico: "A gente recomenda pelo que você tem postado: ",
  razaoDaRecomendada: {
    veja: "um assunto em alta no seu ramo, com um começo forte, faz muita gente parar para ver.",
    guardem: "um erro com o jeito certo é coisa que as pessoas guardam para usar depois.",
    mandem: "é uma situação que a pessoa reconhece na hora e manda para quem precisa ver.",
    comentem: "é um assunto que divide opinião e faz muita gente querer responder.",
    me_chamem: "quem está quase decidindo precisa ver a prova de que funciona.",
  },
  /** E49 PR 1: os prefixos das linhas das fichas ("Por exemplo: ...", "Ajuda em: ..."). */
  exemploPrefixo: "Por exemplo: ",
  ajudaEmPrefixo: "Ajuda em: ",
  /** E49 PR 2: a ficha escolhida fica sozinha, com "Ver as cinco de novo", e embaixo os exemplos do setor. */
  verAsCincoDeNovo: "Ver as cinco de novo",
  exemplosTitulo: "Exemplos que fazem isso",
  exemplosFrase: (paraQue: string) => `Vídeos do seu setor que parecem feitos para ${paraQue}. É uma leitura nossa do vídeo, não um número da rede.`,
  verMaisEmReferencias: "Ver mais em Referências",
  semExemplosTitulo: "Ainda não temos exemplos deste tipo no seu setor.",
  semExemplosTexto: "O roteiro sai do mesmo jeito: a gente usa o que as plataformas pedem para esse tipo de vídeo. Os exemplos aparecem aqui quando o seu setor tiver.",
  carregandoExemplos: "Procurando exemplos no seu setor",
  /** E49 PR 1: no vídeo sem fala as fichas somem (a estrutura delas pressupõe fala), com a linha que diz por quê. */
  semFalaTitulo: "No vídeo sem fala, a conversa é feita de cenas",
  semFalaTexto: "O vídeo sem fala segue o roteiro de cenas: o que mostrar e o texto na tela. Por isso ele não pergunta para que é o vídeo.",
  /** E49 PR 1, o Story não pergunta: o título, o apoio e o cartão que explica por quê. */
  storyTitulo: "Antes de escrever o seu Story",
  storyApoio: "Só falta dizer quem aparece.",
  storyCartaoTitulo: "No Story, a conversa é com quem já te segue",
  storyCartaoTexto: "O Story segue o seu dia: o bastidor, a caixinha de perguntas, a enquete, a continuação do que você postou. Por isso ele não pergunta para que é o vídeo.",
  reelsCartao: "Reels, para o Instagram, o TikTok e o Shorts",
  storyCartao: "Story, para quem já te segue",
  escrever: "escrever o roteiro",
  demorando: "Está demorando mais que o normal; você pode esperar ou voltar depois, o roteiro vai estar em Histórico",
  erro: "Não conseguimos escrever agora. O tema e o objetivo continuam aqui; tente de novo.",
  /** V9c, item 1: o controle segmentado Reels/Story; E49 PR 1: agora vem antes da pergunta das fichas. */
  formato: "Formato",
  formatoAjuda: {
    reels: "Para o Instagram, o TikTok e o Shorts.",
    story: "Para quem já te segue, no dia a dia.",
  },
  /** M4, item 2: o segundo controle segmentado, Falando/Sem fala (`sugerirEstiloPelaEvidencia`). */
  estilo: "Como você aparece",
  estiloAjuda: {
    falado: "No seu setor, os vídeos que mais rendem sobre isso têm alguém falando.",
    sem_fala: "No seu setor, os vídeos que mais rendem sobre isso não têm fala.",
  },
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto. */
  objetivoDoVideo: "O que este vídeo precisa comunicar?",
  objetivoDoVideoOpcional: "(opcional)",
  objetivoDoVideoAjuda: "É o recado deste vídeo, não o objetivo da marca. Vai no alto do roteiro.",
  objetivoDoVideoPlaceholder: "Ex.: avisar que o horário de atendimento mudou nesta semana",
  /** V12c, item 3, a E37b: troca só deste vídeo, sem mudar o briefing; as opções vêm de `config/briefing.ts`. */
  quemAparece: "Quem aparece neste vídeo",
};
