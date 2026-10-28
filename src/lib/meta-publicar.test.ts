/**
 * E56 PR 1: o cliente da Graph API para publicar vídeo (`lib/meta-publicar.ts`), com o `fetch` simulado (nenhum teste fala com a Meta de verdade). Prova a forma de cada chamada contra a
 * documentação baixada (contêiner retomável, envio com `offset` e `file_size`, `status_code`, `media_publish`, `content_publishing_limit`) e que o acesso nunca aparece num erro nem num endereço.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      metaConexao: { appId: "1078374371332982", appSecret: "segredo-do-app-de-teste", loginConfigId: "config-de-teste-123", tokenChave: Buffer.alloc(32, 5).toString("base64"), redirectUri: "https://klaki.exemplo.teste/api/meta/retorno", ativa: true },
    },
  };
});

import { ErroMetaLogin } from "./meta-oauth";
import { criarContainerDeVideo, enderecoDaMidia, enviarVideo, ErroDeEnvioDoVideo, publicarContainer, statusDoContainer, usoDoLimite } from "./meta-publicar";

const TOKEN = "EAA-TOKEN-SECRETO-DA-SUITE";
const mockFetch = vi.fn();

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

/** A chamada n do `fetch`: o endereço, o método, os cabeçalhos e o corpo do formulário já lido. */
function chamada(n = 0) {
  const [entrada, init] = mockFetch.mock.calls[n] as [URL | string, RequestInit | undefined];
  const url = new URL(String(entrada));
  const corpo = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init?.body;
  return { url, metodo: init?.method ?? "GET", cabecalhos: (init?.headers ?? {}) as Record<string, string>, corpo };
}

describe("criarContainerDeVideo", () => {
  it("Reels: POST no formulário com media_type REELS, envio retomável, o Feed ligado e a legenda; o acesso vai no corpo, nunca no endereço", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "container-1", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/container-1" }));
    const r = await criarContainerDeVideo({ igId: "17841400000000101", token: TOKEN, tipo: "reels", legenda: "Minha legenda #oferta" });
    expect(r).toEqual({ containerId: "container-1" });
    const c = chamada();
    expect(c.metodo).toBe("POST");
    expect(c.url.pathname).toBe("/v26.0/17841400000000101/media");
    expect(c.url.search).toBe("");
    expect(c.corpo).toMatchObject({ media_type: "REELS", upload_type: "resumable", share_to_feed: "true", caption: "Minha legenda #oferta", access_token: TOKEN });
    expect((c.corpo as Record<string, string>).appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Story: media_type STORIES, sem legenda e sem share_to_feed", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "container-2" }));
    await criarContainerDeVideo({ igId: "17841400000000101", token: TOKEN, tipo: "story", legenda: "isso nao vai" });
    const corpo = chamada().corpo as Record<string, string>;
    expect(corpo.media_type).toBe("STORIES");
    expect(corpo.upload_type).toBe("resumable");
    expect(corpo).not.toHaveProperty("caption");
    expect(corpo).not.toHaveProperty("share_to_feed");
  });

  it("Reels com a legenda vazia não manda legenda", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "container-3" }));
    await criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "reels", legenda: "   " });
    expect(chamada().corpo).not.toHaveProperty("caption");
  });

  it("a Meta recusa: o erro leva o código e o subcódigo, e a mensagem não leva o acesso nem o endereço", async () => {
    mockFetch.mockResolvedValue(resposta({ error: { message: "Invalid OAuth access token.", code: 190, error_subcode: 463 } }, 400));
    const erro = await criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "reels", legenda: "" }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroMetaLogin);
    expect((erro as ErroMetaLogin).codigo).toBe(190);
    expect((erro as ErroMetaLogin).subcodigo).toBe(463);
    expect(String((erro as Error).message)).not.toContain(TOKEN);
  });

  it("sem rede: a mensagem não carrega o endereço (ele leva o acesso)", async () => {
    mockFetch.mockRejectedValue(new TypeError(`fetch failed https://graph.facebook.com/x?access_token=${TOKEN}`));
    const erro = await criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "reels", legenda: "" }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroMetaLogin);
    expect(String((erro as Error).message)).not.toContain(TOKEN);
    expect((erro as ErroMetaLogin).codigo).toBeUndefined();
  });

  it("a Meta não devolve o contêiner: erro", async () => {
    mockFetch.mockResolvedValue(resposta({}));
    await expect(criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "reels", legenda: "" })).rejects.toBeInstanceOf(ErroMetaLogin);
  });
});

describe("enviarVideo", () => {
  it("POST em rupload com Authorization OAuth, offset 0, file_size e Content-Length do tamanho real; o acesso nunca vai no endereço", async () => {
    mockFetch.mockResolvedValue(resposta({ success: true, message: "Upload successful." }));
    await enviarVideo({ containerId: "container-1", token: TOKEN, tamanho: 4, corpo: new Uint8Array([1, 2, 3, 4]) });
    const c = chamada();
    expect(c.metodo).toBe("POST");
    expect(c.url.host).toBe("rupload.facebook.com");
    expect(c.url.pathname).toBe("/ig-api-upload/v26.0/container-1");
    expect(c.url.search).toBe("");
    expect(c.cabecalhos).toMatchObject({ authorization: `OAuth ${TOKEN}`, offset: "0", file_size: "4", "content-length": "4" });
  });

  it("um fluxo vai como está, avisando que o pedido sai antes da resposta (duplex)", async () => {
    mockFetch.mockResolvedValue(resposta({ success: true }));
    const fluxo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([9, 9]));
        c.close();
      },
    });
    await enviarVideo({ containerId: "c", token: TOKEN, tamanho: 2, corpo: fluxo });
    const init = mockFetch.mock.calls[0][1] as RequestInit & { duplex?: string };
    expect(init.duplex).toBe("half");
    expect(init.body).toBe(fluxo);
  });

  it("a Meta recusa o envio: ErroDeEnvioDoVideo com o retriable dela e o código que veio dentro do debug_info", async () => {
    mockFetch.mockResolvedValue(
      resposta({ debug_info: { retriable: false, type: "ProcessingFailedError", message: '{"success":false,"error":{"message":"unauthorized user request","code":190}}' } }, 400),
    );
    const erro = await enviarVideo({ containerId: "c", token: TOKEN, tamanho: 1, corpo: new Uint8Array([1]) }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeEnvioDoVideo);
    expect((erro as ErroDeEnvioDoVideo).tentarDeNovo).toBe(false);
    expect((erro as ErroDeEnvioDoVideo).codigo).toBe(190);
    expect(String((erro as Error).message)).not.toContain(TOKEN);
  });

  it("resposta sem success:true mesmo com 200 é falha", async () => {
    mockFetch.mockResolvedValue(resposta({ message: "algo" }));
    await expect(enviarVideo({ containerId: "c", token: TOKEN, tamanho: 1, corpo: new Uint8Array([1]) })).rejects.toBeInstanceOf(ErroDeEnvioDoVideo);
  });

  it("envio interrompido (rede): tentar de novo, e a mensagem não carrega a causa", async () => {
    mockFetch.mockRejectedValue(new TypeError(`terminated ${TOKEN}`));
    const erro = await enviarVideo({ containerId: "c", token: TOKEN, tamanho: 1, corpo: new Uint8Array([1]) }).catch((e: unknown) => e);
    expect((erro as ErroDeEnvioDoVideo).tentarDeNovo).toBe(true);
    expect(String((erro as Error).message)).not.toContain(TOKEN);
  });
});

describe("statusDoContainer", () => {
  it("lê status_code do contêiner", async () => {
    for (const status of ["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"]) {
      mockFetch.mockResolvedValueOnce(resposta({ status_code: status, id: "c" }));
      expect(await statusDoContainer("c", TOKEN)).toBe(status);
    }
    const c = chamada();
    expect(c.metodo).toBe("GET");
    expect(c.url.pathname).toBe("/v26.0/c");
    expect(c.url.searchParams.get("fields")).toBe("status_code");
  });

  it("um estado que a documentação não lista é erro, não um palpite", async () => {
    mockFetch.mockResolvedValue(resposta({ status_code: "TALVEZ" }));
    await expect(statusDoContainer("c", TOKEN)).rejects.toBeInstanceOf(ErroMetaLogin);
  });
});

describe("publicarContainer, enderecoDaMidia e usoDoLimite", () => {
  it("media_publish leva creation_id no corpo e devolve o id da mídia", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "midia-9" }));
    expect(await publicarContainer({ igId: "17841400000000101", containerId: "container-1", token: TOKEN })).toEqual({ midiaId: "midia-9" });
    const c = chamada();
    expect(c.metodo).toBe("POST");
    expect(c.url.pathname).toBe("/v26.0/17841400000000101/media_publish");
    expect(c.corpo).toMatchObject({ creation_id: "container-1", access_token: TOKEN });
  });

  it("o endereço da mídia: o permalink https; nada ou erro viram null, sem lançar", async () => {
    mockFetch.mockResolvedValueOnce(resposta({ permalink: "https://www.instagram.com/reel/ABC123/" }));
    expect(await enderecoDaMidia("midia-9", TOKEN)).toBe("https://www.instagram.com/reel/ABC123/");
    mockFetch.mockResolvedValueOnce(resposta({ permalink: "http://inseguro.exemplo/" }));
    expect(await enderecoDaMidia("midia-9", TOKEN)).toBeNull();
    mockFetch.mockResolvedValueOnce(resposta({ error: { message: "x", code: 100 } }, 400));
    expect(await enderecoDaMidia("midia-9", TOKEN)).toBeNull();
  });

  it("o uso do dia: quota_usage e quota_total de content_publishing_limit", async () => {
    mockFetch.mockResolvedValue(resposta({ data: [{ quota_usage: 3, config: { quota_total: 50, quota_duration: 86400 } }] }));
    expect(await usoDoLimite("17841400000000101", TOKEN)).toEqual({ usadas: 3, total: 50 });
    const c = chamada();
    expect(c.url.pathname).toBe("/v26.0/17841400000000101/content_publishing_limit");
    expect(c.url.searchParams.get("fields")).toBe("quota_usage,config");
  });

  it("sem o total na resposta, o total é nulo (quem chama usa o padrão)", async () => {
    mockFetch.mockResolvedValue(resposta({ data: [{ quota_usage: 1 }] }));
    expect(await usoDoLimite("1", TOKEN)).toEqual({ usadas: 1, total: null });
  });
});

describe("E19b: a via do Instagram (graph.instagram.com, sem envio retomável)", () => {
  it("Reels: o contêiner nasce com o video_url, no graph.instagram.com, sem upload_type e sem a prova do segredo", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "container-ig-1" }));
    const r = await criarContainerDeVideo({ igId: "17841400000000101", token: TOKEN, tipo: "reels", legenda: "Minha legenda", via: "instagram", videoUrl: "https://klaki.exemplo.teste/api/publicar-arquivo/1.2.x/video.mp4" });
    expect(r).toEqual({ containerId: "container-ig-1" });
    const c = chamada();
    expect(c.url.host).toBe("graph.instagram.com");
    expect(c.url.pathname).toBe("/v26.0/17841400000000101/media");
    expect(c.url.search).toBe("");
    expect(c.corpo).toMatchObject({ media_type: "REELS", video_url: "https://klaki.exemplo.teste/api/publicar-arquivo/1.2.x/video.mp4", share_to_feed: "true", caption: "Minha legenda", access_token: TOKEN });
    expect(c.corpo).not.toHaveProperty("upload_type");
    expect(c.corpo).not.toHaveProperty("appsecret_proof");
  });

  it("Story: STORIES com o video_url e sem legenda; sem video_url recusa antes de falar com a Meta", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "container-ig-2" }));
    await criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "story", legenda: "nao vai", via: "instagram", videoUrl: "https://x.teste/v.mp4" });
    const corpo = chamada().corpo as Record<string, string>;
    expect(corpo.media_type).toBe("STORIES");
    expect(corpo).not.toHaveProperty("caption");
    mockFetch.mockClear();
    await expect(criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "reels", legenda: "", via: "instagram" })).rejects.toThrow("Faltou o endereco do video");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("status do contêiner, publicar, endereço da mídia e limite do dia: tudo no graph.instagram.com", async () => {
    mockFetch.mockResolvedValueOnce(resposta({ status_code: "FINISHED", id: "c" }));
    expect(await statusDoContainer("container-ig-1", TOKEN, "instagram")).toBe("FINISHED");
    expect(chamada(0).url.host).toBe("graph.instagram.com");
    expect(chamada(0).url.searchParams.has("appsecret_proof")).toBe(false);

    mockFetch.mockResolvedValueOnce(resposta({ id: "midia-1" }));
    expect(await publicarContainer({ igId: "9", containerId: "container-ig-1", token: TOKEN, via: "instagram" })).toEqual({ midiaId: "midia-1" });
    expect(chamada(1).url.host).toBe("graph.instagram.com");
    expect(chamada(1).url.pathname).toBe("/v26.0/9/media_publish");
    expect(chamada(1).corpo).toMatchObject({ creation_id: "container-ig-1" });

    mockFetch.mockResolvedValueOnce(resposta({ permalink: "https://www.instagram.com/reel/ABC/" }));
    expect(await enderecoDaMidia("midia-1", TOKEN, "instagram")).toBe("https://www.instagram.com/reel/ABC/");
    expect(chamada(2).url.host).toBe("graph.instagram.com");

    mockFetch.mockResolvedValueOnce(resposta({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] }));
    expect(await usoDoLimite("9", TOKEN, "instagram")).toEqual({ usadas: 3, total: 100 });
    expect(chamada(3).url.host).toBe("graph.instagram.com");
    expect(chamada(3).url.pathname).toBe("/v26.0/9/content_publishing_limit");
  });

  it("a via do Facebook segue igual: graph.facebook.com e envio retomável", async () => {
    mockFetch.mockResolvedValue(resposta({ id: "c" }));
    await criarContainerDeVideo({ igId: "1", token: TOKEN, tipo: "reels", legenda: "" });
    expect(chamada().url.host).toBe("graph.facebook.com");
    expect((chamada().corpo as Record<string, string>).upload_type).toBe("resumable");
  });
});
