/**
 * Verificador em duas camadas (plano de execucao, etapa 4): checagens
 * locais primeiro (travessao, emoji, jargao, proibicoes do briefing, ids de
 * evidencia quando exigidos), depois a tarefa barata verificarTexto.
 * Reprovou, refaz uma vez com o motivo anexado a entrada; reprovou de novo,
 * ErroIA nomeado. As duas tentativas ficam registradas em geracoes_ia.
 */
import type { CartaoStory, FormatoRoteiro, TipoAbertura } from "@/db/schema";
import { encontrarProblemas } from "@/lib/regras-de-texto";


import { gerarEstruturado, type ParametrosGeracao } from "./cliente";
import { ErroIA } from "./erro";
import { NUMEROS_REGRAS_STORY } from "./prompts/regras-formato";
import type { InstrucaoAbertura } from "./prompts/roteiro";
import * as verificarTexto from "./prompts/verificarTexto";
import type { GeneroTexto } from "./prompts/verificarTexto";
import { registrarGeracao } from "./registro";

export type ResultadoVerificacaoLocal = {
  aprovado: boolean;
  motivos: string[];
};

/**
 * So checagem local, sem chamada de IA: pura, facil de testar. Uma
 * proibicao e considerada ferida quando a frase inteira (sem acento,
 * minuscula) aparece dentro do texto gerado; e uma checagem simples de
 * proposito, o que ela nao pega fica para a tarefa verificarTexto.
 */
export function verificarLocalmente(
  campos: Record<string, string>,
  opcoes: {
    proibicoes?: string[];
    evidencias?: number[];
    exigeEvidencia?: boolean;
    /**
     * Os ids que de fato entraram na entrada (revisao do PR #17, etapa 11):
     * sem isto, o verificador so conferia se a lista de evidencias citadas
     * nao estava vazia, nunca se os ids citados eram reais. Na rodada com
     * chave real o modelo inventou ids (a segunda tentativa, depois de
     * reprovado por "sem evidencia", preferiu inventar a admitir que nao
     * tinha nenhuma). Quando informado, todo id citado que nao esta aqui
     * reprova a geracao.
     */
    evidenciasFornecidas?: number[];
    /**
     * O gancho dos roteiros recentes do mesmo cliente (achado do primeiro
     * uso no iPad, item 3): segunda camada de defesa, por codigo, alem da
     * instrucao no prompt (mesmo espirito da licao do PR #17, so instrucao
     * no prompt nao bastava). So reprova quando `campos.gancho` existe;
     * tarefas sem esse campo ignoram a checagem mesmo se a lista vier.
     */
    ganchosRecentes?: string[];
    /**
     * V4, item 5, roteiro sem vício: a primeira palavra do gancho (sem
     * acento, minúscula) não pode repetir a de nenhum dos últimos 5
     * roteiros do cliente ("Espera", "Para", "Olha" são o vício que motivou
     * a etapa). Checagem separada da de `ganchosRecentes` acima: aquela
     * compara as seis primeiras palavras contra os roteiros dos últimos 10
     * dias (achado do iPad, um jeito de pegar o mesmo ângulo reaparecendo);
     * esta pega só o tique de abrir sempre pela mesma palavra, mesmo quando
     * o resto do gancho muda, contra os últimos 5 (contagem, não dias).
     */
    ganchosUltimos5?: string[];
    /**
     * V4, item 5: o tipo de abertura que este roteiro declarou usar, e o do
     * roteiro anterior do cliente. Reprova quando são iguais, a menos que
     * `tipoAberturaAnterior` já venha `null` (quem chama zera isso quando o
     * próprio serviço mandou repetir de propósito, `escolherTipoAbertura`
     * "libera o tipo usado há mais tempo" por falta de alternativa: aí não é
     * vício do modelo, é a única opção que a evidência de hoje tinha).
     */
    /** Nulo em Story (V9c): `escolherTipoAbertura` (V4) não se aplica, a checagem abaixo não roda. */
    tipoAberturaAtual?: TipoAbertura | null;
    tipoAberturaAnterior?: TipoAbertura | null;
    /**
     * V5, item 0b (revisão do PR #48): o que `escolherTipoAbertura` de fato
     * instruiu para este roteiro. Reprova quando o serviço instruiu um tipo
     * concreto e o modelo declarou outro, e quando a instrução era livre e o
     * tipo declarado está na lista dos proibidos. Cinto de segurança: na
     * prova com chave real o modelo obedeceu 9 de 9, mas o checo antigo (só
     * contra o roteiro anterior) deixava passar um modelo que ignorasse a
     * instrução e declarasse um tipo qualquer nunca usado antes.
     */
    instrucaoAbertura?: InstrucaoAbertura;
    /**
     * E27, parte 1, item 4: quando o cliente reprovou por "muito longo", a
     * nova versão precisa ficar mais curta que a reprovada. `campos` só tem
     * texto; duração é numérica, por isso entra à parte, já calculada por
     * quem chama.
     */
    duracaoParaMuitoLongo?: { anteriorS: number; novaS: number };
    /**
     * V9a, item 2: com o momento (o gancho precisa nascer da cena que está
     * na frente do celular), as palavras de conteúdo de `onde` e
     * `oQueEstaAcontecendo` (`palavrasDeConteudo`, abaixo). Reprova quando
     * `campos.gancho` existe e nenhuma delas aparece nele; campos.corpo não
     * conta, a regra é sobre os primeiros três segundos.
     */
    palavrasDoMomento?: string[];
    /**
     * V9c, item 3: as checagens conferíveis por código da seção 9.1
     * (`R-IG-STORY-03` a `07`), só quando `formato === "story"`.
     * `porQueAssim` é conferido sempre que vier, mesmo em Reels (vazio lá,
     * a checagem não encontra nada para reprovar).
     */
    formato?: FormatoRoteiro;
    cartoes?: CartaoStory[] | null;
    porQueAssim?: { regra: string; motivo: string }[];
    /**
     * V9d, item 1: os valores brutos de `gancho`, `corpo` e `chamadaFinal`, antes do filtro de
     * `extrairCamposRoteiro` (que já tira do `campos` qualquer um vazio ou nulo, em qualquer
     * formato). Sem isto, um roteiro em Reels que saísse com `gancho` nulo (o schema 2.0.0 aceita,
     * pensado para Story) não tinha nenhum campo `campos.gancho` para reprovar, e um roteiro em
     * branco passava. Só confere em `formato === "reels"`; em Story a estrutura é `cartoes`, abaixo.
     */
    narrativa?: { gancho: string | null; corpo: string | null; chamadaFinal: string | null };
  } = {},
): ResultadoVerificacaoLocal {
  const motivos: string[] = [];

  for (const [nomeCampo, valor] of Object.entries(campos)) {
    for (const problema of encontrarProblemas(valor)) {
      motivos.push(`${nomeCampo}: ${problema}`);
    }
  }

  const textoJunto = normalizar(Object.values(campos).join(" "));
  for (const proibicao of opcoes.proibicoes ?? []) {
    if (proibicao.trim() && textoJunto.includes(normalizar(proibicao))) {
      motivos.push(`fere a proibicao do cliente: "${proibicao}"`);
    }
  }

  if (campos.gancho && opcoes.ganchosRecentes && opcoes.ganchosRecentes.length > 0) {
    const inicioNovo = inicioDoGancho(campos.gancho);
    const repeteRecente = opcoes.ganchosRecentes.some(
      (recente) => inicioDoGancho(recente) === inicioNovo,
    );
    if (repeteRecente) {
      motivos.push(
        "gancho: repete ou parafraseia as primeiras palavras de um gancho recente do mesmo cliente",
      );
    }
  }

  if (campos.gancho && opcoes.ganchosUltimos5 && opcoes.ganchosUltimos5.length > 0) {
    const palavraNova = primeiraPalavra(campos.gancho);
    const repetePrimeiraPalavra =
      palavraNova !== "" && opcoes.ganchosUltimos5.some((g) => primeiraPalavra(g) === palavraNova);
    if (repetePrimeiraPalavra) {
      motivos.push(
        `gancho: começa com a mesma primeira palavra ("${palavraNova}") de um dos últimos 5 roteiros do cliente`,
      );
    }
  }

  if (
    opcoes.tipoAberturaAtual &&
    opcoes.tipoAberturaAnterior &&
    opcoes.tipoAberturaAtual === opcoes.tipoAberturaAnterior
  ) {
    motivos.push(`tipoAbertura: repete o tipo de abertura do roteiro anterior ("${opcoes.tipoAberturaAtual}")`);
  }

  if (opcoes.tipoAberturaAtual && opcoes.instrucaoAbertura) {
    const instrucao = opcoes.instrucaoAbertura;
    if (instrucao.tipo !== null && opcoes.tipoAberturaAtual !== instrucao.tipo) {
      motivos.push(
        `tipoAbertura: o serviço instruiu "${instrucao.tipo}" e o modelo declarou "${opcoes.tipoAberturaAtual}"`,
      );
    } else if (instrucao.tipo === null && instrucao.tiposProibidos.includes(opcoes.tipoAberturaAtual)) {
      motivos.push(
        `tipoAbertura: a instrução era livre, evitando ${instrucao.tiposProibidos.join(", ")}, e o modelo declarou "${opcoes.tipoAberturaAtual}", um dos proibidos`,
      );
    }
  }

  if (campos.gancho && opcoes.palavrasDoMomento && opcoes.palavrasDoMomento.length > 0) {
    const ganchoNormalizado = normalizar(campos.gancho);
    const citaAlguma = opcoes.palavrasDoMomento.some((palavra) => ganchoNormalizado.includes(palavra));
    if (!citaAlguma) {
      motivos.push(
        "gancho: não cita nenhum elemento concreto do momento descrito (onde ou o que está acontecendo) nos primeiros segundos",
      );
    }
  }

  const evidenciasCitadas = opcoes.evidencias ?? [];

  if (opcoes.exigeEvidencia && evidenciasCitadas.length === 0) {
    motivos.push("sem ids de evidencia, e a tarefa exige evidencia");
  }

  if (
    opcoes.duracaoParaMuitoLongo &&
    opcoes.duracaoParaMuitoLongo.novaS >= opcoes.duracaoParaMuitoLongo.anteriorS
  ) {
    motivos.push(
      `duracao: reprovado por "muito longo" (${opcoes.duracaoParaMuitoLongo.anteriorS}s), mas a nova ` +
        `versao ficou com ${opcoes.duracaoParaMuitoLongo.novaS}s, nao mais curta`,
    );
  }

  if (opcoes.evidenciasFornecidas) {
    const fornecidas = new Set(opcoes.evidenciasFornecidas);
    const inventadas = evidenciasCitadas.filter((id) => !fornecidas.has(id));
    if (inventadas.length > 0) {
      motivos.push(`cita evidencia que nao foi fornecida: ${inventadas.join(", ")}`);
    }
  }

  if (opcoes.formato === "story") {
    if (!opcoes.cartoes || opcoes.cartoes.length === 0) {
      motivos.push("cartoes: nulo ou vazio, um roteiro em story precisa de cartões (V9d, item 1)");
    } else {
      motivos.push(...verificarCartoesStory(opcoes.cartoes));
    }
  }

  if (opcoes.formato === "reels" && opcoes.narrativa) {
    const { gancho, corpo, chamadaFinal } = opcoes.narrativa;
    if (!gancho?.trim()) {
      motivos.push("gancho: nulo ou vazio, um roteiro em reels precisa de gancho (V9d, item 1)");
    }
    if (!corpo?.trim()) {
      motivos.push("corpo: nulo ou vazio, um roteiro em reels precisa de corpo (V9d, item 1)");
    }
    if (!chamadaFinal?.trim()) {
      motivos.push("chamadaFinal: nula ou vazia, um roteiro em reels precisa de chamada final (V9d, item 1)");
    }
  }

  if (opcoes.porQueAssim && opcoes.porQueAssim.length > 0) {
    const invalidas = opcoes.porQueAssim
      .map((item) => item.regra)
      .filter((regra) => !NUMEROS_REGRAS_STORY.has(regra));
    if (invalidas.length > 0) {
      motivos.push(`porQueAssim cita regra que nao existe na lista: ${invalidas.join(", ")}`);
    }
  }

  return { aprovado: motivos.length === 0, motivos };
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const PALAVRAS_INICIO_GANCHO = 6;

/** Minusculas, sem acento, sem pontuacao: as seis primeiras palavras, para comparar ganchos entre si. */
function inicioDoGancho(texto: string): string {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, PALAVRAS_INICIO_GANCHO)
    .join(" ");
}

/** So a primeira palavra, minuscula, sem acento, sem pontuacao (V4, item 5: o tique de abrir sempre igual). */
function primeiraPalavra(texto: string): string {
  return (
    normalizar(texto)
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim()
      .split(/\s+/)[0] ?? ""
  );
}

/**
 * Palavras curtas ou de ligação demais para contar como "elemento concreto"
 * do momento (V9a, item 2): a lista é pequena de propósito, só o que
 * apareceria demais e derrubaria a checagem por acaso, não uma lista
 * completa de preposições e artigos do português.
 */
const PALAVRAS_PARADA_MOMENTO = new Set([
  "para",
  "pela",
  "pelo",
  "esta",
  "estou",
  "estamos",
  "aqui",
  "isso",
  "essa",
  "esse",
  "muito",
  "muita",
  "hoje",
  "agora",
  "onde",
  "aonde",
  "sendo",
  "tendo",
  "depois",
  "antes",
  "porque",
  "porem",
  "entao",
  "sobre",
  "ainda",
  "todo",
  "toda",
  "todos",
  "todas",
]);

/**
 * As palavras de conteúdo de um texto (V9a, item 2, verificador local do
 * momento): minúsculas, sem acento, com 4 letras ou mais, fora da lista de
 * parada acima. Pura e exportada para o teste unitário (3 casos: cita, não
 * cita, cita só no corpo) e para `servicos/roteiro.ts` montar
 * `palavrasDoMomento` a partir de `onde` e `oQueEstaAcontecendo`.
 */
export function palavrasDeConteudo(texto: string): string[] {
  const palavras = normalizar(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 4 && !PALAVRAS_PARADA_MOMENTO.has(palavra));
  return [...new Set(palavras)];
}

/** 2,5 palavras por segundo, até 15 segundos por cartão (`R-IG-STORY-03`, decisão nossa, `estudo-stories.md`). */
const PALAVRAS_POR_SEGUNDO_STORY = 2.5;
const SEGUNDOS_MAX_POR_CARTAO = 15;
const PALAVRAS_MAX_POR_CARTAO = Math.floor(PALAVRAS_POR_SEGUNDO_STORY * SEGUNDOS_MAX_POR_CARTAO);

/** Verbo que fecha a conversa no último cartão (`R-IG-STORY-07`): "me chama" e "no direct" contam como duas palavras. */
const VERBOS_RESPOSTA_STORY = ["responde", "vota", "manda", "toca", "chama", "comenta"];

/**
 * V9d, item 0 (achado do golden set de Stories rodado com chave real depois do ajuste do prompt):
 * "qual dos dois você já usou?" fecha pedindo resposta tanto quanto "vota aqui", mas não usa nenhum
 * verbo da lista acima. Uma pergunta direta no último cartão (termina com "?") também conta como
 * pedir resposta; basta um dos dois sinais (o verbo ou a pergunta) para aprovar.
 */
function fechaPedindoResposta(ultimoCartaoFalar: string): boolean {
  return VERBOS_RESPOSTA_STORY.some((verbo) => ultimoCartaoFalar.includes(verbo)) || ultimoCartaoFalar.includes("?");
}

function contarPalavras(texto: string): number {
  return normalizar(texto)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * O que a seção 9.1 marca como "sim" (conferível por código) para Story
 * (V9c, item 3): número de cartões entre 2 e 5 e até 15 segundos de fala por
 * cartão (`R-IG-STORY-03`, o schema já garante 2 a 5, esta é a segunda
 * camada, mesmo espírito do resto do verificador); algum cartão com
 * figurinha (`R-IG-STORY-04`); texto na tela em todo cartão (`R-IG-STORY-05`,
 * já que todo cartão tem fala, `oQueFalar` é obrigatório no schema); o
 * último cartão com verbo de resposta e sem "segue" (`R-IG-STORY-01` e
 * `R-IG-STORY-07`).
 */
function verificarCartoesStory(cartoes: CartaoStory[]): string[] {
  const motivos: string[] = [];

  if (cartoes.length < 2 || cartoes.length > 5) {
    motivos.push(`cartoes: ${cartoes.length} cartao(oes), a regra R-IG-STORY-03 pede de 2 a 5`);
  }

  cartoes.forEach((cartao, indice) => {
    const palavras = contarPalavras(cartao.oQueFalar);
    if (palavras > PALAVRAS_MAX_POR_CARTAO) {
      motivos.push(
        `cartao ${indice + 1}: ${palavras} palavras passam de ${PALAVRAS_MAX_POR_CARTAO} (R-IG-STORY-03, ate 15s de fala)`,
      );
    }
    if (!cartao.textoNaTela.trim()) {
      motivos.push(`cartao ${indice + 1}: sem texto na tela (R-IG-STORY-05)`);
    }
  });

  const temFigurinha = cartoes.some((cartao) => cartao.figurinha !== "nenhuma");
  if (!temFigurinha) {
    motivos.push("cartoes: nenhum pede interacao por figurinha (R-IG-STORY-04)");
  }

  const ultimo = normalizar(cartoes[cartoes.length - 1]?.oQueFalar ?? "");
  if (/\bsegue\b|\bseguir\b/.test(ultimo)) {
    motivos.push('ultimo cartao: pede para "seguir", quem ve story ja segue (R-IG-STORY-01)');
  }
  if (!fechaPedindoResposta(ultimo)) {
    motivos.push("ultimo cartao: nao fecha pedindo resposta (R-IG-STORY-07)");
  }

  return motivos;
}

export type ParametrosGeracaoVerificada<T> = ParametrosGeracao<T> & {
  versaoPrompt: string;
  clienteId?: number;
  proibicoes?: string[];
  exigeEvidencia?: boolean;
  /** Os ids que entraram na entrada, para o verificador reprovar qualquer id citado fora daqui. */
  evidenciasFornecidas?: number[];
  /** O gancho dos roteiros recentes do mesmo cliente (ver `verificarLocalmente`). */
  ganchosRecentes?: string[];
  /** V4, item 5: o gancho dos últimos 5 roteiros do cliente, para a checagem de primeira palavra (ver `verificarLocalmente`). */
  ganchosUltimos5?: string[];
  /** V4, item 5: o tipo de abertura do roteiro anterior do cliente (ver `verificarLocalmente`). */
  tipoAberturaAnterior?: TipoAbertura | null;
  /** V5, item 0b: o que `escolherTipoAbertura` instruiu, para o verificador conferir contra a instrução (ver `verificarLocalmente`). */
  instrucaoAbertura?: InstrucaoAbertura;
  extrairTipoAbertura?: (dados: T) => TipoAbertura | null;
  /**
   * Duração da versão reprovada, em segundos (E27, parte 1, item 4): só
   * informada quando o cliente reprovou por "muito longo", junto com
   * `extrairDuracaoS` (a tarefa é genérica em `T`, não sabe de antemão se a
   * saída tem duração). A nova versão precisa ficar mais curta que esta.
   */
  duracaoReprovadaS?: number;
  extrairDuracaoS?: (dados: T) => number;
  /**
   * "padrao" (default) ou "analise" (rodada de acabamento de 06/09, item
   * 1): qual criterio de tom a tarefa verificarTexto usa. Ver
   * `prompts/verificarTexto.ts`.
   */
  generoTexto?: GeneroTexto;
  /** V9a, item 2: as palavras de conteúdo do momento, para `verificarLocalmente` (ver lá). */
  palavrasDoMomento?: string[];
  /** V9c, item 3: o formato do roteiro, e como extrair os cartões e o "por que assim" da saída, quando houver. */
  formato?: FormatoRoteiro;
  extrairCartoes?: (dados: T) => CartaoStory[] | null;
  extrairPorQueAssim?: (dados: T) => { regra: string; motivo: string }[];
  /** V9d, item 1: gancho, corpo e chamadaFinal brutos, para `verificarLocalmente` reprovar um Reels vazio (ver lá). */
  extrairNarrativa?: (dados: T) => { gancho: string | null; corpo: string | null; chamadaFinal: string | null };
  extrairCampos: (dados: T) => Record<string, string>;
  extrairEvidencias?: (dados: T) => number[];
};

export type ResultadoVerificacao<T> = {
  dados: T;
  /**
   * Id da linha de `geracoes_ia` da tentativa aprovada (etapa 11, decisão 4
   * do `PROXIMO.md`): quem chama pode gravar a avaliação do cliente
   * ("gostei", "não gostei", o motivo de pedir outro ângulo) nessa mesma
   * linha depois, sem precisar buscar de novo por tarefa e cliente.
   */
  geracaoId: number;
};

/**
 * Gera, verifica em duas camadas, e refaz uma vez se reprovar. As duas
 * tentativas (quando houver a segunda) ficam registradas em geracoes_ia.
 */
export async function gerarComVerificacao<T>(
  params: ParametrosGeracaoVerificada<T>,
): Promise<ResultadoVerificacao<T>> {
  const primeira = await tentarGerarEVerificar(params);
  if (primeira.aprovado) return { dados: primeira.dados, geracaoId: primeira.geracaoId };

  const segunda = await tentarGerarEVerificar({
    ...params,
    entrada: `${params.entrada}\n\nA tentativa anterior foi reprovada. Motivo: ${primeira.motivos.join("; ")}. Corrija isso.`,
  });
  if (segunda.aprovado) return { dados: segunda.dados, geracaoId: segunda.geracaoId };

  throw new ErroIA(`tarefa "${params.tarefa}" reprovada duas vezes: ${segunda.motivos.join("; ")}`);
}

async function tentarGerarEVerificar<T>(
  params: ParametrosGeracaoVerificada<T>,
): Promise<{ aprovado: boolean; dados: T; motivos: string[]; geracaoId: number }> {
  const resultado = await gerarEstruturado(params);
  const campos = params.extrairCampos(resultado.dados);
  const evidencias = params.extrairEvidencias?.(resultado.dados) ?? [];

  const local = verificarLocalmente(campos, {
    proibicoes: params.proibicoes,
    evidencias,
    exigeEvidencia: params.exigeEvidencia,
    evidenciasFornecidas: params.evidenciasFornecidas,
    ganchosRecentes: params.ganchosRecentes,
    ganchosUltimos5: params.ganchosUltimos5,
    tipoAberturaAtual: params.extrairTipoAbertura?.(resultado.dados),
    tipoAberturaAnterior: params.tipoAberturaAnterior,
    instrucaoAbertura: params.instrucaoAbertura,
    duracaoParaMuitoLongo:
      params.duracaoReprovadaS !== undefined && params.extrairDuracaoS
        ? { anteriorS: params.duracaoReprovadaS, novaS: params.extrairDuracaoS(resultado.dados) }
        : undefined,
    palavrasDoMomento: params.palavrasDoMomento,
    formato: params.formato,
    cartoes: params.extrairCartoes?.(resultado.dados),
    porQueAssim: params.extrairPorQueAssim?.(resultado.dados),
    narrativa: params.extrairNarrativa?.(resultado.dados),
  });

  let aprovado = local.aprovado;
  let motivos = local.motivos;

  /**
   * Sem nenhum campo (segunda rodada do PR #42, item 4: a saída vazia do
   * `aprenderCliente`, regra dura 2 do prompt, "sem padrão real, devolva
   * lista vazia"), não há texto nenhum para conferir tom ou proibição: o
   * aprovado local já basta, e chamar `verificarTexto` com uma string vazia
   * só gastaria uma chamada de IA para nada, registrando uma linha de
   * verificação sem sentido em `geracoes_ia`.
   */
  if (aprovado && Object.keys(campos).length > 0) {
    const textoJunto = Object.values(campos).join("\n");
    const verificacao = await gerarEstruturado({
      tarefa: "verificarTexto",
      nivel: verificarTexto.nivel,
      effort: verificarTexto.esforco,
      schema: verificarTexto.schema,
      sistemaEstavel: verificarTexto.montarSistemaEstavel(params.generoTexto),
      entrada: verificarTexto.montarEntrada({
        texto: textoJunto,
        proibicoes: params.proibicoes ?? [],
      }),
    });
    aprovado = verificacao.dados.aprovado;
    motivos = verificacao.dados.aprovado ? [] : [verificacao.dados.motivo ?? "reprovado"];

    await registrarGeracao({
      tarefa: "verificarTexto",
      versaoPrompt: verificarTexto.versao,
      modelo: verificacao.modelo,
      nivel: verificarTexto.nivel,
      clienteId: params.clienteId,
      entradas: { texto: textoJunto },
      saida: verificacao.dados,
      uso: {
        tokensEntrada: verificacao.tokensEntrada,
        tokensSaida: verificacao.tokensSaida,
        tokensCacheLeitura: verificacao.tokensCacheLeitura,
        tokensCacheEscrita: verificacao.tokensCacheEscrita,
      },
    });
  }

  const geracaoId = await registrarGeracao({
    tarefa: params.tarefa,
    versaoPrompt: params.versaoPrompt,
    modelo: resultado.modelo,
    nivel: params.nivel,
    clienteId: params.clienteId,
    entradas: { entrada: params.entrada },
    evidencias,
    saida: resultado.dados as Record<string, unknown>,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
    motivoAvaliacao: motivos.length > 0 ? motivos.join("; ") : undefined,
  });

  return { aprovado, dados: resultado.dados, motivos, geracaoId };
}
