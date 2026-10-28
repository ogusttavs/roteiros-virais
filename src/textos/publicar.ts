import { LIMITES_DA_LEGENDA, LIMITES_DA_PUBLICACAO } from "@/config/publicacao";
import type { TipoDePublicacao } from "@/db/schema";

/**
 * E56 PR 1: as frases de "Publicar no Instagram" (a folha do roteiro, as recusas do servidor e o motivo de cada falha). Linguagem de quem dirige um negócio pequeno: nada de "token",
 * "contêiner", "API" ou "permissão". A Meta aparece pelo nome porque é ela quem aprova o aplicativo e quem recusa um vídeo. Os números (tamanho, duração, legenda) saem de
 * `config/publicacao.ts`, que os copia da documentação oficial baixada.
 */

const nomeDoTipo = (tipo: TipoDePublicacao): string => (tipo === "story" ? "Story" : "Reels");

/** O que o servidor recusa antes de começar. Cada código tem a sua frase. */
export type CodigoDeRecusa =
  | "so-dono"
  | "sem-roteiro"
  | "longo"
  | "sem-conta"
  | "sem-permissao"
  | "acesso-perdido"
  | "nao-configurada"
  | "tipo-invalido"
  | "arquivo-tipo"
  | "arquivo-vazio"
  | "arquivo-grande"
  | "legenda-longa"
  | "legenda-hashtags"
  | "legenda-marcacoes"
  | "limite"
  | "em-andamento"
  | "envio-em-curso"
  | "ja-publicado"
  | "nao-comecou"
  | "nao-achou";

/** O que fica guardado como motivo de uma publicação que não terminou. */
export type CodigoDeFalha =
  | "formato"
  | "nao-preparou"
  | "limite-do-dia"
  | "conta-restrita"
  | "barrada"
  | "legenda"
  | "acesso-perdido"
  | "sem-permissao"
  | "esperar"
  | "sem-resposta"
  | "demorou"
  | "nao-confirmou"
  | "envio-interrompido"
  | "envio-parado"
  | "cancelada";

export const textosPublicar = {
  recusa: {
    "so-dono": "Só quem criou a conta pode publicar no Instagram por aqui.",
    "sem-roteiro": "Não achamos esse roteiro. Volte para a lista e abra de novo.",
    longo: "O vídeo longo é para o YouTube. A publicação pelo aplicativo, por enquanto, é só para Reels e Story.",
    "sem-conta": "Ligue o seu Instagram na tela de Conta para publicar por aqui.",
    "sem-permissao": "A ligação do seu Instagram ainda não libera a publicação. Na tela de Conta, ligue o Instagram de novo e libere tudo o que a Meta mostrar.",
    "acesso-perdido": "O acesso ao seu Instagram não vale mais. Na tela de Conta, ligue o Instagram de novo.",
    "nao-configurada": "A publicação pelo aplicativo ainda não está aberta para você.",
    "tipo-invalido": "Escolha se é Reels ou Story.",
    "arquivo-tipo": "Escolha um vídeo no formato MP4 ou MOV.",
    "arquivo-vazio": "O arquivo está vazio. Escolha o vídeo de novo.",
    "arquivo-grande": (tipo: TipoDePublicacao) =>
      `Esse vídeo passa de ${LIMITES_DA_PUBLICACAO[tipo].megasMax} MB, o máximo que o Instagram aceita em ${nomeDoTipo(tipo)}. Corte um trecho ou exporte em qualidade um pouco menor.`,
    "legenda-longa": `A legenda passa de ${LIMITES_DA_LEGENDA.caracteres.toLocaleString("pt-BR")} letras, o máximo do Instagram. Encurte um pouco.`,
    "legenda-hashtags": `A legenda tem mais de ${LIMITES_DA_LEGENDA.hashtags} hashtags, o máximo do Instagram. Tire algumas.`,
    "legenda-marcacoes": `A legenda marca mais de ${LIMITES_DA_LEGENDA.marcacoes} pessoas com @, o máximo do Instagram. Tire algumas.`,
    limite: "O Instagram só deixa publicar um número de posts por dia nesta conta, e esse limite foi usado. Tente de novo amanhã.",
    "em-andamento": "Este roteiro já está sendo publicado. Espere terminar.",
    "envio-em-curso": "Este vídeo já está sendo enviado. Espere terminar, sem tocar de novo, que a tela avisa quando acabar.",
    "ja-publicado": "Este roteiro já foi publicado nesta conta.",
    "nao-comecou": "Não deu para começar a publicação agora. Tente de novo em um minuto.",
    "nao-achou": "Não achamos essa publicação.",
  } satisfies Record<CodigoDeRecusa, string | ((tipo: TipoDePublicacao) => string)>,

  /** O motivo guardado quando a publicação falha, na língua de quem grava vídeo. */
  falha: {
    formato: "O Instagram não aceitou o formato do vídeo. Use o vídeo como o celular gravou, na vertical. Se ele passou por um editor, exporte de novo no formato padrão para redes sociais.",
    "nao-preparou": (tipo: TipoDePublicacao) => {
      const l = LIMITES_DA_PUBLICACAO[tipo];
      const duracao = l.segundosMax >= 60 && l.segundosMax % 60 === 0 && l.segundosMax > 60 ? `${l.segundosMax / 60} minutos` : `${l.segundosMax} segundos`;
      return `O Instagram não conseguiu preparar o vídeo. Confira se ele está como o celular gravou (ou exportado no formato padrão para redes sociais), se tem de ${l.segundosMin} segundos a ${duracao} e se tem no máximo ${l.megasMax} MB; depois tente de novo.`;
    },
    "limite-do-dia": "O Instagram já recebeu o máximo de publicações de hoje desta conta. Tente de novo amanhã.",
    "conta-restrita": "O Instagram diz que a conta está restrita ou pede uma confirmação. Abra o aplicativo do Instagram, resolva o que ele pedir e tente de novo.",
    barrada: "O Instagram barrou esta publicação por segurança. Espere um pouco e tente de novo.",
    legenda: "A legenda é maior do que o Instagram aceita. Encurte e tente de novo.",
    "acesso-perdido": "O acesso ao seu Instagram não vale mais. Na tela de Conta, ligue o Instagram de novo e tente outra vez.",
    "sem-permissao":
      "A Meta não deixou publicar. Na tela de Conta, ligue o Instagram de novo e libere tudo o que ela mostrar, inclusive a publicação. Se o Facebook estiver pedindo uma confirmação da sua Página para publicar, conclua-a lá também.",
    esperar: "A Meta pediu para esperar um pouco. Tente de novo em alguns minutos.",
    "sem-resposta": "Não conseguimos falar com o Instagram agora. Tente de novo em alguns minutos.",
    demorou: "O Instagram está demorando mais que o normal para preparar o vídeo. Tente de novo em alguns minutos.",
    "nao-confirmou": "Não conseguimos confirmar se o vídeo foi publicado. Antes de tentar de novo, abra o seu Instagram e confira, para não publicar duas vezes.",
    "envio-interrompido": "O envio do vídeo foi interrompido. Tente de novo com uma conexão estável.",
    "envio-parado": "O envio anterior não terminou. Escolha o vídeo de novo.",
    cancelada: "Você cancelou a publicação. Nada foi publicado no Instagram. Escolha o vídeo de novo para tentar outra vez.",
  } satisfies Record<CodigoDeFalha, string | ((tipo: TipoDePublicacao) => string)>,

  /** A folha "Publicar no Instagram" do roteiro. */
  tela: {
    abrir: "Publicar no Instagram",
    titulo: "Publicar no Instagram",
    sai: (nomeDaConta: string) => `Vai sair no Instagram @${nomeDaConta}.`,
    ondeRotulo: "Onde publicar",
    reels: "Reels",
    story: "Story",
    ajudaReels: (megas: number) => `Reels: vídeo como o celular gravou, até ${megas} MB e 15 minutos.`,
    ajudaStory: (megas: number) => `Story: vídeo como o celular gravou, até ${megas} MB e 60 segundos. O Story não leva legenda.`,
    legenda: "Legenda",
    legendaAjuda: "Já vem preenchida com o texto do seu roteiro. Mude o que quiser.",
    contador: (usadas: number) => `${usadas.toLocaleString("pt-BR")} de ${LIMITES_DA_LEGENDA.caracteres.toLocaleString("pt-BR")} letras`,
    escolherVideo: "Escolher o vídeo",
    trocarVideo: "Trocar o vídeo",
    videoEscolhido: (nome: string, megas: string) => `${nome}, ${megas} MB`,
    publicar: "Publicar agora",
    avisoFinal: "Ao tocar em Publicar, o vídeo vai direto para o seu Instagram, sem passar por revisão nossa.",
    duracaoCurta: (min: number) => `Esse vídeo tem menos de ${min} segundos, o mínimo do Instagram.`,
    duracaoLonga: (tipo: TipoDePublicacao, max: string) => `Esse vídeo passa de ${max}, o máximo do Instagram em ${nomeDoTipo(tipo)}.`,
    enviando: (porcento: number) => `Enviando o vídeo, ${porcento}%`,
    enviandoSemNumero: "Enviando o vídeo",
    naoFechar: "Deixe esta tela aberta até o envio terminar.",
    envioAnterior: "Um envio anterior não terminou. Cancele para poder publicar de novo.",
    processando: "O Instagram está preparando o vídeo. Isso leva alguns instantes e você pode sair desta tela.",
    publicando: "Publicando",
    publicada: "Publicado no Instagram.",
    verNoInstagram: "Ver no Instagram",
    publicadaSemLink: "Publicado no Instagram. Abra o aplicativo do Instagram para ver.",
    marcadoComoPostado: "O roteiro já foi marcado como postado.",
    tentarDeNovo: "Tentar de novo",
    cancelar: "Cancelar o envio",
    cancelarPublicacao: "Cancelar a publicação",
    erroGenerico: "Não conseguimos publicar agora. Tente de novo em um minuto.",
    semConexao: "Sem conexão agora. Tente de novo quando voltar a internet.",
    // Sem condição para publicar (a folha explica e leva à Conta).
    irParaConta: "Ir para a Conta",
    verComo: "Você está vendo a conta como a pessoa. Publicar é só dela.",
    soDono: "Só quem criou a conta pode publicar no Instagram por aqui.",
    emAndamento: "Este roteiro já está sendo publicado.",
    jaPublicado: "Este roteiro já foi publicado.",
  },
};

export function fraseDeRecusa(codigo: CodigoDeRecusa, tipo: TipoDePublicacao = "reels"): string {
  const frase = textosPublicar.recusa[codigo];
  return typeof frase === "function" ? frase(tipo) : frase;
}

export function fraseDeFalha(codigo: CodigoDeFalha, tipo: TipoDePublicacao = "reels"): string {
  const frase = textosPublicar.falha[codigo];
  return typeof frase === "function" ? frase(tipo) : frase;
}
