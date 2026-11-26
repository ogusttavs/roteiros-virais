import type { EstadoDaAnimacao } from "@/config/animacao-fila";

/**
 * E68 A2: as frases do vídeo de animação (o plano B do dia em que a pessoa não consegue gravar). Linguagem de quem dirige um negócio pequeno: nada de "render", "fila", "processamento" ou
 * "servidor". O vídeo é só texto animado, sem ninguém na tela (regra do produto: a gente não faz vídeo com cara de ninguém).
 */
export type CodigoDaAnimacao =
  | "nao-achou"
  | "sem-texto"
  | "colchete"
  | "longo"
  | "em-andamento"
  | "nao-comecou"
  | "nao-e-a-hora"
  | "nao-montou"
  | "arquivo-saiu";

/** "uns 40 segundos", "uns 3 minutos": o tempo que a tela promete, arredondado para falar. */
export function tempoPorExtenso(segundos: number): string {
  if (segundos < 90) return `uns ${Math.max(10, Math.round(segundos / 10) * 10)} segundos`;
  return `uns ${Math.round(segundos / 60)} minutos`;
}

export const textosAnimacao = {
  frases: {
    "nao-achou": "Não achamos esse vídeo. Volte para o roteiro e comece de novo.",
    "sem-texto": "Este roteiro não tem texto para virar vídeo. Escolha outro roteiro.",
    colchete: "Seu roteiro ainda tem espaços para completar, entre colchetes. Complete esses trechos no roteiro e peça o vídeo de novo.",
    longo: "O vídeo em animação é para vídeos curtos. Neste roteiro, grave você mesmo.",
    "em-andamento": "Você já tem um vídeo em animação sendo feito. Espere ele ficar pronto ou escolha \"Agora não\" na prévia.",
    "nao-comecou": "Não foi possível começar agora. Tente de novo em instantes.",
    "nao-e-a-hora": "Este vídeo não está nessa etapa agora. Atualize a tela.",
    "nao-montou": "Não conseguimos montar o vídeo desta vez. Tente de novo. Se não der, o seu roteiro está pronto: que tal gravar você mesmo?",
    "arquivo-saiu": "Este vídeo já saiu do ar, porque passou dos 7 dias. Faça outro, se quiser.",
  } satisfies Record<CodigoDaAnimacao, string>,
  chamado: {
    titulo: "Sem tempo de gravar hoje?",
    texto: "Fazemos um vídeo só com as palavras do seu roteiro, sem você aparecer.",
    botao: "Fazer em animação",
    botaoOcupado: "Pedindo...",
    completar: (quantos: number) => (quantos === 1 ? "Falta completar 1 espaço entre colchetes no seu roteiro. O vídeo mostra só o que está escrito, então complete antes de pedir." : `Faltam completar ${quantos} espaços entre colchetes no seu roteiro. O vídeo mostra só o que está escrito, então complete antes de pedir.`),
    botaoCompletar: "Completar o roteiro",
  },
  estados: {
    pedida: (tempo: string) => `Estamos montando a prévia do seu vídeo. Costuma levar ${tempo}. Ela aparece aqui mesmo quando ficar pronta.`,
    fazendo_previa: (tempo: string) => `Estamos montando a prévia do seu vídeo. Costuma levar ${tempo}. Ela aparece aqui mesmo quando ficar pronta.`,
    previa_pronta: "A prévia está pronta, numa qualidade menor, só para você conferir. Se gostar, faça o vídeo final, em alta qualidade.",
    fazendo_final: (tempo: string) => `Estamos fazendo o vídeo final, em alta qualidade. Costuma levar ${tempo}. Pode sair desta tela, ele fica guardado aqui.`,
    final_pronta: "Seu vídeo está pronto. O vídeo não tem som: ao postar, escolha uma música em alta no próprio Instagram. Ele fica guardado aqui por 7 dias.",
    falhou: "Não conseguimos montar o vídeo desta vez.",
  },
  acoes: {
    aprovar: "Aprovar e fazer o final",
    agoraNao: "Agora não",
    baixar: "Baixar o vídeo",
    tentarDeNovo: "Tentar de novo",
    ocupado: "Um instante...",
  },
  aviso: {
    verComo: "Você está vendo como a pessoa. Aqui só dá para ler: pedir, aprovar e baixar são dela.",
    videoQuebrou: "Não foi possível tocar o vídeo aqui. Atualize a tela.",
    baixarNoIphone: "No iPhone, o vídeo baixado vai para o app Arquivos. Abra o vídeo por lá e toque em compartilhar e em Salvar vídeo para ele ir para a galeria.",
    foraDoVideo: (quantas: number) => (quantas === 1 ? "O vídeo tem no máximo 1 minuto, então 1 frase do meio ficou de fora:" : `O vídeo tem no máximo 1 minuto, então ${quantas} frases do meio ficaram de fora:`),
    foraDoVideoDica: "Se alguma faz falta, encurte o roteiro, escolha \"Agora não\" e peça o vídeo de novo.",
    andamento: (porcento: number) => `${porcento}% pronto`,
  },
} as const;

export function fraseDaAnimacao(codigo: CodigoDaAnimacao): string {
  return textosAnimacao.frases[codigo];
}

/** A linha de estado que o cartão mostra, ou `null` quando não há animação. O tempo esperado só entra nos estados de espera. */
export function linhaDoEstadoDaAnimacao(estado: EstadoDaAnimacao | null, tempoDaPrevia: string, tempoDoFinal: string, motivo?: string | null): string | null {
  if (!estado) return null;
  switch (estado) {
    case "pedida":
    case "fazendo_previa":
      return textosAnimacao.estados.fazendo_previa(tempoDaPrevia);
    case "previa_pronta":
      return textosAnimacao.estados.previa_pronta;
    case "fazendo_final":
      return textosAnimacao.estados.fazendo_final(tempoDoFinal);
    case "final_pronta":
      return textosAnimacao.estados.final_pronta;
    case "falhou":
      return motivo ?? textosAnimacao.estados.falhou;
  }
}
