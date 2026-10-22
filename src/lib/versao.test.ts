/**
 * `src/lib/versao.ts` (hotfix de 22/10/2026): depois de uma subida, a pagina que ficou aberta com o
 * codigo da versao anterior precisa distinguir "versao nova" de "sem rede" e se recarregar sozinha.
 * Aqui estao a decisao (pura) e a reacao ligada a `ehFalhaDeRede` e a `fraseDeFalha`; o que so o
 * navegador de verdade prova (a recarga de fato, o erro real do Next) esta no PR.
 */
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ehFalhaDeRede, fraseDeFalha } from "@/lib/offline";
import { textosConexao } from "@/textos/conexao";

import {
  CHAVE_ULTIMA_RECARGA,
  conferirVersaoEmSegundoPlano,
  ehSinalDeVersaoNova,
  JANELA_ENTRE_RECARGAS_MS,
  podeRecarregar,
  recarregarPorVersaoNova,
  servidorTemVersaoNova,
  versaoMudou,
} from "./versao";

describe("versaoMudou", () => {
  it("so afirma que mudou quando os dois shas existem e sao diferentes", () => {
    expect(versaoMudou("aaa1111", "bbb2222")).toBe(true);
    expect(versaoMudou("aaa1111", "aaa1111")).toBe(false);
  });

  it("sem sha de um dos lados (build local, e2e, resposta torta), nunca recarrega", () => {
    expect(versaoMudou("", "bbb2222")).toBe(false);
    expect(versaoMudou("aaa1111", "")).toBe(false);
    expect(versaoMudou("aaa1111", undefined)).toBe(false);
    expect(versaoMudou("aaa1111", null)).toBe(false);
    expect(versaoMudou("aaa1111", 42)).toBe(false);
  });
});

describe("ehSinalDeVersaoNova", () => {
  it("o erro do Next para 'o servidor nao conhece esta acao' e sinal certo", () => {
    expect(
      ehSinalDeVersaoNova(
        new UnrecognizedActionError('Server Action "x" was not found on the server.'),
      ),
    ).toBe(true);
    expect(
      ehSinalDeVersaoNova(
        new Error(
          "Failed to find Server Action 'abc'. This request might be from an older or newer deployment.",
        ),
      ),
    ).toBe(true);
  });

  it("queda de rede e erro comum nao sao sinal de versao nova", () => {
    expect(ehSinalDeVersaoNova(new TypeError("Failed to fetch"))).toBe(false);
    expect(ehSinalDeVersaoNova(new Error("Connection closed."))).toBe(false);
    expect(ehSinalDeVersaoNova("texto")).toBe(false);
    expect(ehSinalDeVersaoNova(undefined)).toBe(false);
  });
});

describe("podeRecarregar (trava contra laco)", () => {
  it("a primeira recarga passa; uma segunda dentro da janela nao", () => {
    expect(podeRecarregar(1_000_000, null)).toBe(true);
    expect(podeRecarregar(1_000_000 + 5_000, 1_000_000)).toBe(false);
    expect(podeRecarregar(1_000_000 + JANELA_ENTRE_RECARGAS_MS, 1_000_000)).toBe(true);
  });

  it("valor guardado estragado ou relogio que voltou nao trava para sempre", () => {
    expect(podeRecarregar(1_000_000, Number.NaN)).toBe(true);
    expect(podeRecarregar(1_000, 9_000_000)).toBe(true);
  });
});

describe("servidorTemVersaoNova", () => {
  const resposta = (corpo: unknown, ok = true) => ({ ok, json: async () => corpo });

  it("o servidor responde outro sha: versao nova", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta({ versao: "bbb2222" }));
    expect(await servidorTemVersaoNova("aaa1111", buscar)).toBe(true);
    expect(buscar).toHaveBeenCalledWith(
      "/api/versao",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("o servidor responde o mesmo sha: nao e versao nova", async () => {
    expect(
      await servidorTemVersaoNova(
        "aaa1111",
        vi.fn().mockResolvedValue(resposta({ versao: "aaa1111" })),
      ),
    ).toBe(false);
  });

  it("sem rede, erro do servidor ou corpo que nao e JSON: nao e prova de nada, nao recarrega", async () => {
    expect(
      await servidorTemVersaoNova(
        "aaa1111",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      ),
    ).toBe(false);
    expect(
      await servidorTemVersaoNova(
        "aaa1111",
        vi.fn().mockResolvedValue(resposta({ versao: "bbb2222" }, false)),
      ),
    ).toBe(false);
    expect(
      await servidorTemVersaoNova(
        "aaa1111",
        vi
          .fn()
          .mockResolvedValue({ ok: true, json: async () => Promise.reject(new SyntaxError("x")) }),
      ),
    ).toBe(false);
  });

  it("sem sha do navegador (build local), nem pergunta", async () => {
    const buscar = vi.fn();
    expect(await servidorTemVersaoNova("", buscar)).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });
});

/** Um navegador de mentira: onde a pagina recarrega e o que fica no sessionStorage. */
function simularNavegador() {
  const guardado = new Map<string, string>();
  const recarregar = vi.fn();
  vi.stubGlobal("location", { reload: recarregar });
  vi.stubGlobal("sessionStorage", {
    getItem: (chave: string) => guardado.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void guardado.set(chave, valor),
  });
  return { recarregar, guardado };
}

describe("recarregarPorVersaoNova", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recarrega uma vez e nao de novo dentro de um minuto", () => {
    const { recarregar, guardado } = simularNavegador();
    expect(recarregarPorVersaoNova()).toBe(true);
    expect(recarregarPorVersaoNova()).toBe(false);
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(guardado.has(CHAVE_ULTIMA_RECARGA)).toBe(true);
  });

  it("fora do navegador (sem location) nao faz nada", () => {
    expect(recarregarPorVersaoNova()).toBe(false);
  });
});

describe("ehFalhaDeRede e fraseDeFalha diante de uma versao nova", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VERSAO", "aaa1111");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("o servidor nao conhece a acao: recarrega, nao e rede, e a frase avisa da atualizacao", () => {
    const { recarregar } = simularNavegador();
    const erro = new UnrecognizedActionError('Server Action "x" was not found on the server.');
    expect(ehFalhaDeRede(erro)).toBe(false);
    expect(recarregar).toHaveBeenCalledTimes(1);
    // O segundo toque dentro da janela nao recarrega de novo (a frase continua certa).
    expect(fraseDeFalha(erro, "erro do servidor")).toBe(textosConexao.versaoNova);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("'Connection closed.' com o servidor em outro sha: parece rede para a tela, e a pagina recarrega", async () => {
    const { recarregar } = simularNavegador();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ versao: "bbb2222" }) }),
    );
    expect(ehFalhaDeRede(new Error("Connection closed."))).toBe(true);
    await conferirVersaoEmSegundoPlano();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("'Connection closed.' com a rede caida de verdade: nada recarrega", async () => {
    const { recarregar } = simularNavegador();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(ehFalhaDeRede(new Error("Connection closed."))).toBe(true);
    await conferirVersaoEmSegundoPlano();
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("'Connection closed.' com o servidor no mesmo sha (queda de verdade no meio): nada recarrega", async () => {
    const { recarregar } = simularNavegador();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ versao: "aaa1111" }) }),
    );
    expect(ehFalhaDeRede(new Error("Connection closed."))).toBe(true);
    await conferirVersaoEmSegundoPlano();
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("erro comum do servidor nao dispara conferencia nenhuma", () => {
    simularNavegador();
    const buscar = vi.fn();
    vi.stubGlobal("fetch", buscar);
    expect(ehFalhaDeRede(new Error("boom"))).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("codigo que nao carregou (ChunkLoadError) tambem confere a versao, mas segue sem ser 'rede'", async () => {
    const { recarregar } = simularNavegador();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ versao: "bbb2222" }) }),
    );
    const erro = new Error("Loading chunk 123 failed.");
    erro.name = "ChunkLoadError";
    expect(ehFalhaDeRede(erro)).toBe(false);
    await conferirVersaoEmSegundoPlano();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
