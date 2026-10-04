/**
 * Texto da folha "Gravar agora" (V9a, item 3, `PROXIMO.md`): não existe tela
 * do Opus para o momento, a folha é montada só com peças que o design v2 já
 * entregou (regra 11). Nunca "contexto", "input" ou "transcrição": aqui é
 * sempre "o que você disse".
 */
export const textosMomento = {
  botaoAbrirHoje: "Gravar agora",
  botaoAbrirTemaLivre: "Estou num momento",
  tituloFolha: "Gravar agora",
  instrucaoAudio:
    "Fale onde você está, o que está acontecendo, o que dá para mostrar e o que você quer que quem assiste faça.",
  botaoGravar: "Gravar áudio",
  botaoParar: "Parar",
  gravando: (segundos: number) => `Gravando, ${segundos}s`,
  transcrevendo: "Ouvindo o que você gravou",
  ouEscreva: "Ou escreva direto",
  rotuloOnde: "Onde você está",
  rotuloOQueEstaAcontecendo: "O que está acontecendo",
  rotuloOQueDaParaMostrar: "O que dá para mostrar",
  oQueVoceDisse: "O que você disse",
  objetivo: "O que você quer que aconteça com o vídeo?",
  recomendado: "Recomendado pelo que você contou",
  /** V12b, item 6: rotulo visivel acima dos chips (achado do Gustavo em producao, sem titulo a pessoa nao entendia o que era). */
  falarDe: "Falar de outra marca sua também?",
  falarDeAjuda: "Se este vídeo também vai citar outra marca sua, escolha aqui. A marca do vídeo continua sendo a que está aberta.",
  falarDeNenhuma: "Nenhuma",
  campoVazio: "conte onde você está, o que está acontecendo e o que dá para mostrar",
  escreverRoteiro: "Escrever o roteiro",
  escrevendo: "Escrevendo",
  /** V11, item 3: `TelaEscrevendo`, depois do limiar de demora. */
  demorando: "Está demorando mais que o normal; você pode esperar ou voltar depois, o roteiro vai estar em Histórico",
  cancelar: "Cancelar",
  semMicrofone: "Não conseguimos usar o microfone deste aparelho. Pode escrever direto abaixo.",
  audioVazio: "Não deu para entender o áudio. Tente de novo ou escreva direto.",
  erroTranscricao: "Não conseguimos ouvir o áudio agora. Tente de novo ou escreva direto.",
  tentarDeNovo: "Tentar de novo",
  erroGerar: "Não conseguimos escrever o roteiro agora. A falha foi nossa; o que você contou continua aqui.",
  /** V9c, item 1: o controle segmentado Reels/Story, abaixo do objetivo (`sugerirFormatoPeloObjetivo`). */
  formato: "Formato",
  formatoAjuda: {
    reels: "Para o Instagram, o TikTok e o Shorts.",
    story: "No Story não tem a pergunta do que o vídeo deve fazer: ele segue o seu dia e fala com quem já te segue.",
  },
  /** M4, item 2: o segundo controle segmentado, Falando/Sem fala; sem sugestão aqui (o momento não busca evidência). */
  estilo: "Como você aparece",
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto. */
  objetivoDoVideo: "O que este vídeo precisa comunicar?",
  objetivoDoVideoOpcional: "(opcional)",
  objetivoDoVideoAjuda: "É o recado deste vídeo, não o objetivo da marca. Vai no alto do roteiro.",
  objetivoDoVideoPlaceholder: "Ex.: avisar que estou na feira escolhendo o produto novo da loja",
  /** V12c, item 3, a E37b: troca só deste vídeo, sem mudar o briefing; as opções vêm de `config/briefing.ts`. */
  quemAparece: "Quem aparece neste vídeo",
};
