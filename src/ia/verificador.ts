/**
 * Verificador em duas camadas (plano de execucao, etapa 4): checagens
 * locais primeiro (travessao, emoji, jargao, proibicoes do briefing, ids de
 * evidencia quando exigidos), depois a tarefa barata verificarTexto.
 * Reprovou, refaz uma vez com o motivo anexado a entrada; reprovou de novo,
 * ErroIA nomeado. As duas tentativas ficam registradas em geracoes_ia.
 */
import type { TipoAbertura } from "@/db/schema";
import { encontrarProblemas } from "@/lib/regras-de-texto";

import { gerarEstruturado, type ParametrosGeracao } from "./cliente";
import { ErroIA } from "./erro";
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
    tipoAberturaAtual?: TipoAbertura;
    tipoAberturaAnterior?: TipoAbertura | null;
    /**
     * E27, parte 1, item 4: quando o cliente reprovou por "muito longo", a
     * nova versão precisa ficar mais curta que a reprovada. `campos` só tem
     * texto; duração é numérica, por isso entra à parte, já calculada por
     * quem chama.
     */
    duracaoParaMuitoLongo?: { anteriorS: number; novaS: number };
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
  extrairTipoAbertura?: (dados: T) => TipoAbertura;
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
    duracaoParaMuitoLongo:
      params.duracaoReprovadaS !== undefined && params.extrairDuracaoS
        ? { anteriorS: params.duracaoReprovadaS, novaS: params.extrairDuracaoS(resultado.dados) }
        : undefined,
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
