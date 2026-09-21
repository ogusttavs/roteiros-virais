/**
 * `src/lib/offline.ts` (V7, itens 6 e 7): limpar o que o aparelho guarda,
 * registrar o escopo, classificar falha de rede, e a correspondencia dos
 * nomes e das cores com os arquivos de `public/` que nao passam pelo
 * TypeScript nem pelo `checar-tokens`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { textosConexao } from "@/textos/conexao";

import {
  CACHE_ESCOPO,
  chaveDoEscopo,
  CHAVE_ESCOPO,
  ehFalhaDeRede,
  fraseDeFalha,
  limparCachesDoAparelho,
  nomeDoCacheDePaginas,
  PREFIXO_CACHE_PAGINAS,
  registrarEscopo,
  type Armazenamento,
} from "./offline";

const RAIZ = path.resolve(__dirname, "..", "..");

/** Um `CacheStorage` de mentira: nome do cache para (chave para texto guardado). */
function armazenamentoDeMentira(inicial: Record<string, Record<string, string>> = {}) {
  const mapa = new Map<string, Map<string, string>>(
    Object.entries(inicial).map(([nome, entradas]) => [nome, new Map(Object.entries(entradas))]),
  );
  const armazenamento = {
    keys: async () => [...mapa.keys()],
    delete: async (nome: string) => mapa.delete(nome),
    open: async (nome: string) => {
      if (!mapa.has(nome)) mapa.set(nome, new Map());
      const entradas = mapa.get(nome)!;
      return {
        put: async (chave: string, resposta: Response) => {
          entradas.set(chave, await resposta.text());
        },
      } as unknown as Cache;
    },
  } as Armazenamento;
  return { armazenamento, mapa };
}

describe("nomes e escopo", () => {
  it("o escopo junta usuario e marca, e o nome do cache de paginas leva o escopo", () => {
    expect(chaveDoEscopo("usuario-a", 7)).toBe("usuario-a:7");
    expect(nomeDoCacheDePaginas("usuario-a:7")).toBe("roteiros-paginas:usuario-a:7");
  });

  it("os nomes de cache sao os mesmos de public/sw.js", () => {
    const sw = readFileSync(path.join(RAIZ, "public", "sw.js"), "utf8");
    const valor = (nome: string) => new RegExp(`var ${nome} = "([^"]+)";`).exec(sw)?.[1];

    expect(valor("PREFIXO_PAGINAS")).toBe(PREFIXO_CACHE_PAGINAS);
    expect(valor("CACHE_ESCOPO")).toBe(CACHE_ESCOPO);
    expect(valor("CHAVE_ESCOPO")).toBe(CHAVE_ESCOPO);
  });
});

describe("limparCachesDoAparelho", () => {
  it("apaga as paginas de todo escopo e o escopo, e deixa os estaticos", async () => {
    const { armazenamento, mapa } = armazenamentoDeMentira({
      "roteiros-paginas:usuario-a:1": { "/hoje": "x" },
      "roteiros-paginas:usuario-b:2": { "/hoje": "y" },
      "roteiros-escopo": { "/__escopo": "usuario-a:1" },
      "roteiros-estaticos-v1": { "/icone-192.png": "png" },
      "outro-app": { "/x": "z" },
    });

    await limparCachesDoAparelho(armazenamento);

    expect([...mapa.keys()].sort()).toEqual(["outro-app", "roteiros-estaticos-v1"]);
  });

  it("sem armazenamento (navegador sem Cache Storage) nao faz nada nem lanca", async () => {
    await expect(limparCachesDoAparelho(undefined)).resolves.toBeUndefined();
  });

  it("um navegador que recusa apagar nunca trava quem esta saindo", async () => {
    const recusa = {
      keys: async () => ["roteiros-paginas:usuario-a:1"],
      delete: async () => {
        throw new Error("recusou");
      },
      open: async () => {
        throw new Error("recusou");
      },
    } as unknown as Armazenamento;

    await expect(limparCachesDoAparelho(recusa)).resolves.toBeUndefined();
  });
});

describe("registrarEscopo", () => {
  it("apaga as paginas de outro usuario e de outra marca, guarda o escopo, e mantem as do escopo atual", async () => {
    const { armazenamento, mapa } = armazenamentoDeMentira({
      "roteiros-paginas:usuario-a:1": { "/hoje": "a" },
      "roteiros-paginas:usuario-a:2": { "/hoje": "outra marca" },
      "roteiros-paginas:usuario-b:1": { "/hoje": "outro usuario" },
      "roteiros-estaticos-v1": { "/icone-192.png": "png" },
    });

    await registrarEscopo("usuario-a:1", armazenamento);

    expect([...mapa.keys()].sort()).toEqual([
      "roteiros-escopo",
      "roteiros-estaticos-v1",
      "roteiros-paginas:usuario-a:1",
    ]);
    expect(mapa.get("roteiros-escopo")!.get("/__escopo")).toBe("usuario-a:1");
    expect(mapa.get("roteiros-paginas:usuario-a:1")!.get("/hoje")).toBe("a");
  });

  it("sem armazenamento nao faz nada", async () => {
    await expect(registrarEscopo("usuario-a:1", undefined)).resolves.toBeUndefined();
  });
});

describe("ehFalhaDeRede", () => {
  it("TypeError de fetch caido, nos tres navegadores, e falha de rede", () => {
    expect(ehFalhaDeRede(new TypeError("Failed to fetch"))).toBe(true);
    expect(ehFalhaDeRede(new TypeError("Load failed"))).toBe(true);
    expect(ehFalhaDeRede(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
  });

  it("a Server Action cortada no meio da resposta ('Connection closed.') tambem e falha de rede", () => {
    expect(ehFalhaDeRede(new Error("Connection closed."))).toBe(true);
  });

  it("um TypeError de programacao ou um erro comum do servidor nao vira 'sem conexao'", () => {
    expect(ehFalhaDeRede(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(ehFalhaDeRede(new Error("An error occurred in the Server Components render."))).toBe(false);
    expect(ehFalhaDeRede("texto")).toBe(false);
  });
});

describe("fraseDeFalha", () => {
  it("falha de rede vira a frase de rede, e falha do servidor fica com a frase de sempre", () => {
    expect(fraseDeFalha(new TypeError("Failed to fetch"), "erro do servidor")).toBe(textosConexao.falhaDeRede);
    expect(fraseDeFalha(new Error("Connection closed."), "erro do servidor")).toBe(textosConexao.falhaDeRede);
    expect(fraseDeFalha(new Error("boom"), "erro do servidor")).toBe("erro do servidor");
  });

  it("acoes que criam algo trocam a frase de rede por 'a conexao caiu no meio'", () => {
    expect(fraseDeFalha(new TypeError("Failed to fetch"), "x", textosConexao.conexaoCaiuNoMeio)).toBe(
      textosConexao.conexaoCaiuNoMeio,
    );
    expect(fraseDeFalha(new Error("boom"), "x", textosConexao.conexaoCaiuNoMeio)).toBe("x");
  });
});

/**
 * `public/offline.html` repete as cores de `src/ui/tokens.css` (nao passa pelo
 * `checar-tokens`, que so varre CSS de `src/`): este teste e a trava contra a
 * copia envelhecer quando o token mudar.
 */
describe("public/offline.html acompanha os tokens", () => {
  const tokens = readFileSync(path.join(RAIZ, "src", "ui", "tokens.css"), "utf8");
  const html = readFileSync(path.join(RAIZ, "public", "offline.html"), "utf8");

  function bloco(texto: string, inicio: string): string {
    const de = texto.indexOf(inicio);
    if (de === -1) throw new Error(`bloco nao encontrado: ${inicio}`);
    return texto.slice(de, texto.indexOf("}", de));
  }
  const cor = (blocoCss: string, nome: string) =>
    new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{3,8})`).exec(blocoCss)?.[1]?.toLowerCase();

  it("claro", () => {
    const claro = bloco(tokens, '[data-tema="claro"] {');
    const dele = bloco(html, ":root {");
    expect(cor(dele, "--fundo")).toBe(cor(claro, "--cor-fundo"));
    expect(cor(dele, "--titulo")).toBe(cor(claro, "--cor-titulo"));
    expect(cor(dele, "--texto")).toBe(cor(claro, "--cor-texto"));
    expect(cor(dele, "--acao")).toBe(cor(claro, "--cor-acao"));
    expect(cor(dele, "--acao-texto")).toBe(cor(claro, "--cor-acao-texto"));
  });

  it("escuro", () => {
    const escuro = bloco(tokens, '[data-tema="escuro"] {');
    const dele = bloco(html, "@media (prefers-color-scheme: dark) {\n        :root {");
    expect(cor(dele, "--fundo")).toBe(cor(escuro, "--cor-fundo"));
    expect(cor(dele, "--titulo")).toBe(cor(escuro, "--cor-titulo"));
    expect(cor(dele, "--texto")).toBe(cor(escuro, "--cor-texto"));
    expect(cor(dele, "--acao")).toBe(cor(escuro, "--cor-acao"));
    expect(cor(dele, "--acao-texto")).toBe(cor(escuro, "--cor-acao-texto"));
  });
});
