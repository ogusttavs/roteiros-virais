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
  recomendado: "Recomendado",
  falarDe: "Falar de",
  falarDeNenhuma: "Nenhuma",
  campoVazio: "conte onde você está, o que está acontecendo e o que dá para mostrar",
  escreverRoteiro: "Escrever o roteiro",
  escrevendo: "Escrevendo",
  cancelar: "Cancelar",
  semMicrofone: "Não conseguimos usar o microfone deste aparelho. Pode escrever direto abaixo.",
  audioVazio: "Não deu para entender o áudio. Tente de novo ou escreva direto.",
  erroTranscricao: "Não conseguimos ouvir o áudio agora. Tente de novo ou escreva direto.",
  tentarDeNovo: "Tentar de novo",
  erroGerar: "Não conseguimos escrever o roteiro agora. A falha foi nossa; o que você contou continua aqui.",
  /** V9c, item 1: o controle segmentado Reels/Story, abaixo do objetivo (`sugerirFormatoPeloObjetivo`). */
  formato: "Formato",
  formatoAjuda: {
    reels: "Para esse objetivo, hoje um Reels alcança mais gente nova.",
    story: "Para esse objetivo, hoje um Story com caixinha rende mais.",
  },
};
