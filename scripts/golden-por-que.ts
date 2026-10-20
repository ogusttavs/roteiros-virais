/**
 * E50 parte 2, PR 3: o golden set do roteiro que se explica. Imprime o "por quê" de cada bloco como a
 * tela vai mostrar (a frase da tabela, por código) e a coluna "o por quê está certo?": no simulador
 * (`AI_PROVIDER=mock`) quem preenche é uma conferência mecânica (a regra vale para o bloco e o modelo
 * citou o que existe); com a chave real a coluna fica "[ler]" para o Gustavo e o Bruno marcarem.
 * O que o servidor descarta (bloco que não existe, número inventado, regra de outro bloco, vídeo fora
 * da evidência) é contado à parte, porque é o que a prova com chave real precisa medir.
 */
import {
  chavesDeBlocos,
  limparPorQueDosBlocos,
  numerosCitaveis,
  textosDoPorQue,
  type ContextoDaLimpeza,
  type PorQueBruto,
} from "../src/lib/por-que-do-bloco";

export type ResumoDoPorQue = { citados: number; guardados: number; descartados: number };

/** Os blocos que o modelo citou contra os que o servidor guarda: a diferença é o que caiu. */
export function resumirPorQues(brutos: PorQueBruto[], contexto: ContextoDaLimpeza): ResumoDoPorQue {
  const guardados = limparPorQueDosBlocos(brutos, contexto).length;
  return { citados: brutos.length, guardados, descartados: brutos.length - guardados };
}

/** A coluna "o por quê está certo?" do simulador: cada regra citada existe, é citável e vale para o bloco. */
export function respostaDoSimulador(guardados: ReturnType<typeof limparPorQueDosBlocos>[number]): string {
  return guardados.regras.length > 0 || guardados.video ? "sim (conferência mecânica: a regra vale para o bloco)" : "não";
}

export function imprimirPorQueDosBlocos(brutos: PorQueBruto[], contexto: ContextoDaLimpeza, simulado: boolean, escrever: (linha: string) => void = console.log): ResumoDoPorQue {
  const guardados = limparPorQueDosBlocos(brutos, contexto);
  const resumo = resumirPorQues(brutos, contexto);
  escrever("O POR QUE DE CADA BLOCO (como a tela vai mostrar)");
  if (guardados.length === 0) escrever("  (nenhum bloco com por quê)");
  for (const item of guardados) {
    const t = textosDoPorQue(item);
    const base = t.comBaseEm ? (t.comBaseEm.tipo === "video" ? `video ${t.comBaseEm.videoId} aos ${t.comBaseEm.segundo}s` : t.comBaseEm.texto) : "-";
    escrever(`  ${item.bloco} [${item.regras.join(", ") || "so video"}]`);
    escrever(`     o que faz: ${t.oQueFaz || "-"}`);
    escrever(`     com base em: ${base}; para: ${t.para ?? "-"}`);
    escrever(`     o por que esta certo? ${simulado ? respostaDoSimulador(item) : "[ler]"}`);
  }
  const chaves = chavesDeBlocos(contexto.forma).size;
  escrever(`  citados ${resumo.citados}, guardados ${resumo.guardados}, descartados ${resumo.descartados}, blocos possiveis ${chaves}, regras citaveis ${numerosCitaveis(contexto.escopo).size}\n`);
  return resumo;
}
