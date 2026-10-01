/**
 * Varre arquivo por arquivo usando as regras de src/lib/regras-de-texto.ts
 * (fonte unica, tambem usada pelo verificador de IA). Sem I/O de escrita
 * nem process.exit aqui, para dar para testar; o ponto de entrada de linha
 * de comando fica em checar-texto.ts.
 */
import { globSync, readFileSync } from "node:fs";

import { encontrarProblemas, EMOJI, JARGAO, TRAVESSAO } from "../src/lib/regras-de-texto";

export { EMOJI, JARGAO, TRAVESSAO };

export const PADROES = ["src/**/*.tsx", "src/textos/**/*.ts", "src/ia/prompts/**/*.ts"];

/**
 * A lista de jargão (brief-frontend.md, seção 8) é sobre o que o cliente lê
 * (regra 6 do CLAUDE.md, "nada de jargão no que o cliente lê"; o cliente é
 * dono de pequeno negócio); o admin é ferramenta interna do Fable, do
 * Gustavo e de quem eles derem acesso, nunca visto pelo cliente. V12b, item
 * 1: "tipo de conteúdo" é o rótulo pedido pelo Fable para esta tela do
 * admin, e cai exatamente na palavra que a seção 8 proíbe para o cliente;
 * travessão e emoji (regras 1 e 2) continuam valendo em todo arquivo, sem
 * exceção, só o jargão fica de fora aqui.
 */
const CAMINHO_ADMIN = /^src\/(app\/admin\/|textos\/admin\.ts$)/;

/**
 * R1, item 1: `regras-formato.ts` copia, sem reescrever, o texto das regras de plataforma da
 * seção 9 das rubricas (o próprio cabeçalho do arquivo diz: "trocar uma regra aqui sem trocar a
 * seção 9 primeiro quebra a fonte da verdade"); `regras-formato.test.ts` confere a cópia exata
 * contra o documento. Uma das regras oficiais usa a palavra "conteúdo" (R-YT-SHORT-04); o cliente
 * nunca lê esse texto, é instrução que o modelo recebe no sistema estável, então regra 6 do
 * `CLAUDE.md` ("nada de jargão no que o cliente lê") não se aplica aqui, mesmo raciocínio de
 * `CAMINHO_ADMIN` acima.
 */
const CAMINHO_REGRAS_PLATAFORMA = /^src\/ia\/prompts\/regras-formato\.ts$/;

export type Problema = { arquivo: string; linha: number; motivo: string };

export function verificarLinha(linha: string): string[] {
  return encontrarProblemas(linha);
}

export function verificarArquivo(caminho: string): Problema[] {
  const conteudo = readFileSync(caminho, "utf8");
  const caminhoNormalizado = caminho.replace(/\\/g, "/");
  const semJargao = CAMINHO_ADMIN.test(caminhoNormalizado) || CAMINHO_REGRAS_PLATAFORMA.test(caminhoNormalizado);
  return conteudo.split("\n").flatMap((linha, i) =>
    verificarLinha(linha)
      .filter((motivo) => !semJargao || !motivo.startsWith("jargao"))
      .map((motivo) => ({ arquivo: caminho, linha: i + 1, motivo })),
  );
}

export function listarArquivos(padroes: string[] = PADROES): string[] {
  const arquivos = new Set<string>();
  for (const padrao of padroes) {
    for (const arquivo of globSync(padrao)) arquivos.add(arquivo);
  }
  return [...arquivos].sort();
}
