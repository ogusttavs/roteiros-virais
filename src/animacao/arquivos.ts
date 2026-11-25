/**
 * E68 A2: os arquivos do vídeo de animação no volume de edição (`EDICAO_PASTA`), subpasta `animacao/`: `an-<id>-previa.mp4` e `an-<id>-final.mp4`. O banco guarda só o nome RELATIVO; aqui está a
 * única função que o transforma em caminho de disco e ela recusa tudo que não seja o nome que nós geramos. O render escreve num `.parte` de nome único e só renomeia quando termina bem.
 * Nada daqui vai para log além do número da animação.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { pastaDaEdicao } from "@/edicao/arquivos";

export const SUBPASTA_DA_ANIMACAO = "animacao";
export type QualidadeDoArquivo = "previa" | "final";

const NOME_VALIDO = /^animacao\/an-\d{1,9}-(previa|final)\.mp4$/;
const PARTE = /^an-\d{1,9}\.[0-9a-f]{12}\.parte$/;

export function nomeRelativoDaAnimacao(animacaoId: number, qualidade: QualidadeDoArquivo): string {
  return `${SUBPASTA_DA_ANIMACAO}/an-${animacaoId}-${qualidade}.mp4`;
}

/** O caminho de disco de um nome relativo. Lança se o nome não é um dos que `nomeRelativoDaAnimacao` gera (nada de `..` nem de caminho absoluto). */
export function caminhoDaAnimacaoNoVolume(relativo: string): string {
  if (!NOME_VALIDO.test(relativo)) throw new Error("nome de arquivo de animacao invalido");
  return join(pastaDaEdicao(), ...relativo.split("/"));
}

export async function garantirSubpastaDaAnimacao(): Promise<void> {
  await mkdir(join(pastaDaEdicao(), SUBPASTA_DA_ANIMACAO), { recursive: true });
}

/** O arquivo que o render escreve enquanto trabalha: nome único por tentativa, no padrão `.parte` que a varredura reconhece. */
export function caminhoDeSaidaDaAnimacao(animacaoId: number): string {
  return join(pastaDaEdicao(), SUBPASTA_DA_ANIMACAO, `an-${animacaoId}.${randomBytes(6).toString("hex")}.parte`);
}

export async function concluirArquivoDaAnimacao(parcial: string, relativo: string): Promise<void> {
  await rename(parcial, caminhoDaAnimacaoNoVolume(relativo));
}

export async function tamanhoDoArquivoDaAnimacao(relativo: string | null): Promise<number | null> {
  if (!relativo) return null;
  try {
    const info = await stat(caminhoDaAnimacaoNoVolume(relativo));
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

export async function apagarArquivoDaAnimacao(relativo: string | null): Promise<void> {
  if (!relativo) return;
  try {
    await rm(caminhoDaAnimacaoNoVolume(relativo), { force: true });
  } catch {
    // Nome inválido ou já apagado: não há o que apagar.
  }
}

/** Apaga da subpasta o que não tem dono (arquivo fora da lista `nomesComDono`) e o `.parte` velho. Devolve quantos de cada. */
export async function varrerSobrasDaAnimacao(nomesComDono: ReadonlySet<string>, agora: Date, idadeMinimaMs: number): Promise<{ orfaos: number; partes: number }> {
  let orfaos = 0;
  let partes = 0;
  let nomes: string[];
  try {
    nomes = await readdir(join(pastaDaEdicao(), SUBPASTA_DA_ANIMACAO));
  } catch {
    return { orfaos, partes };
  }
  for (const nome of nomes) {
    const relativo = `${SUBPASTA_DA_ANIMACAO}/${nome}`;
    const ehParte = PARTE.test(nome);
    if (!ehParte && !NOME_VALIDO.test(relativo)) continue;
    if (!ehParte && nomesComDono.has(relativo)) continue;
    const caminho = join(pastaDaEdicao(), SUBPASTA_DA_ANIMACAO, nome);
    try {
      const info = await stat(caminho);
      if (!info.isFile() || agora.getTime() - info.mtimeMs <= idadeMinimaMs) continue;
      await rm(caminho, { force: true });
      if (ehParte) partes += 1;
      else orfaos += 1;
    } catch {
      // Sumiu no meio do caminho: já está resolvido.
    }
  }
  return { orfaos, partes };
}
