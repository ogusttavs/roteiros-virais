/**
 * Conferência do vídeo montado: a largura de um texto com a fonte embutida (`Montserrat-Bold`), lida direto do arquivo da fonte (tabelas `cmap` e `hmtx`, sem dependência nova). A conta é a soma
 * do avanço de cada letra, sem o ajuste fino entre pares (o libass aplica esse ajuste e fecha um pouco o texto), então a medida é a de um texto levemente mais largo que o do vídeo: errar
 * por este lado só gera aviso a mais, nunca deixa passar texto cortado.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { pastaDasFontes } from "./render";

export type MedidasDaFonte = { unidadesPorEm: number; avanco: (codigo: number) => number };

const ARQUIVO_DA_FONTE = "Montserrat-Bold.ttf";

/** Lê as medidas de uma fonte TrueType ou OpenType (cmap formatos 4 e 12). */
export function lerMedidasDaFonte(dados: Buffer): MedidasDaFonte {
  const nTabelas = dados.readUInt16BE(4);
  const tabelas = new Map<string, number>();
  for (let i = 0; i < nTabelas; i++) {
    const base = 12 + 16 * i;
    tabelas.set(dados.toString("latin1", base, base + 4), dados.readUInt32BE(base + 8));
  }
  const obter = (nome: string): number => {
    const posicao = tabelas.get(nome);
    if (posicao === undefined) throw new Error(`a fonte nao tem a tabela ${nome}`);
    return posicao;
  };
  const head = obter("head");
  const unidadesPorEm = dados.readUInt16BE(head + 18);
  const hhea = obter("hhea");
  const nMetricas = dados.readUInt16BE(hhea + 34);
  const hmtx = obter("hmtx");
  const avancoDoGlifo = (glifo: number): number => dados.readUInt16BE(hmtx + 4 * Math.min(glifo, nMetricas - 1));

  const cmap = obter("cmap");
  const nSubtabelas = dados.readUInt16BE(cmap + 2);
  let formato4 = -1;
  let formato12 = -1;
  for (let i = 0; i < nSubtabelas; i++) {
    const posicao = cmap + dados.readUInt32BE(cmap + 4 + 8 * i + 4);
    const formato = dados.readUInt16BE(posicao);
    if (formato === 4 && formato4 < 0) formato4 = posicao;
    if (formato === 12 && formato12 < 0) formato12 = posicao;
  }
  const glifoDoCodigo = (codigo: number): number => {
    if (formato12 >= 0) {
      const grupos = dados.readUInt32BE(formato12 + 12);
      for (let g = 0; g < grupos; g++) {
        const base = formato12 + 16 + 12 * g;
        const inicio = dados.readUInt32BE(base);
        const fim = dados.readUInt32BE(base + 4);
        if (codigo >= inicio && codigo <= fim) return dados.readUInt32BE(base + 8) + (codigo - inicio);
      }
    }
    if (formato4 >= 0 && codigo <= 0xffff) {
      const nSegmentos = dados.readUInt16BE(formato4 + 6) / 2;
      const fins = formato4 + 14;
      const inicios = fins + 2 * nSegmentos + 2;
      const deltas = inicios + 2 * nSegmentos;
      const intervalos = deltas + 2 * nSegmentos;
      for (let s = 0; s < nSegmentos; s++) {
        if (codigo > dados.readUInt16BE(fins + 2 * s)) continue;
        const inicio = dados.readUInt16BE(inicios + 2 * s);
        if (codigo < inicio) return 0;
        const delta = dados.readUInt16BE(deltas + 2 * s);
        const intervalo = dados.readUInt16BE(intervalos + 2 * s);
        if (intervalo === 0) return (codigo + delta) & 0xffff;
        const glifo = dados.readUInt16BE(intervalos + 2 * s + intervalo + 2 * (codigo - inicio));
        return glifo === 0 ? 0 : (glifo + delta) & 0xffff;
      }
    }
    return 0;
  };
  return { unidadesPorEm, avanco: (codigo) => avancoDoGlifo(glifoDoCodigo(codigo)) };
}

let guardada: Promise<MedidasDaFonte> | null = null;

/** As medidas da fonte embutida, lidas uma vez por processo. */
export function medidasDaFonteEmbutida(): Promise<MedidasDaFonte> {
  guardada ??= readFile(join(pastaDasFontes(), ARQUIVO_DA_FONTE)).then(lerMedidasDaFonte);
  guardada.catch(() => {
    guardada = null;
  });
  return guardada;
}

/** A largura, em pixels, de um texto de uma linha no tamanho dado (o tamanho do ASS, na tela de 1080 de largura). */
export function larguraDoTexto(medidas: MedidasDaFonte, texto: string, tamanhoPx: number): number {
  let soma = 0;
  for (const letra of texto) soma += medidas.avanco(letra.codePointAt(0) as number);
  return (soma / medidas.unidadesPorEm) * tamanhoPx;
}
