import { LIMITES_DO_POST_PRONTO } from "@/config/post-pronto";
import { LIMITES_DA_LEGENDA } from "@/config/publicacao";

/**
 * E56 PR 2: as frases de "Publicar post pronto" (a tela, as recusas do servidor e o motivo de cada falha). Linguagem de quem dirige um negócio pequeno: nada de "token", "contêiner", "API" ou
 * "permissão". Os números saem de `config/post-pronto.ts` e de `config/publicacao.ts`, que os copiam da documentação oficial baixada.
 */

export type CodigoDeRecusaDoPost =
  | "fechada"
  | "so-dono"
  | "sem-conta"
  | "sem-permissao"
  | "acesso-perdido"
  | "nao-configurada"
  | "sem-imagem"
  | "imagens-demais"
  | "imagem-tipo"
  | "imagem-vazia"
  | "imagem-pesada"
  | "imagem-ilegivel"
  | "imagem-proporcao"
  | "imagem-grande-demais"
  | "pedido-grande"
  | "legenda-longa"
  | "legenda-hashtags"
  | "legenda-marcacoes"
  | "nao-achou"
  | "nao-da-para-cancelar"
  | "nao-da-para-repetir";

export type CodigoDeFalhaDoPost =
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
  | "imagem-sumiu";

const { imagensMax } = LIMITES_DO_POST_PRONTO;
const megasDoJpeg = LIMITES_DO_POST_PRONTO.bytesDoJpegMax / 1_000_000;

export const textosPostPronto = {
  recusa: {
    fechada: "Publicar post pronto ainda não está aberto para você.",
    "so-dono": "Só quem criou a conta pode publicar no Instagram por aqui.",
    "sem-conta": "Ligue o seu Instagram na tela de Conta para publicar por aqui.",
    "sem-permissao": "A ligação do seu Instagram ainda não libera a publicação. Na tela de Conta, ligue o Instagram de novo e libere tudo o que a Meta mostrar.",
    "acesso-perdido": "O acesso ao seu Instagram não vale mais. Na tela de Conta, ligue o Instagram de novo.",
    "nao-configurada": "A publicação pelo aplicativo ainda não está aberta para você.",
    "sem-imagem": "Escolha pelo menos uma imagem.",
    "imagens-demais": `Um post leva no máximo ${imagensMax} imagens. Tire algumas e tente de novo.`,
    "imagem-tipo": "Escolha imagens nos formatos JPG ou PNG.",
    "imagem-vazia": "Um dos arquivos está vazio. Escolha as imagens de novo.",
    "imagem-pesada": `Uma das imagens passa de ${megasDoJpeg} MB, o máximo que o Instagram aceita. Exporte de novo em tamanho menor.`,
    "imagem-ilegivel": "Não conseguimos abrir uma das imagens. Exporte de novo em JPG ou PNG e tente outra vez.",
    "imagem-proporcao": "Uma das imagens tem um formato que o Instagram não aceita. Use de 4 por 5 (em pé) até 1,91 por 1 (deitada). O mais comum é 1080 por 1350.",
    "imagem-grande-demais": "Uma das imagens é grande demais para enviar. Exporte de novo em tamanho menor.",
    "pedido-grande": "As imagens juntas são pesadas demais para um envio só. Mande menos imagens por vez.",
    "legenda-longa": `A legenda passa de ${LIMITES_DA_LEGENDA.caracteres.toLocaleString("pt-BR")} letras, o máximo do Instagram. Encurte um pouco.`,
    "legenda-hashtags": `A legenda tem mais de ${LIMITES_DA_LEGENDA.hashtags} hashtags, o máximo do Instagram. Tire algumas.`,
    "legenda-marcacoes": `A legenda marca mais de ${LIMITES_DA_LEGENDA.marcacoes} pessoas com @, o máximo do Instagram. Tire algumas.`,
    "nao-achou": "Não achamos esse post.",
    "nao-da-para-cancelar": "Este post já está sendo publicado e não dá mais para cancelar.",
    "nao-da-para-repetir": "Este post não pode ser enviado de novo. Se ele não aparece no seu Instagram, monte-o outra vez.",
  } satisfies Record<CodigoDeRecusaDoPost, string>,

  /** O motivo guardado quando o post falha. */
  falha: {
    formato: "O Instagram não aceitou o formato de uma das imagens. Use JPG ou PNG, de 4 por 5 (em pé) até 1,91 por 1 (deitada).",
    "nao-preparou": "O Instagram não conseguiu preparar as imagens. Confira se estão em JPG ou PNG, no formato certo e com até 8 MB cada; depois tente de novo.",
    "limite-do-dia": "O Instagram já recebeu o máximo de publicações de hoje desta conta. Ponha o post na fila de novo mais tarde.",
    "conta-restrita": "O Instagram diz que a conta está restrita ou pede uma confirmação. Abra o aplicativo do Instagram, resolva o que ele pedir e tente de novo.",
    barrada: "O Instagram barrou esta publicação por segurança. Espere um pouco e tente de novo.",
    legenda: "A legenda é maior do que o Instagram aceita. Encurte e monte o post de novo.",
    "acesso-perdido": "O acesso ao seu Instagram não vale mais. Na tela de Conta, ligue o Instagram de novo e tente outra vez.",
    "sem-permissao":
      "A Meta não deixou publicar. Na tela de Conta, ligue o Instagram de novo e libere tudo o que ela mostrar, inclusive a publicação. Se o Facebook estiver pedindo uma confirmação da sua Página, conclua-a lá também.",
    esperar: "A Meta pediu para esperar um pouco. Tente de novo em alguns minutos.",
    "sem-resposta": "Não conseguimos falar com o Instagram agora. Tente de novo em alguns minutos.",
    demorou: "O Instagram está demorando mais que o normal para preparar as imagens. Tente de novo em alguns minutos.",
    "nao-confirmou": "Não conseguimos confirmar se o post foi publicado. Antes de tentar de novo, abra o seu Instagram e confira, para não publicar duas vezes.",
    "imagem-sumiu": "Uma das imagens não está mais guardada no servidor. Monte o post de novo.",
  } satisfies Record<CodigoDeFalhaDoPost, string>,

  /** Os recados da fila (a coluna `aviso`). */
  aviso: {
    limite: "O Instagram só deixa publicar um número de posts a cada 24 horas. A fila espera e continua sozinha.",
  },

  tela: {
    titulo: "Publicar post pronto",
    entrada: "Publicar um post pronto",
    entradaAjuda: "Já tem a imagem ou o carrossel feito? Publique direto no seu Instagram, agora ou numa fila.",
    sai: (nomeDaConta: string) => `Vai sair no Instagram @${nomeDaConta}.`,
    imagensRotulo: "Imagens do post",
    imagensAjuda: `De 1 a ${imagensMax} imagens, em JPG ou PNG. Uma imagem vira um post; duas ou mais viram um carrossel, na ordem em que aparecem aqui.`,
    escolher: "Escolher as imagens",
    maisImagens: "Adicionar mais imagens",
    tirar: (n: number) => `Tirar a imagem ${n}`,
    subir: (n: number) => `Subir a imagem ${n}`,
    descer: (n: number) => `Descer a imagem ${n}`,
    imagemN: (n: number) => `Imagem ${n}`,
    previa: "Prévia",
    previaVazia: "As imagens que você escolher aparecem aqui.",
    ehPost: "Post de uma imagem",
    ehCarrossel: (n: number) => `Carrossel de ${n} imagens`,
    legenda: "Legenda",
    legendaAjuda: "O texto que vai embaixo do post, com as hashtags.",
    contador: (usadas: number) => `${usadas.toLocaleString("pt-BR")} de ${LIMITES_DA_LEGENDA.caracteres.toLocaleString("pt-BR")} letras`,
    publicarAgora: "Publicar agora",
    poeNaFila: "Pôr na fila",
    avisoFinal: "Ao publicar, o post vai direto para o seu Instagram, sem passar por revisão nossa. Na fila, os posts saem um por vez, com um intervalo entre eles.",
    enviando: "Enviando as imagens",
    foi: "Pronto. O post entrou na fila.",
    foiAgora: "Pronto. O post já está sendo publicado.",
    erroGenerico: "Não conseguimos enviar agora. Tente de novo em um minuto.",
    semConexao: "Sem conexão agora. Tente de novo quando voltar a internet.",
    irParaConta: "Ir para a Conta",
    voltar: "Voltar para a Conta",
    filaTitulo: "A fila",
    filaVazia: "Nenhum post na fila. Os que você montar aparecem aqui.",
    estado: {
      na_fila: "Na fila",
      publicando: "Publicando",
      publicado: "Publicado",
      falhou: "Não saiu",
      cancelado: "Cancelado",
    },
    quantas: (n: number) => (n === 1 ? "1 imagem" : `${n} imagens`),
    verNoInstagram: "Ver no Instagram",
    publicadoSemLink: "Publicado. Abra o Instagram para ver.",
    cancelar: "Tirar da fila",
    tentarDeNovo: "Pôr na fila de novo",
    legendaVazia: "Sem legenda",
  },
};

export function fraseDeRecusaDoPost(codigo: CodigoDeRecusaDoPost): string {
  return textosPostPronto.recusa[codigo];
}

export function fraseDeFalhaDoPost(codigo: CodigoDeFalhaDoPost): string {
  return textosPostPronto.falha[codigo];
}
