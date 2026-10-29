import { envolverEmail } from "./casca-email";

/**
 * Os avisos do alarme do disco do servidor (29/10/2026): o e-mail para o admin e as linhas do Início. Texto interno (só o admin lê), mas as regras do projeto valem do mesmo jeito: sem travessão,
 * sem emoji, sem marca. Os números chegam prontos; a conta está em `servicos/disco.ts`.
 */
export type NumerosDoAviso = {
  usadoPercentual: number;
  livreBytes: number;
  totalBytes: number;
  edicaoBytes: number;
  publicarBytes: number;
  limiteAtencao: number;
  limiteCritico: number;
};

const GB = 1_000_000_000;
const MB = 1_000_000;

/** "18,4 GB" ou "230 MB": o tamanho em língua de gente, com vírgula. */
export function tamanhoEmTexto(bytes: number): string {
  if (bytes >= GB) return `${(Math.round((bytes / GB) * 10) / 10).toString().replace(".", ",")} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

function porcento(n: number): string {
  return `${n.toString().replace(".", ",")}%`;
}

function quanto(n: NumerosDoAviso): string {
  return `Restam ${tamanhoEmTexto(n.livreBytes)} livres de ${tamanhoEmTexto(n.totalBytes)}. Os vídeos guardados para editar ocupam ${tamanhoEmTexto(n.edicaoBytes)} e os vídeos de publicar ocupam ${tamanhoEmTexto(n.publicarBytes)}.`;
}

const OQUE_FAZER =
  "Na máquina, veja o que mais ocupa (o disco é dividido com o outro produto): imagens antigas do Docker, logs e volumes. Se não houver o que apagar, aumente o disco com a Hostinger.";

export type TipoDoAviso = "atencao" | "critico" | "voltou";

export const textosAvisoDeDisco = {
  assunto: (tipo: TipoDoAviso, n: NumerosDoAviso) =>
    ({
      atencao: `O disco do servidor chegou a ${porcento(n.usadoPercentual)}`,
      critico: `O disco do servidor passou de ${porcento(n.limiteCritico)}: o envio de vídeos foi pausado`,
      voltou: `O disco do servidor voltou ao normal (${porcento(n.usadoPercentual)})`,
    })[tipo],
  titulo: (tipo: TipoDoAviso, n: NumerosDoAviso) =>
    ({
      atencao: `O disco do servidor está com ${porcento(n.usadoPercentual)} de uso.`,
      critico: `O disco do servidor está com ${porcento(n.usadoPercentual)} de uso e o envio de vídeos para editar foi pausado.`,
      voltou: `O disco do servidor voltou ao normal: ${porcento(n.usadoPercentual)} de uso.`,
    })[tipo],
  detalhe: (tipo: TipoDoAviso, n: NumerosDoAviso) =>
    ({
      atencao: `${quanto(n)} Nada foi pausado. O aviso de atenção sai com ${porcento(n.limiteAtencao)} de uso e o crítico com ${porcento(n.limiteCritico)}. ${OQUE_FAZER}`,
      critico: `${quanto(n)} A limpeza dos vídeos guardados foi pedida agora. Enquanto o uso estiver em ${porcento(n.limiteCritico)} ou mais, quem tenta enviar um vídeo para editar vê que o envio está pausado por alguns minutos. Publicar no Instagram continua funcionando. O envio volta sozinho quando o uso baixar. ${OQUE_FAZER}`,
      voltou: `${quanto(n)} O envio de vídeos para editar está liberado.`,
    })[tipo],
  corpo: (tipo: TipoDoAviso, n: NumerosDoAviso, enderecoDoAdmin: string) =>
    envolverEmail(
      `<p><strong>${textosAvisoDeDisco.titulo(tipo, n)}</strong></p><p>${textosAvisoDeDisco.detalhe(tipo, n)}</p><p>Este aviso sai uma vez por dia por nível enquanto durar.</p><p><a href="${enderecoDoAdmin}">Abrir o Início do admin</a></p>`,
    ),
  /** A mensagem que vai para o Sentry (nível atenção e crítico). */
  sentry: (tipo: "atencao" | "critico", n: NumerosDoAviso) => `Disco do servidor em ${porcento(n.usadoPercentual)} (${tipo === "critico" ? "critico" : "atencao"}): ${tamanhoEmTexto(n.livreBytes)} livres`,
};
