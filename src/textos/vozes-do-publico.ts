/**
 * Texto de tela de "O que o público pergunta" (E28, passo 25 do Opus: `base.css` `.perguntas-publico` e `.lista-perguntas`, e as telas Hoje, Referências, Criar e Tema livre). O desenho diz
 * "Dos comentários dos 20 vídeos mais vistos do seu setor nesta semana"; aqui a frase conta o que de fato foi lido (quantos vídeos, de qual plataforma e quando), porque a plataforma vai sempre
 * dita (o público de um vídeo do YouTube não é o do Reels). Registrado no `TODO.md` como decisão da E28.
 */
import type { Plataforma } from "@/db/schema";

type TipoDaVoz = "duvida" | "objecao" | "pedido";

const NOME_DA_PLATAFORMA: Record<Plataforma, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

/** "YouTube", "YouTube e Instagram" (a ordem de quem chega). */
function plataformasPorExtenso(plataformas: Plataforma[]): string {
  const nomes = [...new Set(plataformas)].map((p) => NOME_DA_PLATAFORMA[p]);
  if (nomes.length <= 1) return nomes[0] ?? "YouTube";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export const textosVozes = {
  /** O rótulo pequeno e o título do bloco (Hoje, Referências aberta). */
  rotulo: "Nos comentários do seu setor",
  titulo: "O que o público pergunta",
  /** "perguntado 14 vezes", "reclamado 7 vezes". */
  vezes: (tipo: TipoDaVoz, n: number): string => `${tipo === "objecao" ? "reclamado" : tipo === "pedido" ? "pedido" : "perguntado"} ${n} ${n === 1 ? "vez" : "vezes"}`,
  responderEmVideo: "Responder em vídeo",
  /** O nome acessível do botão de cada linha. */
  responderEmVideoDe: (texto: string): string => `Responder em vídeo: ${texto}`,
  /** A frase fixa do pé: o que foi lido, onde e quando, e que ninguém é citado. */
  leitura: (videos: number, plataformas: Plataforma[], dia: string): string =>
    videos === 1
      ? `Dos comentários do vídeo mais visto do seu setor no ${plataformasPorExtenso(plataformas)}, lidos em ${dia}. É a nossa leitura: ninguém é citado pelo nome.`
      : `Dos comentários dos ${videos} vídeos mais vistos do seu setor no ${plataformasPorExtenso(plataformas)}, lidos em ${dia}. É a nossa leitura: ninguém é citado pelo nome.`,

  /** Referências: a linha fechada no alto. */
  linha: {
    quantas: (n: number): string => `${n} ${n === 1 ? "pergunta" : "perguntas"} nesta leitura`,
    maisFeita: (n: number): string => `a mais feita, ${n} vezes`,
    ver: "Ver as perguntas",
    recolher: "Recolher",
  },

  /** Criar: a quinta porta. */
  porta: {
    titulo: "Responder o que estão perguntando",
    ajuda: "O que o público do seu setor mais perguntou nos comentários.",
    responder: "Responder",
    responderDe: (texto: string): string => `Responder: ${texto}`,
    /** O estado "ainda sem perguntas": a porta fica, calma, sem parecer erro. */
    semPerguntas: "Ainda sem perguntas do público. Elas aparecem aqui quando os vídeos mais vistos do seu setor tiverem comentários suficientes.",
  },
};
