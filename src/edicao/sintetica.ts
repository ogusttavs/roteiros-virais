/**
 * E47 PR 3: fala sintética para os testes e para o golden set de exemplo. Monta, a partir de frases, a lista de palavras com tempo e uma curva de energia coerente com ela (voz alta
 * dentro de cada palavra, silêncio fora), como se uma pessoa tivesse falado essas frases uma depois da outra, com a pausa dita antes de cada uma. Nenhuma voz de ninguém: só números.
 * O golden set REAL (vídeos que o Gustavo vai gravar) traz as palavras da Groq e a curva medida do áudio no lugar disto.
 */
import type { Energia, PalavraFalada } from "./tipos";

export type FraseFalada = {
  texto: string;
  /** Silêncio antes da frase, em segundos. O padrão é 0,2. */
  pausaAntes?: number;
};

export type FalaSintetica = {
  palavras: PalavraFalada[];
  energia: Energia;
  duracao: number;
  /** De qual a qual índice de palavra vai cada frase (os dois incluídos). */
  faixas: Array<{ deIndice: number; ateIndice: number }>;
};

const INICIO_S = 0.8;
const FIM_S = 1.2;
const ENTRE_PALAVRAS_S = 0.06;
const DB_VOZ = -22;
const DB_SILENCIO = -62;

export function montarFalaSintetica(frases: FraseFalada[]): FalaSintetica {
  const palavras: PalavraFalada[] = [];
  const faixas: FalaSintetica["faixas"] = [];
  let t = INICIO_S;
  for (const frase of frases) {
    t += frase.pausaAntes ?? 0.2;
    const deIndice = palavras.length;
    frase.texto
      .split(/\s+/)
      .filter(Boolean)
      .forEach((texto, k) => {
        const duracao = 0.18 + 0.045 * texto.length;
        palavras.push({ texto, inicio: Math.round(t * 1000) / 1000, fim: Math.round((t + duracao) * 1000) / 1000, abreTrecho: k === 0 });
        t += duracao + ENTRE_PALAVRAS_S;
      });
    faixas.push({ deIndice, ateIndice: palavras.length - 1 });
  }
  const duracao = Math.round((t + FIM_S) * 100) / 100;
  const db = new Float32Array(Math.floor(duracao * 100));
  db.fill(DB_SILENCIO);
  for (const p of palavras) {
    const de = Math.floor(p.inicio * 100);
    const ate = Math.min(db.length, Math.ceil(p.fim * 100));
    for (let k = de; k < ate; k++) db[k] = DB_VOZ;
  }
  return { palavras, energia: { db, duracao }, duracao, faixas };
}
