/**
 * Verificador em duas camadas (plano de execucao, etapa 4): checagens
 * locais primeiro (travessao, emoji, jargao, proibicoes do briefing, ids de
 * evidencia quando exigidos), depois a tarefa barata verificarTexto.
 * Reprovou, refaz uma vez com o motivo anexado a entrada; reprovou de novo,
 * ErroIA nomeado. As duas tentativas ficam registradas em geracoes_ia.
 */
import { encontrarProblemas } from "@/lib/regras-de-texto";

import { gerarEstruturado, type ParametrosGeracao } from "./cliente";
import { ErroIA } from "./erro";
import * as verificarTexto from "./prompts/verificarTexto";
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
  opcoes: { proibicoes?: string[]; evidencias?: number[]; exigeEvidencia?: boolean } = {},
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

  if (opcoes.exigeEvidencia && (opcoes.evidencias ?? []).length === 0) {
    motivos.push("sem ids de evidencia, e a tarefa exige evidencia");
  }

  return { aprovado: motivos.length === 0, motivos };
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type ParametrosGeracaoVerificada<T> = ParametrosGeracao<T> & {
  versaoPrompt: string;
  clienteId?: number;
  proibicoes?: string[];
  exigeEvidencia?: boolean;
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
  });

  let aprovado = local.aprovado;
  let motivos = local.motivos;

  if (aprovado) {
    const textoJunto = Object.values(campos).join("\n");
    const verificacao = await gerarEstruturado({
      tarefa: "verificarTexto",
      nivel: verificarTexto.nivel,
      effort: verificarTexto.esforco,
      schema: verificarTexto.schema,
      sistemaEstavel: verificarTexto.montarSistemaEstavel(),
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
