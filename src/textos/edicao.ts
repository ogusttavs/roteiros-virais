import { LIMITES_DA_EDICAO, REFAZERES_POR_EDICAO } from "@/config/edicao";

/**
 * E47 PR 2: as frases de "Editar o meu vídeo" que o servidor devolve (recusas ao começar e ao receber o vídeo, e o motivo de uma edição que não seguiu). Linguagem de quem dirige um negócio
 * pequeno: nada de "resolução", "codec", "transcrição" ou "fila". Os números (tamanho, duração, edições do mês) saem de `config/edicao.ts`.
 */
const minutosMax = LIMITES_DA_EDICAO.duracaoMaxS / 60;

export type CodigoDaEdicao =
  | "sem-roteiro"
  | "arquivo-tipo"
  | "arquivo-vazio"
  | "arquivo-grande"
  | "limite-do-mes"
  | "em-andamento"
  | "envio-em-curso"
  | "nao-achou"
  | "nao-comecou"
  | "envio-interrompido"
  | "envio-parado"
  | "nao-abriu"
  | "sem-video"
  | "sem-som"
  | "longo"
  | "curto"
  | "qualidade-alta"
  | "sem-fala"
  | "nao-entendeu"
  | "sumiu"
  | "demorou"
  | "disco-cheio"
  | "nao-montou"
  | "em-revisao"
  | "motivo-vazio"
  | "refazer-demais"
  | "nao-e-a-hora"
  | "arquivo-saiu"
  | "so-dono"
  | "legenda-indisponivel";

export const textosEdicao = {
  frases: {
    "sem-roteiro": "Não achamos esse roteiro. Volte para a lista e abra de novo.",
    "arquivo-tipo": "Esse arquivo não é um vídeo que a gente consiga abrir. Escolha um vídeo gravado no celular, em MP4 ou MOV.",
    "arquivo-vazio": "O vídeo chegou vazio. Escolha o arquivo de novo.",
    "arquivo-grande": `O vídeo passa de ${LIMITES_DA_EDICAO.megasMax} MB. Grave um vídeo mais curto ou em qualidade HD (1080p) e tente de novo.`,
    "limite-do-mes": `Você já usou as ${LIMITES_DA_EDICAO.edicoesPorMes} edições deste mês. Elas voltam no primeiro dia do mês que vem.`,
    "em-andamento": "Já tem um vídeo seu sendo enviado ou editado para este roteiro. Espere terminar.",
    "envio-em-curso": "Este vídeo já está sendo enviado. Espere ele terminar.",
    "nao-achou": "Não achamos essa edição. Volte para o roteiro e comece de novo.",
    "nao-comecou": "Não foi possível começar agora. Tente de novo em instantes.",
    "envio-interrompido": "O envio do vídeo foi interrompido antes de terminar. Escolha o vídeo e envie de novo.",
    "envio-parado": "O envio do vídeo ficou parado por muito tempo. Escolha o vídeo e envie de novo.",
    "nao-abriu": "Não conseguimos abrir esse vídeo. Grave de novo ou escolha outro arquivo.",
    "sem-video": "Esse arquivo não tem imagem. Escolha um vídeo gravado no celular.",
    "sem-som": "O vídeo está sem som, e a edição segue o que você fala. Grave de novo com o microfone ligado.",
    longo: `O vídeo tem mais de ${minutosMax} minutos. Grave um vídeo de até ${minutosMax} minutos e envie de novo.`,
    curto: `O vídeo tem menos de ${LIMITES_DA_EDICAO.duracaoMinS} segundos. Grave um pouco mais e envie de novo.`,
    "qualidade-alta": "Esse vídeo foi gravado em qualidade maior que a HD (como o 4K). Grave de novo em HD (1080p): no iPhone, vá em Ajustes, Câmera, Gravar vídeo e escolha HD a 30 quadros.",
    "sem-fala": "Não ouvimos ninguém falando nesse vídeo. Grave de novo, perto do microfone, e envie outra vez.",
    "nao-entendeu": "Não conseguimos entender o áudio desse vídeo agora. Tente de novo em instantes.",
    sumiu: "O vídeo saiu do nosso servidor antes de a edição começar. Envie de novo.",
    demorou: "A edição demorou mais do que devia e foi parada. Envie o vídeo de novo.",
    "disco-cheio": "O envio de vídeos está pausado por alguns minutos. Tente de novo mais tarde.",
    "nao-montou": "Não conseguimos montar a edição do seu vídeo agora. Envie o vídeo de novo em alguns minutos.",
    "em-revisao": "A edição desse vídeo precisa de uma conferência nossa antes de ficar pronta. Avisamos quando terminar.",
    "motivo-vazio": "Conte o que você quer mudar no vídeo, em poucas palavras, para a gente refazer do jeito certo.",
    "refazer-demais": `Você já pediu ${REFAZERES_POR_EDICAO} ajustes neste vídeo. Aprove a versão que está aí ou envie o vídeo de novo para recomeçar.`,
    "nao-e-a-hora": "Esse vídeo ainda não está nessa etapa. Atualize a tela e veja onde ele está.",
    "arquivo-saiu": "O vídeo que você enviou já saiu do nosso servidor, porque eles ficam guardados por pouco tempo. Envie de novo para editar.",
    "so-dono": "Só quem criou a conta pode publicar no Instagram por aqui.",
    "legenda-indisponivel": "A legenda desse vídeo já saiu do nosso servidor. O vídeo editado e a legenda ficam guardados por 7 dias.",
  } satisfies Record<CodigoDaEdicao, string>,

  /** A folha "Editar o meu vídeo" do roteiro (E47 PR 4). Sem música no vídeo: a pessoa põe a da biblioteca do Instagram ou do TikTok na hora de postar. */
  tela: {
    abrir: "Editar o meu vídeo",
    titulo: "Editar o meu vídeo",
    explica: "Grave o vídeo com o roteiro, envie aqui e a gente corta as pausas e os erros, põe a legenda e o título na tela. Você assiste antes de aprovar.",
    regras: `Grave em pé, em HD (1080p), com até ${minutosMax} minutos e ${LIMITES_DA_EDICAO.megasMax} MB. Fale perto do microfone.`,
    semMusica: "O vídeo sai sem música. Na hora de postar, escolha a música na biblioteca do Instagram ou do TikTok.",
    escolherVideo: "Escolher o vídeo",
    trocarVideo: "Trocar o vídeo",
    videoEscolhido: (nome: string, megas: string) => `${nome}, ${megas} MB`,
    enviar: "Enviar para editar",
    enviando: (porcento: number) => `Enviando o vídeo, ${porcento}%`,
    enviandoSemNumero: "Enviando o vídeo",
    naoFechar: "Deixe esta tela aberta até o envio terminar.",
    cancelarEnvio: "Cancelar o envio",
    usadas: (usadas: number) => frasePorUso(usadas),
    preparando: "Estamos ouvindo o seu vídeo e decidindo o que fica. Leva cerca de 1 a 2 minutos e você pode sair desta tela: a gente avisa aqui quando a prévia estiver pronta.",
    esperandoAVez: (aFrente: number, minutos: number) =>
      aFrente === 0
        ? "Você é o próximo. A montagem começa em instantes."
        : `Há ${aFrente} ${aFrente === 1 ? "vídeo" : "vídeos"} na frente do seu. Espera estimada: cerca de ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`,
    montandoPrevia: (porcento: number) => `Montando a prévia, ${porcento}%`,
    montandoFinal: (porcento: number) => `Montando o vídeo final, ${porcento}%`,
    montandoSemNumero: "Montando o vídeo",
    previaTitulo: "Assista antes de aprovar",
    previaAjuda: "Esta é uma prévia em qualidade menor, só para você conferir os cortes, a legenda e o título. O vídeo final sai em qualidade completa.",
    avisosTitulo: "Vale conferir",
    aprovar: "Aprovar e montar o vídeo final",
    refazer: "Pedir ajuste",
    refazerRotulo: "O que você quer mudar?",
    refazerAjuda: "Por exemplo: deixar a abertura mais curta, manter a parte do preço, tirar a frase do meio.",
    refazerEnviar: "Refazer com esse pedido",
    refazerVoltar: "Voltar",
    refazerRestantes: (n: number) => (n === 1 ? "Você ainda pode pedir 1 ajuste neste vídeo." : `Você ainda pode pedir ${n} ajustes neste vídeo.`),
    refazeu: "Pedido enviado. Estamos refazendo a edição com o que você pediu.",
    prontoTitulo: "Seu vídeo está pronto",
    prontoAjuda: (dia: string) => `Fica guardado aqui até ${dia}. Depois disso ele sai do nosso servidor.`,
    baixarVideo: "Baixar o vídeo",
    baixarLegenda: "Baixar a legenda",
    legendaAjuda: "A legenda em arquivo serve para quem quer acabar a edição em outro aplicativo.",
    publicar: "Publicar no Instagram",
    novoVideo: "Enviar outro vídeo",
    revisaoTitulo: "Estamos conferindo",
    falhouTitulo: "Não deu certo desta vez",
    semConexao: "Sem conexão agora. Tente de novo quando voltar a internet.",
    erroGenerico: "Não conseguimos fazer isso agora. Tente de novo em um minuto.",
    verComo: "Você está vendo a conta como a pessoa. Editar vídeo é só dela.",
    carregando: "Carregando",
    videoNaoAbriu: "O vídeo não abriu neste aparelho. Use o botão para baixar e assistir.",
  },
} as const;

export function fraseDaEdicao(codigo: CodigoDaEdicao): string {
  return textosEdicao.frases[codigo];
}

/** "Você usou 3 de 30 edições neste mês." */
export function frasePorUso(usadas: number): string {
  return `Você usou ${usadas} de ${LIMITES_DA_EDICAO.edicoesPorMes} edições neste mês.`;
}
