import { LIMITES_DA_EDICAO } from "@/config/edicao";

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
  | "disco-cheio";

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
  } satisfies Record<CodigoDaEdicao, string>,
} as const;

export function fraseDaEdicao(codigo: CodigoDaEdicao): string {
  return textosEdicao.frases[codigo];
}

/** "Você usou 3 de 30 edições neste mês." */
export function frasePorUso(usadas: number): string {
  return `Você usou ${usadas} de ${LIMITES_DA_EDICAO.edicoesPorMes} edições neste mês.`;
}
