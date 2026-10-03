/**
 * E38 PR 2, "o que entendemos da sua marca": as regras puras do ciclo de leitura, sem banco e sem
 * rede, para testar cada uma sozinha. O job `entender-marca` e o serviço `contexto-marca` só
 * aplicam o que sai daqui.
 *
 * As regras que não podem falhar (cada uma tem teste):
 * - a correção da pessoa nunca é sobrescrita pela IA, e o que ela confirmou continua em vigor até
 *   ela decidir sobre uma proposta nova;
 * - item que a pessoa tirou nunca volta, nem com outras palavras;
 * - um item só pode declarar uma origem (site, Instagram, YouTube) que foi lida de verdade naquela
 *   leitura; e o que veio de uma fonte que não foi lida agora fica como está, nunca "sumiu";
 * - a primeira leitura de uma marca não marca tudo como novidade (viraria ruído); só marca o que a
 *   IA achou que a pessoa não tinha contado.
 */
import type {
  CategoriaContextoMarca,
  ContextoMarcaItem,
  EstadoItemContextoMarca,
  FonteContextoMarca,
  NovidadeContextoMarca,
} from "@/db/schema";

/** Quantos itens vivos (não tirados, não sumidos) a seção comporta. */
export const TETO_ITENS_ATIVOS = 12;
/** Tamanho máximo do texto de um item, depois de limpo. */
export const TAMANHO_MAXIMO_ITEM = 320;
/** Duas frases com esta semelhança (palavras em comum) dizem a mesma coisa. */
export const LIMIAR_MESMO_TEXTO = 0.8;
/** Semelhança mínima para ligar uma proposta sem id a um item que já existe, ou a um que foi tirado. */
export const LIMIAR_MESMO_ASSUNTO = 0.6;

/** Rótulo de cada categoria no texto que vai para os prompts (perfil compilado). */
export const ROTULO_CATEGORIA: Record<CategoriaContextoMarca, string> = {
  vende: "O que vende ou faz",
  fala: "Como fala",
  posta: "O que já posta",
  rendeu: "O que já rendeu",
};

export type ItemExistente = Pick<
  ContextoMarcaItem,
  "id" | "categoria" | "origem" | "texto" | "textoConfirmado" | "estado" | "novidade" | "sumiuEm"
>;

export type ItemProposto = {
  categoria: CategoriaContextoMarca;
  origem: FonteContextoMarca;
  texto: string;
  /** O id de um item que já existe, quando a IA diz que é o mesmo assunto; `null` para item novo. */
  idAnterior: number | null;
  /** A IA achou que isto acrescenta ou contradiz o que a pessoa respondeu no briefing. */
  alemDoBriefing: boolean;
};

export type AtualizacaoItem = {
  id: number;
  texto?: string;
  categoria?: CategoriaContextoMarca;
  origem?: FonteContextoMarca;
  estado?: EstadoItemContextoMarca;
  novidade?: NovidadeContextoMarca | null;
  sumiuEm?: Date | null;
  ultimaVezVistoEm?: Date;
};

export type NovoItem = {
  categoria: CategoriaContextoMarca;
  origem: FonteContextoMarca;
  texto: string;
  novidade: NovidadeContextoMarca | null;
};

export type Reconciliacao = {
  criar: NovoItem[];
  atualizar: AtualizacaoItem[];
  resumo: {
    novos: number;
    mudaram: number;
    iguais: number;
    sumiram: number;
    descartados: { origemNaoLida: number; tiradoVoltando: number; repetido: number; acimaDoTeto: number };
  };
};

/** Uma linha só, sem marcação, sem espaço sobrando, no tamanho que cabe na tela e no prompt. */
export function limparTextoDoItem(bruto: string, maximo: number = TAMANHO_MAXIMO_ITEM): string {
  const limpo = bruto
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (limpo.length <= maximo) return limpo;
  const corte = limpo.slice(0, maximo);
  const ultimoEspaco = corte.lastIndexOf(" ");
  return (ultimoEspaco > maximo / 2 ? corte.slice(0, ultimoEspaco) : corte).trimEnd();
}

const PALAVRAS_SEM_PESO = new Set([
  "para", "com", "que", "uma", "uns", "umas", "dos", "das", "por", "seu", "sua", "seus", "suas", "mais",
  "nos", "nas", "aos", "como", "mas", "foi", "são", "sao", "ele", "ela", "eles", "elas", "isso", "esse",
  "essa", "pelo", "pela", "entre", "sobre", "ate", "até", "bem", "muito", "cada", "quando", "tem", "ser",
  "vem", "vai", "tambem", "também", "onde", "sempre", "ainda",
]);

function palavrasDoTexto(texto: string): Set<string> {
  const normalizado = texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const palavras = new Set<string>();
  for (const palavra of normalizado.split(" ")) {
    if (palavra.length > 2 && !PALAVRAS_SEM_PESO.has(palavra)) palavras.add(palavra);
  }
  return palavras;
}

/** Palavras em comum sobre palavras no total (Jaccard), sem acento, sem maiúscula, sem palavra de ligação. */
export function similaridade(a: string, b: string): number {
  const conjuntoA = palavrasDoTexto(a);
  const conjuntoB = palavrasDoTexto(b);
  if (conjuntoA.size === 0 || conjuntoB.size === 0) return 0;
  let comuns = 0;
  for (const palavra of conjuntoA) if (conjuntoB.has(palavra)) comuns += 1;
  return comuns / (conjuntoA.size + conjuntoB.size - comuns);
}

/** "i12" ou "12" vira 12; qualquer outra coisa vira `null` (a IA pode inventar um id). */
export function lerIdAnterior(bruto: string | null | undefined): number | null {
  if (!bruto) return null;
  const achado = /^\s*i?(\d{1,9})\s*$/i.exec(bruto);
  return achado ? Number(achado[1]) : null;
}

/** O texto que a tela mostra: a proposta pendente, ou o que está em vigor quando não há nada a decidir. */
export function textoParaMostrar(item: Pick<ContextoMarcaItem, "texto" | "textoConfirmado" | "estado">): string {
  if (item.estado === "para_confirmar") return item.texto;
  return item.textoConfirmado ?? item.texto;
}

/** O que a tela lista: nada que a pessoa tirou, e nada que a IA parou de propor sem a pessoa ter confirmado. */
export function itemVisivel(item: Pick<ContextoMarcaItem, "estado" | "sumiuEm" | "textoConfirmado">): boolean {
  if (item.estado === "recusado") return false;
  return item.sumiuEm === null || item.textoConfirmado !== null;
}

/** O que chega aos prompts: só o que a pessoa confirmou ou corrigiu, e nunca o que ela tirou. */
export function textoEmVigor(item: Pick<ContextoMarcaItem, "estado" | "textoConfirmado">): string | null {
  if (item.estado === "recusado") return null;
  return item.textoConfirmado;
}

/** A leitura de evento (a pessoa salvou o site ou um perfil) não repete o site do cliente em menos de N minutos. */
export function tentativaRecenteDemais(ultimaTentativaEm: Date | null, agora: Date, minutos: number): boolean {
  if (!ultimaTentativaEm) return false;
  return agora.getTime() - ultimaTentativaEm.getTime() < minutos * 60_000;
}

/** "A próxima leitura é em ...": N dias depois da última leitura boa; sem leitura boa, nunca marcada. */
export function proximaLeituraEm(ultimaLeituraOkEm: Date | null, dias: number): Date | null {
  if (!ultimaLeituraOkEm) return null;
  return new Date(ultimaLeituraOkEm.getTime() + dias * 86_400_000);
}

/** Uma leitura que passa disto sem terminar foi interrompida: a trava solta e outra pode começar. */
export const MINUTOS_TRAVA_LEITURA = 30;
/** O texto que a própria pessoa escreve ao corrigir um item: mais folgado que o da IA, nunca cortado em silêncio. */
export const TAMANHO_MAXIMO_TEXTO_DA_PESSOA = 500;

/**
 * O que a seção do briefing mostra, em quatro estados (os quatro estados de toda tela, brief-frontend
 * 8): sem nenhuma fonte informada; lendo pela primeira vez; a leitura foi tentada e não rendeu; ou
 * lida (com itens, ou sem nada de claro).
 */
export type EstadoDaSecao = "sem_fonte" | "lendo" | "nao_leu" | "ok";

export function estadoDaSecao(dados: {
  temFonte: boolean;
  ultimaLeituraOkEm: Date | null;
  ultimaTentativaEm: Date | null;
  lendoDesde: Date | null;
  agora: Date;
}): EstadoDaSecao {
  if (!dados.temFonte) return "sem_fonte";
  if (dados.ultimaLeituraOkEm) return "ok";
  const lendoAgora =
    dados.lendoDesde !== null && dados.agora.getTime() - dados.lendoDesde.getTime() < MINUTOS_TRAVA_LEITURA * 60_000;
  if (lendoAgora || dados.ultimaTentativaEm === null) return "lendo";
  return "nao_leu";
}

/** Quantos vídeos com visualização são precisos para a mediana do perfil dizer alguma coisa. */
export const MINIMO_VIDEOS_PARA_MEDIANA = 5;
/** Quantos vídeos recentes de cada rede entram na leitura. */
export const MAXIMO_VIDEOS_POR_REDE = 15;
const TAMANHO_MAXIMO_TITULO = 140;

export type VideoParaResumir = { titulo: string | null; views: number | null };
export type VideoResumido = { titulo: string; visualizacoes: number | null; vezesAMediana: number | null };

function medianaDe(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[meio - 1] + ordenados[meio]) / 2 : ordenados[meio];
}

/**
 * "O que rendeu" é conta, não opinião (escopo 5.9, item 10; "viral é relativo à conta"): a mediana
 * das visualizações do próprio perfil e quantas vezes cada vídeo passa dela, calculadas aqui, e o
 * modelo só descreve. Com poucos vídeos com visualização, não há mediana e nenhum múltiplo.
 */
export function resumirVideosParaIA(videos: VideoParaResumir[]): {
  medianaVisualizacoes: number | null;
  videos: VideoResumido[];
} {
  const recentes = videos
    .map((video) => ({ titulo: limparTextoDoItem(video.titulo ?? "").slice(0, TAMANHO_MAXIMO_TITULO).trim(), views: video.views }))
    .filter((video) => video.titulo !== "")
    .slice(0, MAXIMO_VIDEOS_POR_REDE);
  const visualizacoes = recentes.map((v) => v.views).filter((v): v is number => v !== null && v >= 0);
  const mediana = visualizacoes.length >= MINIMO_VIDEOS_PARA_MEDIANA ? medianaDe(visualizacoes) : null;
  return {
    medianaVisualizacoes: mediana !== null ? Math.round(mediana) : null,
    videos: recentes.map((video) => ({
      titulo: video.titulo,
      visualizacoes: video.views,
      vezesAMediana:
        mediana !== null && mediana > 0 && video.views !== null ? Math.round((video.views / mediana) * 10) / 10 : null,
    })),
  };
}

function estaVivo(item: ItemExistente): boolean {
  return item.estado !== "recusado";
}

/**
 * Junta o que a IA propôs agora com o que já existe. Não escreve nada: devolve o que criar e o que
 * atualizar, e o job grava numa transação.
 */
export function reconciliarItens(entrada: {
  existentes: ItemExistente[];
  propostos: ItemProposto[];
  fontesLidas: ReadonlySet<FonteContextoMarca>;
  primeiraLeitura: boolean;
  agora: Date;
  tetoAtivos?: number;
}): Reconciliacao {
  const { existentes, fontesLidas, primeiraLeitura, agora } = entrada;
  const teto = entrada.tetoAtivos ?? TETO_ITENS_ATIVOS;
  const resumo: Reconciliacao["resumo"] = {
    novos: 0,
    mudaram: 0,
    iguais: 0,
    sumiram: 0,
    descartados: { origemNaoLida: 0, tiradoVoltando: 0, repetido: 0, acimaDoTeto: 0 },
  };
  const atualizacoes = new Map<number, AtualizacaoItem>();
  const criar: NovoItem[] = [];

  const porId = new Map(existentes.map((item) => [item.id, item]));
  const ligados = new Set<number>();
  const tirados = existentes.filter((item) => item.estado === "recusado");

  // A. Limpa e filtra o que a IA propôs.
  const limpos: ItemProposto[] = [];
  for (const proposto of entrada.propostos) {
    const texto = limparTextoDoItem(proposto.texto);
    if (texto === "") continue;
    if (!fontesLidas.has(proposto.origem)) {
      resumo.descartados.origemNaoLida += 1;
      continue;
    }
    const repetido = limpos.some(
      (outro) =>
        (proposto.idAnterior !== null && outro.idAnterior === proposto.idAnterior) ||
        (outro.categoria === proposto.categoria && similaridade(outro.texto, texto) >= LIMIAR_MESMO_TEXTO),
    );
    if (repetido) {
      resumo.descartados.repetido += 1;
      continue;
    }
    limpos.push({ ...proposto, texto });
  }

  // B. Primeiro as que citam um id que existe: é a ligação que a IA fez de propósito.
  const semLigacao: ItemProposto[] = [];
  const paraLigar: { proposto: ItemProposto; existente: ItemExistente }[] = [];
  for (const proposto of limpos) {
    const citado = proposto.idAnterior !== null ? porId.get(proposto.idAnterior) : undefined;
    if (citado && !ligados.has(citado.id)) {
      if (!estaVivo(citado)) {
        resumo.descartados.tiradoVoltando += 1;
        continue;
      }
      ligados.add(citado.id);
      paraLigar.push({ proposto, existente: citado });
    } else {
      semLigacao.push(proposto);
    }
  }

  // C. As sem id: se é o que a pessoa tirou, descarta; se é o mesmo assunto de um item vivo, liga; senão é novo.
  for (const proposto of semLigacao) {
    const lembraUmTirado = tirados.some(
      (tirado) =>
        tirado.categoria === proposto.categoria &&
        similaridade(tirado.texto, proposto.texto) >= LIMIAR_MESMO_ASSUNTO,
    );
    if (lembraUmTirado) {
      resumo.descartados.tiradoVoltando += 1;
      continue;
    }
    let melhor: ItemExistente | null = null;
    let melhorNota = 0;
    for (const existente of existentes) {
      if (!estaVivo(existente) || ligados.has(existente.id) || existente.categoria !== proposto.categoria) continue;
      const nota = Math.max(
        similaridade(existente.texto, proposto.texto),
        existente.textoConfirmado ? similaridade(existente.textoConfirmado, proposto.texto) : 0,
      );
      if (nota >= LIMIAR_MESMO_ASSUNTO && nota > melhorNota) {
        melhor = existente;
        melhorNota = nota;
      }
    }
    if (melhor) {
      ligados.add(melhor.id);
      paraLigar.push({ proposto, existente: melhor });
    } else {
      criar.push({
        categoria: proposto.categoria,
        origem: proposto.origem,
        texto: proposto.texto,
        novidade: primeiraLeitura ? (proposto.alemDoBriefing ? "alem_do_briefing" : null) : "nova",
      });
    }
  }

  // D. Os ligados: igual (só atualiza a data) ou mudou (a nova proposta vai a confirmar, o que estava em vigor continua).
  for (const { proposto, existente } of paraLigar) {
    const igualAProposta = similaridade(existente.texto, proposto.texto) >= LIMIAR_MESMO_TEXTO;
    const igualAoConfirmado =
      existente.textoConfirmado !== null && similaridade(existente.textoConfirmado, proposto.texto) >= LIMIAR_MESMO_TEXTO;
    if (igualAProposta || igualAoConfirmado) {
      resumo.iguais += 1;
      atualizacoes.set(existente.id, { id: existente.id, ultimaVezVistoEm: agora, sumiuEm: null });
      continue;
    }
    resumo.mudaram += 1;
    atualizacoes.set(existente.id, {
      id: existente.id,
      texto: proposto.texto,
      categoria: proposto.categoria,
      origem: proposto.origem,
      estado: "para_confirmar",
      novidade: "mudou",
      sumiuEm: null,
      ultimaVezVistoEm: agora,
    });
  }

  // E. O que não voltou: só "sumiu" se a fonte do item foi lida agora (fonte não lida não diz nada).
  for (const existente of existentes) {
    if (!estaVivo(existente) || ligados.has(existente.id)) continue;
    if (!fontesLidas.has(existente.origem)) continue;
    if (existente.sumiuEm === null) {
      resumo.sumiram += 1;
      atualizacoes.set(existente.id, { id: existente.id, sumiuEm: agora });
    }
  }

  // F. O teto: o que já vive ocupa lugar; os novos entram enquanto couberem.
  const vivosDepois = existentes.filter((item) => {
    if (!estaVivo(item)) return false;
    const mudanca = atualizacoes.get(item.id);
    const sumiu = mudanca && "sumiuEm" in mudanca ? mudanca.sumiuEm !== null : item.sumiuEm !== null;
    return !sumiu || item.textoConfirmado !== null;
  }).length;
  const vagas = Math.max(0, teto - vivosDepois);
  if (criar.length > vagas) {
    resumo.descartados.acimaDoTeto += criar.length - vagas;
    criar.length = vagas;
  }
  resumo.novos = criar.length;

  return { criar, atualizar: [...atualizacoes.values()], resumo };
}
