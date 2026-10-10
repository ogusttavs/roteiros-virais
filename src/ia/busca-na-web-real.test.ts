/**
 * O ramo REAL de `buscarNaWeb` (E54), sem rede: o SDK é trocado por uma função que devolve respostas montadas no formato da ferramenta.
 * O que se prova aqui é o que protege o gasto: o uso das voltas soma, `max_uses` desce a cada volta, a pausa volta como veio, e uma
 * resposta que não terminou (pausa sem fim, texto cortado, recusa, queda) é erro que LEVA o que já foi cobrado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, config: { ...original.config, ia: { ...original.config.ia, provedor: "anthropic" } } };
});
vi.mock("./cliente", async () => {
  const { ErroIA } = await import("./erro");
  return {
    anthropic: () => ({ messages: { create } }),
    traduzirErro: (erro: unknown) => new ErroIA(`traduzido: ${String(erro)}`),
  };
});

import { buscarNaWeb, ErroDaBusca } from "./busca-na-web";
import { ErroIA } from "./erro";

const PARAMS = { sistemaEstavel: "sistema", entrada: "pedido", maxBuscas: 5, dominios: ["ibge.gov.br", "g1.globo.com"] };

const citacao = { type: "web_search_result_location", url: "https://www.ibge.gov.br/a", title: "IBGE", cited_text: "O IPCA ficou em 4,5%.", encrypted_index: "x" };

function resposta(sobre: Record<string, unknown> = {}) {
  return {
    model: "claude-haiku-4-5",
    stop_reason: "end_turn",
    content: [
      { type: "server_tool_use", name: "web_search", id: "s1", input: {} },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.ibge.gov.br/a", title: "IBGE", page_age: "May 1, 2026" }] },
      { type: "text", text: "- O IPCA ficou em 4,5%.", citations: [citacao] },
    ],
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 } },
    ...sobre,
  };
}

beforeEach(() => {
  create.mockReset();
});

describe("buscarNaWeb (o ramo real)", () => {
  it("monta o pedido: a ferramenta básica, só os domínios da lista, o teto de buscas, o Brasil, sem repetir sozinho e com texto bem formado", async () => {
    create.mockResolvedValueOnce(resposta());
    await buscarNaWeb({ ...PARAMS, entrada: "preço \uD83D de produtos" });
    const [corpo, opcoes] = create.mock.calls[0];
    expect(corpo.model).toBe("claude-haiku-4-5");
    expect(corpo.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 5, allowed_domains: ["ibge.gov.br", "g1.globo.com"], user_location: { type: "approximate", country: "BR" } },
    ]);
    expect(corpo.messages).toEqual([{ role: "user", content: "preço � de produtos" }]);
    expect(corpo.system[0]).toMatchObject({ type: "text", text: "sistema", cache_control: { type: "ephemeral" } });
    expect(opcoes).toEqual({ maxRetries: 0, timeout: 120_000 });
  });

  it("uma volta: lê as linhas e as páginas e cobra as buscas que a Anthropic contou", async () => {
    create.mockResolvedValueOnce(resposta());
    const r = await buscarNaWeb(PARAMS);
    expect(r.linhas.map((l) => l.texto)).toEqual(["- O IPCA ficou em 4,5%."]);
    expect(r.paginas).toHaveLength(1);
    expect(r.buscas).toBe(2);
    expect(r.uso).toMatchObject({ tokensEntrada: 1000, tokensSaida: 100, buscasNaWeb: 2 });
    expect(r.modelo).toBe("claude-haiku-4-5");
  });

  it("sem `server_tool_use` no uso, a contagem dos blocos é a melhor leitura", async () => {
    create.mockResolvedValueOnce(resposta({ usage: { input_tokens: 10, output_tokens: 5 } }));
    const r = await buscarNaWeb(PARAMS);
    expect(r.buscas).toBe(1);
    expect(r.uso.buscasNaWeb).toBe(1);
  });

  it("a pausa volta como veio, o teto desce pelo que já foi feito, e o uso das voltas soma", async () => {
    const pausada = resposta({ stop_reason: "pause_turn" });
    create.mockResolvedValueOnce(pausada).mockResolvedValueOnce(resposta({ usage: { input_tokens: 500, output_tokens: 50, server_tool_use: { web_search_requests: 1 } } }));
    const r = await buscarNaWeb(PARAMS);
    expect(create).toHaveBeenCalledTimes(2);
    const segunda = create.mock.calls[1][0];
    expect(segunda.tools[0].max_uses).toBe(3);
    expect(segunda.messages[1]).toEqual({ role: "assistant", content: pausada.content });
    expect(r.uso).toMatchObject({ tokensEntrada: 1500, tokensSaida: 150, buscasNaWeb: 3 });
    expect(r.buscas).toBe(3);
    expect(r.linhas).toHaveLength(2);
  });

  it("pausa que nunca termina é erro, e leva o que já foi gasto", async () => {
    create.mockResolvedValue(resposta({ stop_reason: "pause_turn", usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } }));
    const erro = await buscarNaWeb(PARAMS).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaBusca);
    expect(erro).toBeInstanceOf(ErroIA);
    expect(erro.usoParcial).toMatchObject({ tokensEntrada: 300, buscasNaWeb: 3 });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("o teto de buscas acabou no meio da pausa: para sem pedir mais, com erro e o gasto", async () => {
    create.mockResolvedValueOnce(resposta({ stop_reason: "pause_turn", usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 5 } } }));
    const erro = await buscarNaWeb(PARAMS).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaBusca);
    expect(erro.usoParcial.buscasNaWeb).toBe(5);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("texto cortado (max_tokens) é erro, não 'sem dado'", async () => {
    create.mockResolvedValueOnce(resposta({ stop_reason: "max_tokens" }));
    const erro = await buscarNaWeb(PARAMS).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaBusca);
    expect(erro.message).toContain("cortada");
    expect(erro.usoParcial.buscasNaWeb).toBe(2);
  });

  it("recusa do modelo é erro com o gasto", async () => {
    create.mockResolvedValueOnce(resposta({ stop_reason: "refusal" }));
    const erro = await buscarNaWeb(PARAMS).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaBusca);
    expect(erro.usoParcial.buscasNaWeb).toBe(2);
  });

  it("a queda na segunda volta leva o que a primeira já custou; na primeira, leva zero", async () => {
    create.mockResolvedValueOnce(resposta({ stop_reason: "pause_turn" })).mockRejectedValueOnce(new Error("429 muitas requisicoes"));
    const aoMeio = await buscarNaWeb(PARAMS).catch((e) => e);
    expect(aoMeio).toBeInstanceOf(ErroDaBusca);
    expect(aoMeio.usoParcial).toMatchObject({ tokensEntrada: 1000, buscasNaWeb: 2 });
    expect(aoMeio.message).toContain("traduzido");

    create.mockReset();
    create.mockRejectedValueOnce(new Error("400 busca desligada"));
    const logo = await buscarNaWeb(PARAMS).catch((e) => e);
    expect(logo).toBeInstanceOf(ErroDaBusca);
    expect(logo.usoParcial).toMatchObject({ tokensEntrada: 0, buscasNaWeb: 0 });
  });
});
