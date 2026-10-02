/**
 * Texto de `/noticias` (E43, design v2, `entrega/telas/Noticias.dc.html`, estados `normal`,
 * `aberta`, `vazio`, `poucas`, `carregando`, `erro`; dúvida 13 do passo 11 tem as frases
 * aprovadas). O botão do desenho usava uma palavra que a regra 6 proíbe como jargão
 * (brief-frontend.md seção 8, `checar-texto`); viramos "Criar vídeo com esta notícia" em todo
 * lugar, nunca a palavra original.
 */
export const textosNoticias = {
  tituloCompacto: "Notícias",
  titulo: "Notícias do seu setor",
  subtitulo:
    "As notícias que a gente achou sobre o seu setor, para você saber o que está acontecendo e, se quiser, transformar uma delas em vídeo.",

  periodoHoje: "Hoje",
  periodoSemana: "Semana",
  periodoMes: "Mês",

  semNicho: "Falta escolher o setor da marca para as notícias aparecerem aqui.",

  quantasNestePeriodo: (quantas: number, periodo: "hoje" | "semana" | "mes") => {
    const sufixo = periodo === "hoje" ? "hoje" : periodo === "semana" ? "nesta semana" : "neste mês";
    return `${quantas} notícia${quantas === 1 ? "" : "s"} do seu setor ${sufixo}`;
  },

  comoViraVideo: "Como isso vira vídeo seu",
  virouRoteiro: "virou roteiro",
  verORoteiro: "Ver o roteiro",
  abrir: "Abrir",

  /** A folha "a notícia aberta". */
  resumoNosso: "Este é o nosso resumo. A matéria inteira fica no site de quem publicou.",
  criarVideoComEstaNoticia: "Criar vídeo com esta notícia",
  lerNoSite: "Ler no site",

  vazioTitulo: "Nenhuma notícia do seu setor hoje",
  vazioFrase: (naSemana: number) => `Ainda não saiu nada hoje que interessa ao seu setor. Na semana tem ${naSemana}.`,
  verASemana: "Ver a semana",

  poucaNoticiaTitulo: "O seu setor aparece pouco no noticiário",
  poucaNoticiaFrase: (naSemana: number) =>
    `Nesta semana ${naSemana === 1 ? "foi 1 notícia" : `foram ${naSemana} notícias`} que interessam a você. É comum em setor mais específico, e a gente procura de novo todo dia.`,

  erroTitulo: "Não deu para buscar as notícias de hoje",
  erroFrase: "Estas são as que já estavam guardadas.",
  erroDescricao: "A falha foi nossa. As notícias da semana continuam aqui, e a gente tenta de novo sozinho.",
  tentarDeNovo: "Tentar de novo",

  carregando: "Carregando as notícias",
};
