import { createHmac } from "node:crypto";

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
        appSecret: "segredo-do-app-de-teste",
        loginConfigId: "config-de-teste-123",
        tokenChave: Buffer.alloc(32, 5).toString("base64"),
        redirectUri: "https://klaki.exemplo.teste/api/meta/retorno",
        ativa: true,
      },
    },
  };
});

import {
  contasDoInstagram,
  criarState,
  ErroMetaLogin,
  lerSignedRequest,
  lerState,
  permissoesQueFaltam,
  provaDoSegredo,
  trocarCodigoPorToken,
  trocarPorLongaDuracao,
  urlDoDialogo,
  usuarioDoToken,
  VALIDADE_DO_STATE_MS,
} from "./meta-oauth";

const SEGREDO_DO_APP = "segredo-do-app-de-teste";
const mockFetch = vi.fn();

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function base64url(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

/** Um `signed_request` como o da Meta: assinatura HMAC-SHA256 da carga, os dois em base64url. */
function signedRequest(carga: Record<string, unknown>, segredo = SEGREDO_DO_APP): string {
  const corpo = base64url(JSON.stringify(carga));
  const assinatura = createHmac("sha256", segredo).update(corpo).digest("base64url");
  return `${assinatura}.${corpo}`;
}

describe("o state assinado", () => {
  const agora = new Date("2026-10-22T12:00:00Z");

  it("o que foi criado volta lido, com a marca e a pessoa, quando o cookie e o retorno sao iguais", () => {
    const state = criarState({ c: 7, u: "pessoa-1" }, agora);
    const leitura = lerState(state, state, agora);
    expect(leitura).toMatchObject({ ok: true, carga: { c: 7, u: "pessoa-1" } });
  });

  it("cada tentativa tem um state diferente", () => {
    expect(criarState({ c: 7, u: "pessoa-1" }, agora)).not.toBe(criarState({ c: 7, u: "pessoa-1" }, agora));
  });

  it("sem o cookie (quem nao abriu o dialogo neste navegador) ou sem o state, recusa", () => {
    const state = criarState({ c: 7, u: "pessoa-1" }, agora);
    expect(lerState(state, null, agora)).toEqual({ ok: false, motivo: "ausente" });
    expect(lerState(state, undefined, agora)).toEqual({ ok: false, motivo: "ausente" });
    expect(lerState(null, state, agora)).toEqual({ ok: false, motivo: "ausente" });
    expect(lerState("", "", agora)).toEqual({ ok: false, motivo: "ausente" });
  });

  it("state de outra tentativa no cookie (diferente do retorno) recusa, mesmo os dois sendo assinados", () => {
    const a = criarState({ c: 7, u: "pessoa-1" }, agora);
    const b = criarState({ c: 7, u: "pessoa-1" }, agora);
    expect(lerState(a, b, agora)).toEqual({ ok: false, motivo: "diferente" });
  });

  it("carga adulterada (a marca trocada) nao passa, mesmo com cookie igual", () => {
    const state = criarState({ c: 7, u: "pessoa-1" }, agora);
    const [corpo, assinatura] = state.split(".");
    const carga = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Record<string, unknown>;
    const falso = `${base64url(JSON.stringify({ ...carga, c: 8 }))}.${assinatura}`;
    expect(lerState(falso, falso, agora)).toEqual({ ok: false, motivo: "invalido" });
  });

  it("lixo, sem ponto, ou assinatura inventada recusa", () => {
    for (const lixo of ["lixo", "a.b", `${base64url("{}")}.${"0".repeat(64)}`]) {
      expect(lerState(lixo, lixo, agora).ok, lixo).toBe(false);
    }
  });

  it("depois do prazo de dez minutos, vence; no limite exato tambem", () => {
    const state = criarState({ c: 7, u: "pessoa-1" }, agora);
    expect(lerState(state, state, new Date(agora.getTime() + VALIDADE_DO_STATE_MS - 1000)).ok).toBe(true);
    expect(lerState(state, state, new Date(agora.getTime() + VALIDADE_DO_STATE_MS))).toEqual({ ok: false, motivo: "expirado" });
    expect(lerState(state, state, new Date(agora.getTime() + 3 * VALIDADE_DO_STATE_MS))).toEqual({ ok: false, motivo: "expirado" });
  });
});

describe("o endereco do dialogo", () => {
  it("usa o config_id e o fluxo de codigo, com a URI exata e o state, e nunca o segredo nem scope", () => {
    const url = new URL(urlDoDialogo("state-x"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("1078374371332982");
    expect(url.searchParams.get("redirect_uri")).toBe("https://klaki.exemplo.teste/api/meta/retorno");
    expect(url.searchParams.get("config_id")).toBe("config-de-teste-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("state")).toBe("state-x");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.toString()).not.toContain(SEGREDO_DO_APP);
  });
});

describe("appsecret_proof", () => {
  it("e o HMAC-SHA256 do token com o segredo do aplicativo como chave", () => {
    expect(provaDoSegredo("EAAtoken")).toBe(createHmac("sha256", SEGREDO_DO_APP).update("EAAtoken").digest("hex"));
    expect(provaDoSegredo("EAAtoken", "outro")).not.toBe(provaDoSegredo("EAAtoken"));
  });
});

describe("o signed_request do aviso de exclusao", () => {
  const carga = { algorithm: "HMAC-SHA256", user_id: "218471", issued_at: 1291836800 };

  it("assinatura certa e algoritmo certo: devolve a carga", () => {
    expect(lerSignedRequest(signedRequest(carga))).toMatchObject({ user_id: "218471" });
  });
  it("aceita o algoritmo em qualquer caixa", () => {
    expect(lerSignedRequest(signedRequest({ ...carga, algorithm: "hmac-sha256" }))).not.toBeNull();
  });
  it("assinatura feita com outro segredo: recusa", () => {
    expect(lerSignedRequest(signedRequest(carga, "segredo-de-outro"))).toBeNull();
  });
  it("carga alterada depois de assinada: recusa", () => {
    const [assinatura] = signedRequest(carga).split(".");
    expect(lerSignedRequest(`${assinatura}.${base64url(JSON.stringify({ ...carga, user_id: "999" }))}`)).toBeNull();
  });
  it("algoritmo errado, sem user_id, vazio, sem ponto ou com pontos a mais: recusa", () => {
    expect(lerSignedRequest(signedRequest({ ...carga, algorithm: "HMAC-SHA1" }))).toBeNull();
    expect(lerSignedRequest(signedRequest({ algorithm: "HMAC-SHA256" }))).toBeNull();
    expect(lerSignedRequest(signedRequest({ ...carga, user_id: "" }))).toBeNull();
    expect(lerSignedRequest("")).toBeNull();
    expect(lerSignedRequest(null)).toBeNull();
    expect(lerSignedRequest("semponto")).toBeNull();
    expect(lerSignedRequest(`${signedRequest(carga)}.extra`)).toBeNull();
  });
  it("sem o segredo do aplicativo, nunca aceita (falha fechada)", () => {
    expect(lerSignedRequest(signedRequest(carga), "")).toBeNull();
  });
});

describe("as chamadas a Graph API (fetch simulado)", () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => {
    vi.stubGlobal("fetch", fetchOriginal);
  });

  it("trocar o codigo: GET em oauth/access_token com o app, o segredo, a mesma URI e o codigo; devolve o token e a validade", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "EAAcurto", token_type: "bearer", expires_in: 3600 }));
    const token = await trocarCodigoPorToken("codigo-1");
    expect(token).toEqual({ token: "EAAcurto", expiraEmSeg: 3600 });
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v26.0/oauth/access_token");
    expect(url.searchParams.get("client_id")).toBe("1078374371332982");
    expect(url.searchParams.get("client_secret")).toBe(SEGREDO_DO_APP);
    expect(url.searchParams.get("redirect_uri")).toBe("https://klaki.exemplo.teste/api/meta/retorno");
    expect(url.searchParams.get("code")).toBe("codigo-1");
  });

  it("trocar por longa duracao: fb_exchange_token com o token curto", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "EAAlongo", token_type: "bearer", expires_in: 5183944 }));
    const token = await trocarPorLongaDuracao("EAAcurto");
    expect(token).toEqual({ token: "EAAlongo", expiraEmSeg: 5183944 });
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("fb_exchange_token")).toBe("EAAcurto");
    expect(url.searchParams.get("client_secret")).toBe(SEGREDO_DO_APP);
  });

  it("sem expires_in a validade e nula (nao inventa)", async () => {
    mockFetch.mockResolvedValue(resposta({ access_token: "EAAlongo" }));
    expect(await trocarPorLongaDuracao("EAAcurto")).toEqual({ token: "EAAlongo", expiraEmSeg: null });
  });

  it("resposta sem token vira erro", async () => {
    mockFetch.mockResolvedValue(resposta({ expires_in: 3 }));
    await expect(trocarPorLongaDuracao("EAAcurto")).rejects.toBeInstanceOf(ErroMetaLogin);
  });

  it("as chamadas com o token da pessoa levam o appsecret_proof e o access_token", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "pessoa-meta-1" }));
    expect(await usuarioDoToken("EAAlongo")).toEqual({ id: "pessoa-meta-1" });
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/v26.0/me");
    expect(url.searchParams.get("access_token")).toBe("EAAlongo");
    expect(url.searchParams.get("appsecret_proof")).toBe(provaDoSegredo("EAAlongo"));
  });

  it("erro da Meta vira ErroMetaLogin com o codigo e o subcodigo, e a mensagem NAO leva o token, o segredo nem o endereco", async () => {
    mockFetch.mockResolvedValue(resposta({ error: { message: "Invalid OAuth access token.", code: 190, error_subcode: 463 } }, 400));
    let erro: unknown;
    try {
      await usuarioDoToken("EAAtoken-secreto");
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroMetaLogin);
    const e = erro as ErroMetaLogin;
    expect([e.codigo, e.subcodigo]).toEqual([190, 463]);
    expect(e.message).not.toContain("EAAtoken-secreto");
    expect(e.message).not.toContain(SEGREDO_DO_APP);
    expect(e.message).not.toContain("graph.facebook.com");
  });

  it("falha de rede vira ErroMetaLogin sem a causa (a causa pode trazer o endereco com o token)", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed https://graph.facebook.com/v26.0/me?access_token=EAAtoken-secreto"));
    let erro: unknown;
    try {
      await usuarioDoToken("EAAtoken-secreto");
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroMetaLogin);
    expect((erro as Error).message).not.toContain("EAAtoken-secreto");
  });

  it("resposta que nao e JSON (5xx em HTML) vira ErroMetaLogin", async () => {
    mockFetch.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    await expect(usuarioDoToken("EAAlongo")).rejects.toMatchObject({ codigo: 502 });
  });

  it("permissoes que faltam: so as exigidas que nao estao 'granted'", async () => {
    mockFetch.mockResolvedValue(
      resposta({
        data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "instagram_manage_insights", status: "declined" },
          { permission: "pages_show_list", status: "granted" },
          { permission: "public_profile", status: "granted" },
        ],
      }),
    );
    expect(await permissoesQueFaltam("EAAlongo")).toEqual(["instagram_manage_insights", "pages_read_engagement"]);
  });

  it("as contas do Instagram: so Paginas com conta profissional ligada, segue a paginacao e usa o username", async () => {
    mockFetch
      .mockResolvedValueOnce(
        resposta({
          data: [
            { id: "pg1", name: "Pagina Um", instagram_business_account: { id: "ig1", username: "contaum" } },
            { id: "pg2", name: "Pagina sem Instagram" },
          ],
          paging: { cursors: { after: "CURSOR1" }, next: "https://graph.facebook.com/proxima" },
        }),
      )
      .mockResolvedValueOnce(resposta({ data: [{ id: "pg3", name: "Pagina Tres", instagram_business_account: { id: "ig3", name: "Nome sem username" } }] }));
    const contas = await contasDoInstagram("EAAlongo");
    expect(contas).toEqual([
      { paginaId: "pg1", paginaNome: "Pagina Um", contaId: "ig1", nome: "contaum" },
      { paginaId: "pg3", paginaNome: "Pagina Tres", contaId: "ig3", nome: "Nome sem username" },
    ]);
    expect(new URL(String(mockFetch.mock.calls[1][0])).searchParams.get("after")).toBe("CURSOR1");
    expect(new URL(String(mockFetch.mock.calls[0][0])).searchParams.get("fields")).toContain("instagram_business_account");
  });

  it("dentro do Vitest, com o fetch de verdade (nao simulado), recusa em vez de chamar a Meta", async () => {
    vi.stubGlobal("fetch", async () => resposta({}));
    await expect(usuarioDoToken("EAAlongo")).rejects.toThrow(/simulado/);
  });
});
