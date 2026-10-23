/**
 * E17 parte 1: a porta única para os embeddings (os vetores da busca por significado). Tudo que o produto faz com um provedor de embeddings passa por aqui; o resto do código recebe a
 * `PortaEmbeddings` e nunca fala com a Voyage. Mesmo desenho de `lib/stripe.ts`.
 *
 * Duas portas:
 * - a simulada (`criarPortaSimulada`), que é a que vale nos testes, no desenvolvimento e sempre que não há `VOYAGE_API_KEY`: determinística, sem rede e sem custo. O vetor é uma contagem de
 *   palavras com hash (mais um pedaço do começo de cada palavra, para "clareamento" e "clareando" ficarem perto), normalizada: textos com palavras em comum ficam mais perto, e o mais parecido
 *   vem primeiro. Prova o encanamento; **não** prova a qualidade da busca (isso é a parte 2, com a chave);
 * - a real (`criarPortaDaVoyage`), HTTP direto com `fetch` (sem pacote novo), que recusa existir dentro do Vitest e sem a chave.
 *
 * Nenhuma das duas guarda nada: quem chama grava o vetor, o custo e a execução.
 */
import { createHash } from "node:crypto";

import { DIMENSOES_DO_VETOR } from "@/db/schema";

import { config } from "./config";

/** "documento" para o que fica guardado (a ficha do vídeo), "consulta" para o texto de quem busca: a Voyage trata os dois de um jeito levemente diferente. */
export type TipoDeTexto = "documento" | "consulta";

export type ResultadoEmbeddings = {
  /** Um vetor por texto, na mesma ordem, cada um com `DIMENSOES_DO_VETOR` números. */
  vetores: number[][];
  /** Tokens que o provedor cobrou (na simulada, uma estimativa de um token a cada quatro caracteres). */
  tokens: number;
};

/** O provedor falhou ou devolveu algo que o código recusa; a mensagem técnica fica no log, a busca simplesmente cai para o texto. */
export class ErroEmbeddings extends Error {}

export interface PortaEmbeddings {
  /** O nome do modelo, gravado junto de cada vetor (vetores de modelos diferentes nunca se comparam). */
  readonly modelo: string;
  readonly dimensoes: number;
  /** Verdadeiro na porta simulada: o job recusa gravar vetor simulado em produção. */
  readonly simulada: boolean;
  embedar(textos: string[], tipo: TipoDeTexto): Promise<ResultadoEmbeddings>;
}

/** Estimativa de tokens: um a cada quatro caracteres, no mínimo um (só para a porta simulada e para o teto de dólar antes da chamada). */
export function estimarTokens(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 4));
}

// ---------------------------------------------------------------------------
// A porta simulada
// ---------------------------------------------------------------------------

/** Minúsculas, sem acento, só letras e números, palavras de pelo menos três letras. */
export function palavrasDoTexto(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3);
}

/** FNV-1a de 32 bits: pequeno, estável entre execuções e máquinas (o `Math.random` e o `hash` do JS não são). */
function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** O vetor simulado de um texto: determinístico, unitário (tamanho 1) e com `DIMENSOES_DO_VETOR` posições. Texto sem palavra nenhuma vira o primeiro eixo, para nunca ser um vetor zerado. */
export function vetorSimulado(texto: string): number[] {
  const v = new Array<number>(DIMENSOES_DO_VETOR).fill(0);
  for (const palavra of palavrasDoTexto(texto)) {
    const h = fnv1a(palavra);
    v[h % DIMENSOES_DO_VETOR] += h & 0x80000000 ? -1 : 1;
    if (palavra.length > 5) {
      const raiz = fnv1a(`raiz:${palavra.slice(0, 5)}`);
      v[raiz % DIMENSOES_DO_VETOR] += raiz & 0x80000000 ? -0.5 : 0.5;
    }
  }
  let norma = Math.sqrt(v.reduce((soma, x) => soma + x * x, 0));
  if (norma === 0) {
    v[0] = 1;
    norma = 1;
  }
  return v.map((x) => x / norma);
}

export const MODELO_SIMULADO = "simulado-v1";

export function criarPortaSimulada(): PortaEmbeddings {
  return {
    modelo: MODELO_SIMULADO,
    dimensoes: DIMENSOES_DO_VETOR,
    simulada: true,
    async embedar(textos) {
      return { vetores: textos.map(vetorSimulado), tokens: textos.reduce((soma, t) => soma + estimarTokens(t), 0) };
    },
  };
}

// ---------------------------------------------------------------------------
// A porta da Voyage
// ---------------------------------------------------------------------------

const URL_DA_VOYAGE = "https://api.voyageai.com/v1/embeddings";
const TENTATIVAS = 3;

type RespostaDaVoyage = { data?: { embedding?: number[]; index?: number }[]; usage?: { total_tokens?: number } };

/** Confere a resposta antes de qualquer vetor chegar ao banco: a quantidade, a ordem e a dimensão. */
export function lerRespostaDaVoyage(corpo: RespostaDaVoyage, quantidade: number): ResultadoEmbeddings {
  const itens = corpo.data;
  if (!Array.isArray(itens) || itens.length !== quantidade) {
    throw new ErroEmbeddings(`A Voyage devolveu ${Array.isArray(itens) ? itens.length : "nenhum"} vetor(es) para ${quantidade} texto(s).`);
  }
  const ordenados = [...itens].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vetores = ordenados.map((item) => {
    const e = item.embedding;
    if (!Array.isArray(e) || e.length !== DIMENSOES_DO_VETOR || e.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
      throw new ErroEmbeddings(`A Voyage devolveu um vetor com ${Array.isArray(e) ? e.length : "nenhuma"} dimensao(oes); esperado ${DIMENSOES_DO_VETOR}.`);
    }
    return e;
  });
  const tokens = corpo.usage?.total_tokens;
  return { vetores, tokens: typeof tokens === "number" && tokens >= 0 ? tokens : 0 };
}

export function criarPortaDaVoyage(chave: string, modelo: string): PortaEmbeddings {
  if (process.env.VITEST) {
    throw new ErroEmbeddings("A porta da Voyage nao existe dentro do Vitest: os testes usam a simulada.");
  }
  if (!chave) throw new ErroEmbeddings("VOYAGE_API_KEY nao esta definida.");

  return {
    modelo,
    dimensoes: DIMENSOES_DO_VETOR,
    simulada: false,
    async embedar(textos, tipo) {
      if (textos.length === 0) return { vetores: [], tokens: 0 };
      let ultimoErro: unknown = null;
      for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
        try {
          const resposta = await fetch(URL_DA_VOYAGE, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
            body: JSON.stringify({ input: textos, model: modelo, input_type: tipo === "consulta" ? "query" : "document", output_dimension: DIMENSOES_DO_VETOR }),
            signal: AbortSignal.timeout(30_000),
          });
          if (resposta.status === 429 || resposta.status >= 500) {
            ultimoErro = new ErroEmbeddings(`A Voyage respondeu ${resposta.status}.`);
          } else if (!resposta.ok) {
            // 4xx que não é limite de uso (chave errada, pedido grande demais): repetir não adianta.
            throw new ErroEmbeddings(`A Voyage recusou o pedido (${resposta.status}).`);
          } else {
            return lerRespostaDaVoyage((await resposta.json()) as RespostaDaVoyage, textos.length);
          }
        } catch (erro) {
          if (erro instanceof ErroEmbeddings && !String(erro.message).includes("respondeu")) throw erro;
          ultimoErro = erro;
        }
        if (tentativa < TENTATIVAS) await new Promise((r) => setTimeout(r, 500 * 2 ** (tentativa - 1)));
      }
      throw new ErroEmbeddings(ultimoErro instanceof Error ? ultimoErro.message : "A Voyage nao respondeu.");
    },
  };
}

// ---------------------------------------------------------------------------
// Qual porta vale
// ---------------------------------------------------------------------------

let porta: PortaEmbeddings | null = null;

/** Troca a porta (testes). Sem argumento, volta à escolha pela configuração. */
export function usarPortaEmbeddings(nova?: PortaEmbeddings): void {
  porta = nova ?? null;
}

export function portaEmbeddings(): PortaEmbeddings {
  if (porta) return porta;
  porta = config.embeddings.provedor === "voyage" ? criarPortaDaVoyage(config.embeddings.voyageKey, config.embeddings.modelo) : criarPortaSimulada();
  return porta;
}

/** O hash da ficha de um vídeo: o texto embedado mais o modelo (vetor de outro modelo não vale; ficha mudada pede vetor novo). */
export function hashDaFicha(ficha: string, modelo: string): string {
  return createHash("sha256").update(`${modelo}\n${ficha}`).digest("hex").slice(0, 32);
}
