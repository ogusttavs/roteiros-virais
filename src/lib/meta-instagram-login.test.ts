import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      auth: { ...original.config.auth, secret: "segredo-de-sessao-de-teste" },
      metaConexao: {
        appId: "1078374371332982",
        appSecret: "segredo-do-app-do-facebook",
        loginConfigId: "config-de-teste-123",
        tokenChave: Buffer.alloc(32, 5).toString("base64"),
        redirectUri: "https://klaki.exemplo.teste/api/meta/retorno",
        instagram: { appId: "990602627938098", appSecret: "segredo-do-app-do-instagram", redirectUri: "https://klaki.exemplo.teste/api/meta/retorno", ativa: true },
        viaFacebookLigada: false,
        ativa: true,
        simuladorE2E: "",
      },
    },
  };
});

import {
  conferirPermissoesInstagram,
  contaDoTokenInstagram,
  ESCOPOS_DO_INSTAGRAM,
  renovarTokenInstagram,
  trocarCodigoPorTokenInstagram,
  trocarPorLongaDuracaoInstagram,
  urlDoDialogoInstagram,
} from "./meta-instagram-login";
import { ErroMetaLogin } from "./meta-oauth";

const mockFetch = vi.fn();

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function ultimaChamada(): { url: URL; init: RequestInit | undefined } {
  const [entrada, init] = mockFetch.mock.calls.at(-1) as [URL | string, RequestInit | undefined];
  return { url: new URL(String(entrada)), init };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("o endereço de autorizar do Login do Instagram (ig-login-business-login.md, Etapa 1)", () => {
  it("é o do Instagram, com o ID do app do Instagram, os três escopos, o fluxo de código e o state; sem config_id e sem nada do Facebook", () => {
    const url = new URL(urlDoDialogoInstagram("o-state-assinado"));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("990602627938098");
    expect(url.searchParams.get("redirect_uri")).toBe("https://klaki.exemplo.teste/api/meta/retorno");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish");
    expect(url.searchParams.get("state")).toBe("o-state-assinado");
    expect(url.searchParams.has("config_id")).toBe(false);
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(url.host).not.toContain("facebook");
  });

  it("os escopos são só os novos valores da documentação (os antigos `business_*` deixaram de valer em 27/01/2025)", () => {
    for (const escopo of ESCOPOS_DO_INSTAGRAM) expect(escopo).toMatch(/^instagram_business_/);
  });
});

describe("trocar o código pelo token curto (Etapa 2)", () => {
  it("POST em api.instagram.com com client_id, client_secret, grant_type, redirect_uri e code, e devolve token, id e permissões", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "IGQ-CURTO", user_id: 1020304050, permissions: ["instagram_business_basic", "instagram_business_manage_insights"] }));
    const curto = await trocarCodigoPorTokenInstagram("o-codigo");
    expect(curto).toEqual({ token: "IGQ-CURTO", usuarioId: "1020304050", permissoes: ["instagram_business_basic", "instagram_business_manage_insights"] });
    const { url, init } = ultimaChamada();
    expect(`${url.origin}${url.pathname}`).toBe("https://api.instagram.com/oauth/access_token");
    expect(init?.method).toBe("POST");
    const corpo = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(corpo)).toEqual({
      client_id: "990602627938098",
      client_secret: "segredo-do-app-do-instagram",
      grant_type: "authorization_code",
      redirect_uri: "https://klaki.exemplo.teste/api/meta/retorno",
      code: "o-codigo",
    });
    // O segredo e o código vão no corpo, nunca no endereço.
    expect(url.search).toBe("");
  });

  it("aceita o formato dos exemplos da documentação (objeto dentro de `data`) e as permissões em texto separado por vírgula", async () => {
    mockFetch.mockResolvedValue(resposta({ data: [{ access_token: "IGQ-CURTO", user_id: "77", permissions: "instagram_business_basic,instagram_business_content_publish" }] }));
    const curto = await trocarCodigoPorTokenInstagram("c");
    expect(curto.token).toBe("IGQ-CURTO");
    expect(curto.permissoes).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
  });

  it("o erro no formato do api.instagram.com vira ErroMetaLogin com o código, sem o código de autorização nem o segredo", async () => {
    mockFetch.mockResolvedValue(resposta({ error_type: "OAuthException", code: 400, error_message: "Matching code was not found or was already used" }, 400));
    const erro = await trocarCodigoPorTokenInstagram("o-codigo-secreto").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroMetaLogin);
    expect((erro as ErroMetaLogin).codigo).toBe(400);
    expect(String((erro as Error).message)).not.toContain("o-codigo-secreto");
    expect(String((erro as Error).message)).not.toContain("segredo-do-app-do-instagram");
  });

  it("falha de rede vira mensagem sem endereço", async () => {
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED api.instagram.com?code=o-codigo-secreto"));
    const erro = await trocarCodigoPorTokenInstagram("o-codigo-secreto").catch((e: unknown) => e);
    expect((erro as Error).message).toBe("Nao foi possivel falar com a Meta (rede ou prazo).");
  });

  it("sem token na resposta, recusa", async () => {
    mockFetch.mockResolvedValue(resposta({ user_id: "1" }));
    await expect(trocarCodigoPorTokenInstagram("c")).rejects.toThrow("nao devolveu o token");
  });
});

describe("token de longa duração e renovação (Etapa 3)", () => {
  it("a troca: GET graph.instagram.com/access_token com ig_exchange_token, o segredo do app do Instagram e o token curto; devolve 60 dias", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "IGQ-LONGO", token_type: "bearer", expires_in: 5183944 }));
    const longo = await trocarPorLongaDuracaoInstagram("IGQ-CURTO");
    expect(longo).toEqual({ token: "IGQ-LONGO", expiraEmSeg: 5183944 });
    const { url, init } = ultimaChamada();
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.instagram.com/access_token");
    expect(init?.method).toBeUndefined();
    expect(Object.fromEntries(url.searchParams)).toEqual({ grant_type: "ig_exchange_token", client_secret: "segredo-do-app-do-instagram", access_token: "IGQ-CURTO" });
  });

  it("a renovação: GET graph.instagram.com/refresh_access_token com ig_refresh_token e o token de longa duração, sem o segredo", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "IGQ-RENOVADO", token_type: "bearer", expires_in: 5100000 }));
    const novo = await renovarTokenInstagram("IGQ-LONGO");
    expect(novo).toEqual({ token: "IGQ-RENOVADO", expiraEmSeg: 5100000 });
    const { url } = ultimaChamada();
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.instagram.com/refresh_access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({ grant_type: "ig_refresh_token", access_token: "IGQ-LONGO" });
  });

  it("token vencido na renovação sobe com o código 190 e sem o token na mensagem", async () => {
    mockFetch.mockResolvedValue(resposta({ error: { message: "Error validating access token IGQ-LONGO", code: 190, type: "OAuthException" } }, 400));
    const erro = await renovarTokenInstagram("IGQ-LONGO").catch((e: unknown) => e);
    expect((erro as ErroMetaLogin).codigo).toBe(190);
  });

  it("sem expires_in, a validade fica desconhecida (nula), nunca inventada", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "IGQ-LONGO" }));
    expect((await trocarPorLongaDuracaoInstagram("x")).expiraEmSeg).toBeNull();
  });
});

describe("quem é a conta do token (ig-login-comecar.md)", () => {
  it("GET graph.instagram.com/v26.0/me pedindo user_id, username, account_type e id; usa o user_id como a conta", async () => {
    mockFetch.mockResolvedValue(resposta({ user_id: "17841400000000101", username: "casa.em.ordem", account_type: "BUSINESS", id: "9988" }));
    const conta = await contaDoTokenInstagram("IGQ-LONGO");
    expect(conta).toEqual({ contaId: "17841400000000101", nome: "casa.em.ordem", usuarioId: "9988", profissional: true });
    const { url } = ultimaChamada();
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.instagram.com/v26.0/me");
    expect(url.searchParams.get("fields")).toBe("user_id,username,account_type,id");
    expect(url.searchParams.get("access_token")).toBe("IGQ-LONGO");
    // A prova do segredo é do Facebook: não existe nesta via.
    expect(url.searchParams.has("appsecret_proof")).toBe(false);
  });

  it("aceita o formato `data: [..]` da documentação e Media_Creator como profissional", async () => {
    mockFetch.mockResolvedValue(resposta({ data: [{ user_id: "1", username: "criadora", account_type: "Media_Creator" }] }));
    expect((await contaDoTokenInstagram("t")).profissional).toBe(true);
  });

  it("um tipo que não é empresa nem criador (conta pessoal) não é profissional", async () => {
    mockFetch.mockResolvedValue(resposta({ user_id: "1", username: "pessoa", account_type: "PERSONAL" }));
    expect((await contaDoTokenInstagram("t")).profissional).toBe(false);
  });

  it("sem user_id nem id, recusa", async () => {
    mockFetch.mockResolvedValue(resposta({ username: "x" }));
    await expect(contaDoTokenInstagram("t")).rejects.toThrow("nao devolveu a conta");
  });
});

describe("as permissões liberadas", () => {
  it("exige a básica e a de números; publicar é à parte", () => {
    expect(conferirPermissoesInstagram(["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"])).toEqual({ faltam: [], publicar: true });
    expect(conferirPermissoesInstagram(["instagram_business_basic", "instagram_business_manage_insights"])).toEqual({ faltam: [], publicar: false });
    expect(conferirPermissoesInstagram(["instagram_business_basic"])).toEqual({ faltam: ["instagram_business_manage_insights"], publicar: false });
    expect(conferirPermissoesInstagram([])).toEqual({ faltam: ["instagram_business_basic", "instagram_business_manage_insights"], publicar: false });
  });
});

describe("a rede de verdade nunca é tocada nos testes", () => {
  it("sem fetch simulado, as chamadas recusam", async () => {
    vi.unstubAllGlobals();
    await expect(renovarTokenInstagram("t")).rejects.toThrow("Dentro do Vitest o fetch precisa estar simulado");
  });
});
