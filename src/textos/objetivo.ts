/**
 * Texto de tela de `/hoje/objetivo` (etapa 11, brief-frontend.md, seção
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
  escrever: "escrever o roteiro",
  demorando: "Está demorando mais que o normal; você pode esperar ou voltar depois, o roteiro vai estar em Histórico",
  erro: "Não conseguimos escrever agora. O tema e o objetivo continuam aqui; tente de novo.",
  /** V9c, item 1: o controle segmentado Reels/Story, abaixo do objetivo (`sugerirFormatoPeloObjetivo`). */
  formato: "Formato",
  formatoAjuda: {
    reels: "Para esse objetivo, hoje um Reels alcança mais gente nova.",
    story: "Para esse objetivo, hoje um Story com caixinha rende mais.",
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
};
