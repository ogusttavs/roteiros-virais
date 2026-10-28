import { describe, expect, it } from "vitest";

import { deveInicializarSentry, limparSentry, limparTextoComQuery, opcoesSentry } from "./sentry";

describe("deveInicializarSentry", () => {
  it("nao inicia sem SENTRY_DSN (etapa 13: a VPS ainda nao tem essa conta)", () => {
    expect(deveInicializarSentry("")).toBe(false);
  });

  it("inicia quando o DSN existe", () => {
    expect(deveInicializarSentry("https://exemplo@o0.ingest.sentry.io/0")).toBe(true);
  });
});

/**
 * E38 PR 2: o leitor de site pede páginas de sites de clientes. Sem a lista vazia, o Sentry anexaria
 * `sentry-trace` e `baggage` (release, ambiente, chave pública) a essa e a toda requisição de saída.
 */
describe("opcoesSentry", () => {
  it("não propaga o rastreio para nenhum endereço de saída", () => {
    expect(opcoesSentry().tracePropagationTargets).toEqual([]);
  });
});

/** Achado 5 da revisão do Fable de 27/10: o breadcrumb de `fetch` do SDK guarda a query inteira em `http.query`. */
describe("a limpeza do que vai ao Sentry", () => {
  const TOKEN = "IGQWRQabc123-TOKEN-DE-VERDADE";
  const SEGREDO = "segredo-do-app-123";

  it("o texto com query perde o valor de access_token, client_secret, code e afins, e guarda o resto", () => {
    expect(limparTextoComQuery(`?access_token=${TOKEN}&fields=status_code`)).toBe("?access_token=[removido]&fields=status_code");
    expect(limparTextoComQuery(`?fields=id&client_secret=${SEGREDO}&grant_type=ig_exchange_token&access_token=${TOKEN}`)).toBe(
      "?fields=id&client_secret=[removido]&grant_type=ig_exchange_token&access_token=[removido]",
    );
    expect(limparTextoComQuery("https://graph.instagram.com/v26.0/me?code=AQB123&redirect_uri=https%3A%2F%2Fx.com")).toBe("https://graph.instagram.com/v26.0/me?code=[removido]&redirect_uri=https%3A%2F%2Fx.com");
    expect(limparTextoComQuery(`access_token=${TOKEN}`)).toBe("access_token=[removido]");
    expect(limparTextoComQuery(`falhou em https://graph.facebook.com/me?ACCESS_TOKEN=${TOKEN}#parte`)).toBe("falhou em https://graph.facebook.com/me?ACCESS_TOKEN=[removido]#parte");
  });

  it("não mexe no que não é segredo, nem em palavras que só terminam parecido (decode=, barcode=)", () => {
    const texto = "https://exemplo.com/a?page=2&decode=abc&barcode=123&fields=id,name";
    expect(limparTextoComQuery(texto)).toBe(texto);
    expect(limparTextoComQuery("sem query nenhuma")).toBe("sem query nenhuma");
  });

  it("o breadcrumb de fetch como o SDK o monta sai sem o token em http.query, e a url e o status continuam", () => {
    const breadcrumb = {
      category: "http",
      type: "http",
      level: "info",
      data: { status_code: 200, url: "https://graph.instagram.com/v26.0/me", "http.method": "GET", "http.query": `?fields=id&access_token=${TOKEN}`, "http.fragment": "" },
    };
    const limpo = limparSentry(breadcrumb);
    expect(limpo.data["http.query"]).toBe("?fields=id&access_token=[removido]");
    expect(limpo.data.url).toBe("https://graph.instagram.com/v26.0/me");
    expect(limpo.data.status_code).toBe(200);
    expect(JSON.stringify(limpo)).not.toContain(TOKEN);
  });

  it("o evento inteiro (breadcrumbs, request, erro, extra, objeto de query) sai sem token, e o código de erro numérico ou textual fica", () => {
    const evento = {
      message: `falhou ${"https://graph.instagram.com/me?access_token=" + TOKEN}`,
      request: { url: `https://app.exemplo/api?code=AQB999&access_token=${TOKEN}`, query_string: { access_token: TOKEN, ok: "1" } },
      exception: { values: [{ type: "Error", value: `GET ?client_secret=${SEGREDO} 400`, mechanism: { data: { code: "ECONNRESET" } } }] },
      breadcrumbs: [{ category: "http", data: { "http.query": `?access_token=${TOKEN}` } }],
      extra: { refresh_token: TOKEN, tentativas: 3, code: 190 },
    };
    const limpo = limparSentry(evento);
    const texto = JSON.stringify(limpo);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toContain("AQB999");
    expect(limpo.request.query_string.ok).toBe("1");
    expect(limpo.exception.values[0].mechanism.data.code).toBe("ECONNRESET");
    expect(limpo.extra).toMatchObject({ tentativas: 3, code: 190, refresh_token: "[removido]" });
  });

  it("não quebra com nulo, número, objeto com ciclo ou muito fundo", () => {
    expect(limparSentry(null)).toBeNull();
    expect(limparSentry(5)).toBe(5);
    const ciclo: Record<string, unknown> = { a: `?access_token=${TOKEN}` };
    ciclo.eu = ciclo;
    expect(() => limparSentry(ciclo)).not.toThrow();
    expect(ciclo.a).toBe("?access_token=[removido]");
  });

  it("as opções entregam a limpeza ao SDK nos três ganchos", () => {
    const o = opcoesSentry();
    for (const gancho of [o.beforeBreadcrumb, o.beforeSend, o.beforeSendTransaction]) {
      expect(gancho({ data: { "http.query": `?access_token=${TOKEN}` } })).toEqual({ data: { "http.query": "?access_token=[removido]" } });
    }
  });
});
