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
  /** O momento que volta preenchido: apaga o que ficou escrito (e guardado no aparelho). */
  limparRascunho: "Limpar o que escrevi",
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
    reels: "Reels, TikTok e Shorts, ou um vídeo longo para o YouTube.",
    story: "No Story não tem a pergunta do que o vídeo deve fazer: ele segue o seu dia e fala com quem já te segue.",
  },
  /**
   * E52 (PR 4, passo 25): "Quanto tempo?", só no vídeo falado (nem no Story nem no sem fala). Duas opções, não as três do desenho: o servidor tem o curto e o longo (decisão do Fable de
   * 11/10: sem "médio"), e uma opção que não muda nada seria mentira na tela.
   */
  duracao: "Quanto tempo?",
  duracaoCurta: "Até 60 segundos",
  duracaoLonga: "Mais de 3 minutos, para o YouTube",
  duracaoAjuda: "Vídeo longo vira capítulos: cada um com o seu gancho para segurar quem assiste até o próximo, e a edição de cada um. Fica melhor no YouTube; no Instagram e no TikTok, até 60 segundos rende mais.",
  /** O estado calmo (contraponto do Fable): o ramo ainda não tem a medida dos vídeos longos; dito aqui, antes de a pessoa escrever o tema, e não como erro depois. */
  duracaoLongaIndisponivel:
    "Ainda não temos vídeos longos suficientes do seu ramo para medir quanto dura e como se divide um vídeo longo dele. Assim que tivermos, essa opção abre aqui; por enquanto, o vídeo é de até 60 segundos.",
  duracaoLongaMedida: (minutos: number) => `No seu ramo, um vídeo longo costuma ter uns ${minutos} minutos.`,
  /** A pesquisa antes de escrever ainda não vale para o vídeo longo (o servidor recusa); o campo some e esta linha diz por quê. */
  duracaoLongaSemPesquisa: "O vídeo longo ainda não usa a pesquisa antes de escrever.",
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
