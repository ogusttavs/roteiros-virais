/**
 * E38 PR 2, "o que entendemos da sua marca": as regras puras do ciclo de leitura, sem banco e sem
 * rede, para testar cada uma sozinha. O job `entender-marca` e o serviço `contexto-marca` só
 * aplicam o que sai daqui.
 *
 * As regras que não podem falhar (cada uma tem teste):
 * - a correção da pessoa nunca é sobrescrita pela IA, e o que ela confirmou continua em vigor até
 *   ela decidir sobre uma proposta nova;
 * - item que a pessoa tirou nunca volta, nem com outras palavras, nem em outra categoria;
 * - um item só pode declarar uma origem (site, Instagram, YouTube) que foi lida de verdade naquela
 *   leitura; e o que veio de uma fonte que não foi lida agora fica como está, nunca "sumiu" (a não
 *   ser que a pessoa tenha tirado a fonte da Conta: aí o que não foi confirmado sai da tela);
 * - a IA não escolhe a categoria de um item que já existe: o id só liga dentro da mesma categoria;
 * - a primeira leitura de uma marca não marca tudo como novidade (viraria ruído); só marca o que a
 *   IA achou que a pessoa não tinha contado;
 * - texto de terceiros que parece ordem, endereço ou dado de contato nunca vira item.
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
/** Tamanho máximo do texto de um item da IA, depois de limpo. */
export const TAMANHO_MAXIMO_ITEM = 320;
/** Duas frases com esta semelhança (palavras em comum) dizem a mesma coisa. */
export const LIMIAR_MESMO_TEXTO = 0.8;
/** Semelhança mínima para ligar uma proposta sem id a um item que já existe, ou a um que foi tirado. */
export const LIMIAR_MESMO_ASSUNTO = 0.6;
/**
 * Quando a IA cita o id e diz que o sentido não mudou (`mudouDeSentido: false`), basta um mínimo de
 * palavras em comum para acreditar: uma paráfrase honesta ("Oferece cursos de culinária" para "Vende
 * cursos de gastronomia") divide poucas palavras, e a regra 6 do prompt a permite. Abaixo disto, o
 * "não mudou" da IA não vale e o item vira "mudou" (o erro contrário esconderia uma mudança de fato).
 */
export const LIMIAR_PARAFRASE_DECLARADA = 0.25;
/** Quantos caracteres do texto cru de terceiros se olham antes de qualquer regex (limite do custo). */
const LIMITE_DO_TEXTO_CRU = 5_000;

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
  /** Só com `idAnterior`: a IA diz se o sentido mudou em relação ao item que já existe. */
  mudouDeSentido?: boolean | null;
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
    descartados: { origemNaoLida: number; tiradoVoltando: number; repetido: number; acimaDoTeto: number; suspeito: number };
  };
};

/**
 * Uma linha só, sem marcação e sem espaço sobrando, sem cortar nada (para medir o tamanho de verdade).
 * É para texto de TERCEIROS (a IA, os títulos de vídeo): olha só os primeiros `LIMITE_DO_TEXTO_CRU`
 * caracteres, e a marcação sai com um padrão linear (`[^<>]*`: cada `<` falha na hora se achar outro
 * `<`; o `[^>]*` de antes era quadrático com muitos `<` e nenhum `>`).
 */
export function limparTextoSemCortar(bruto: string): string {
  return bruto
    .slice(0, LIMITE_DO_TEXTO_CRU)
    .replace(/<[^<>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O texto que a PESSOA escreve ao corrigir: só junta as linhas e tira o espaço das pontas. Nada é
 * apagado ("preço < 50 e > 20" fica como ela escreveu); o `<` e o `>` só são trocados na hora de
 * montar o prompt da leitura, que nunca recebe marcação.
 */
export function limparTextoDaPessoa(bruto: string): string {
  return bruto.replace(/\s+/g, " ").trim();
}

/** O mesmo que `limparTextoSemCortar`, cortado (de preferência numa palavra inteira) no tamanho da tela e do prompt. */
export function limparTextoDoItem(bruto: string, maximo: number = TAMANHO_MAXIMO_ITEM): string {
  const limpo = limparTextoSemCortar(bruto);
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

const PADRAO_ENDERECO_NA_WEB = /(?:https?:\/\/|www\.)\S+/i;
const PADRAO_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u;
/** Oito dígitos ou mais, mesmo com espaço, ponto, hífen e parênteses no meio: telefone. Preço (R$ 1.299,00) tem seis. */
const PADRAO_NUMERO_DE_CONTATO = /(?:\d[\s().-]*){8,}/;
const PADRAO_ORDEM_ESCONDIDA =
  /\b(?:ignor[ae]r?|desconsider[ae]r?|esque[cç]a|instru[cç](?:ão|ões|ao|oes)\s+anteriores?|nova\s+instru[cç](?:ão|ao)|a\s+partir\s+de\s+agora|voc[eê]\s+(?:deve|precisa)\s)/i;

/**
 * O texto de um item é uma descrição da marca para a pessoa confirmar e, confirmado, entra no prompt de
 * todo roteiro, tema e plano. Um site (ou um site invadido) pode tentar fazer a IA escrever uma ordem, um
 * endereço de venda ou um telefone dentro de um item; a pessoa pode tocar "Está certo" sem ler. Estas
 * checagens, por código, descartam esse item antes de ele existir (o modelo já é instruído a não
 * escrever nada disso, mas a regra dura é do código).
 */
export function itemSuspeito(texto: string): boolean {
  return (
    PADRAO_ENDERECO_NA_WEB.test(texto) ||
    PADRAO_EMAIL.test(texto) ||
    PADRAO_NUMERO_DE_CONTATO.test(texto) ||
    PADRAO_ORDEM_ESCONDIDA.test(texto)
  );
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

/**
 * A data que a tela anuncia como "a próxima leitura": a nova tentativa marcada, quando há (uma leitura
 * parcial promete tentar de novo em alguns dias, não só no mês seguinte), senão N dias depois da última
 * leitura boa. Nunca uma data que já passou (o despachante diário lê no dia seguinte): nesse caso, nada.
 */
export function proximaLeituraParaMostrar(
  ultimaLeituraOkEm: Date | null,
  proximaTentativaEm: Date | null,
  dias: number,
  agora: Date,
): Date | null {
  const data = proximaTentativaEm && proximaTentativaEm > agora ? proximaTentativaEm : proximaLeituraEm(ultimaLeituraOkEm, dias);
  return data && data > agora ? data : null;
}

/**
 * Uma leitura que passa disto sem terminar foi interrompida: a trava solta e outra pode começar. Maior
 * que o pior caso de espera pela janela da Meta (quase uma hora, `aguardarJanela`); a tela também só
 * considera "lendo" por esse tempo.
 */
export const MINUTOS_TRAVA_LEITURA = 90;
/** O texto que a própria pessoa escreve ao corrigir um item: mais folgado que o da IA, nunca cortado em silêncio. */
export const TAMANHO_MAXIMO_TEXTO_DA_PESSOA = 500;
/** O que se aceita receber como correção antes de qualquer tratamento (acima disto, erro sem olhar o texto). */
export const TAMANHO_MAXIMO_TEXTO_BRUTO_DA_PESSOA = 2_000;

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
  /**
   * As fontes que a marca tem hoje na Conta (site informado, Instagram, YouTube). O que veio de uma
   * fonte que a pessoa tirou da Conta sai da tela (se não foi confirmado). Sem este campo, a regra não vale.
   */
  fontesConfiguradas?: ReadonlySet<FonteContextoMarca>;
  primeiraLeitura: boolean;
  agora: Date;
  tetoAtivos?: number;
}): Reconciliacao {
  const { existentes, fontesLidas, fontesConfiguradas, primeiraLeitura, agora } = entrada;
  const teto = entrada.tetoAtivos ?? TETO_ITENS_ATIVOS;
  const resumo: Reconciliacao["resumo"] = {
    novos: 0,
    mudaram: 0,
    iguais: 0,
    sumiram: 0,
    descartados: { origemNaoLida: 0, tiradoVoltando: 0, repetido: 0, acimaDoTeto: 0, suspeito: 0 },
  };
  const atualizacoes = new Map<number, AtualizacaoItem>();
  const criar: NovoItem[] = [];

  const porId = new Map(existentes.map((item) => [item.id, item]));
  const ligados = new Set<number>();
  const tirados = existentes.filter((item) => item.estado === "recusado");

  // A. Limpa e filtra o que a IA propôs. Um id que não existe (a IA pode inventar) conta como "sem id".
  const limpos: ItemProposto[] = [];
  for (const proposto of entrada.propostos) {
    const texto = limparTextoDoItem(proposto.texto);
    if (texto === "") continue;
    if (!fontesLidas.has(proposto.origem)) {
      resumo.descartados.origemNaoLida += 1;
      continue;
    }
    if (itemSuspeito(texto)) {
      resumo.descartados.suspeito += 1;
      continue;
    }
    const idValido = proposto.idAnterior !== null && porId.has(proposto.idAnterior) ? proposto.idAnterior : null;
    const repetido = limpos.some(
      (outro) =>
        (idValido !== null && outro.idAnterior === idValido) ||
        (outro.categoria === proposto.categoria && similaridade(outro.texto, texto) >= LIMIAR_MESMO_TEXTO),
    );
    if (repetido) {
      resumo.descartados.repetido += 1;
      continue;
    }
    limpos.push({ ...proposto, texto, idAnterior: idValido });
  }

  // B. Primeiro as que citam um id que existe: é a ligação que a IA fez de propósito. Só vale dentro da
  //    mesma categoria: uma confirmação de "vende" nunca vira "fala" porque a IA reaproveitou o id.
  const semLigacao: ItemProposto[] = [];
  const paraLigar: { proposto: ItemProposto; existente: ItemExistente }[] = [];
  for (const proposto of limpos) {
    const citado = proposto.idAnterior !== null ? porId.get(proposto.idAnterior) : undefined;
    if (!citado || ligados.has(citado.id)) {
      semLigacao.push({ ...proposto, idAnterior: null });
      continue;
    }
    if (!estaVivo(citado)) {
      resumo.descartados.tiradoVoltando += 1;
      continue;
    }
    if (citado.categoria !== proposto.categoria) {
      semLigacao.push({ ...proposto, idAnterior: null });
      continue;
    }
    ligados.add(citado.id);
    paraLigar.push({ proposto, existente: citado });
  }

  // C. As sem id: se lembra o que a pessoa tirou (em qualquer categoria), descarta; se é o mesmo assunto de um
  //    item vivo da mesma categoria, liga (os pares de maior semelhança primeiro, nunca pela ordem da IA);
  //    senão é novo.
  const restantes: ItemProposto[] = [];
  for (const proposto of semLigacao) {
    if (tirados.some((tirado) => similaridade(tirado.texto, proposto.texto) >= LIMIAR_MESMO_ASSUNTO)) {
      resumo.descartados.tiradoVoltando += 1;
      continue;
    }
    restantes.push(proposto);
  }
  const pares: { indice: number; existente: ItemExistente; nota: number }[] = [];
  restantes.forEach((proposto, indice) => {
    for (const existente of existentes) {
      if (!estaVivo(existente) || ligados.has(existente.id) || existente.categoria !== proposto.categoria) continue;
      const nota = Math.max(
        similaridade(existente.texto, proposto.texto),
        existente.textoConfirmado ? similaridade(existente.textoConfirmado, proposto.texto) : 0,
      );
      if (nota >= LIMIAR_MESMO_ASSUNTO) pares.push({ indice, existente, nota });
    }
  });
  pares.sort((a, b) => b.nota - a.nota);
  const propostasLigadas = new Set<number>();
  for (const par of pares) {
    if (propostasLigadas.has(par.indice) || ligados.has(par.existente.id)) continue;
    propostasLigadas.add(par.indice);
    ligados.add(par.existente.id);
    paraLigar.push({ proposto: restantes[par.indice], existente: par.existente });
  }
  restantes.forEach((proposto, indice) => {
    if (propostasLigadas.has(indice)) return;
    criar.push({
      categoria: proposto.categoria,
      origem: proposto.origem,
      texto: proposto.texto,
      novidade: primeiraLeitura ? (proposto.alemDoBriefing ? "alem_do_briefing" : null) : "nova",
    });
  });

  // D. Os ligados. Igual: só a data (e a pílula de "novidade deste mês" dura até a leitura seguinte, então
  //    sai aqui). A IA voltou a dizer o que a pessoa tinha confirmado, e havia uma proposta pendente
  //    diferente: a pendente cai e o item volta a ser o que a pessoa confirmou. Mudou: a nova proposta vai
  //    a confirmar, e o que estava em vigor continua valendo até ela decidir.
  for (const { proposto, existente } of paraLigar) {
    const semelhancaComAProposta = similaridade(existente.texto, proposto.texto);
    const semelhancaComOConfirmado = existente.textoConfirmado !== null ? similaridade(existente.textoConfirmado, proposto.texto) : 0;
    const diziaQueNaoMudou = proposto.mudouDeSentido === false;
    const igualAProposta =
      semelhancaComAProposta >= LIMIAR_MESMO_TEXTO || (diziaQueNaoMudou && semelhancaComAProposta >= LIMIAR_PARAFRASE_DECLARADA);
    const igualAoConfirmado =
      existente.textoConfirmado !== null &&
      (semelhancaComOConfirmado >= LIMIAR_MESMO_TEXTO || (diziaQueNaoMudou && semelhancaComOConfirmado >= LIMIAR_PARAFRASE_DECLARADA));
    if (igualAProposta) {
      resumo.iguais += 1;
      atualizacoes.set(existente.id, { id: existente.id, novidade: null, ultimaVezVistoEm: agora, sumiuEm: null });
      continue;
    }
    if (igualAoConfirmado) {
      resumo.iguais += 1;
      atualizacoes.set(
        existente.id,
        existente.estado === "para_confirmar"
          ? { id: existente.id, texto: proposto.texto, estado: "confirmado", novidade: null, ultimaVezVistoEm: agora, sumiuEm: null }
          : { id: existente.id, novidade: null, ultimaVezVistoEm: agora, sumiuEm: null },
      );
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

  // E. O que não voltou: "sumiu" se a fonte do item foi lida agora e não o repropôs, ou se a pessoa tirou a
  //    fonte da Conta. Fonte que não foi lida agora (e continua na Conta) não diz nada.
  for (const existente of existentes) {
    if (!estaVivo(existente) || ligados.has(existente.id)) continue;
    const fonteTirada = fontesConfiguradas !== undefined && !fontesConfiguradas.has(existente.origem);
    if (!fontesLidas.has(existente.origem) && !fonteTirada) continue;
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
