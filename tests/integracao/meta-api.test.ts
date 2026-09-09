/**
 * Cliente da Graph API da Meta (E6 parte 3, segunda rodada, item 1) contra
 * o Postgres real (o limitador de 200/hora grava em `chamadas_meta_api`) e
 * a rede mockada, com as respostas confirmadas rodando de verdade em
 * 08/09/2026 (`acessos/meta-app.md`): Business Discovery da `natgeo` e
 * Hashtag Search de "limpeza".
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      coleta: { ...original.config.coleta, metaIgId: "17841463597140638", metaToken: "EAAtoken-de-teste" },
    },
  };
});

import { db, getPool } from "@/db";
import { chamadasMetaApi } from "@/db/schema";
import {
  aguardarJanela,
  buscarBusinessDiscovery,
  buscarIdDaHashtag,
  buscarTodasAsPaginas,
  buscarTopMediaDaHashtag,
  chamadasDesde,
  ErroMetaApi,
} from "@/jobs/meta-api";

import { resetarSchema } from "../../scripts/resetar-schema";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(async () => {
  await db().delete(chamadasMetaApi);
});

describe("buscarBusinessDiscovery", () => {
  it("busca o perfil e os posts de uma conta, com os campos confirmados em 08/09/2026", async () => {
    mockFetch.mockImplementation(async (url: URL) => {
      const texto = decodeURIComponent(url.toString());
      expect(texto).toContain("/17841463597140638");
      expect(texto).toContain("business_discovery.username(natgeo)");
      expect(texto).toContain("access_token=EAAtoken-de-teste");
      return respostaJson({
        business_discovery: {
          username: "natgeo",
          followers_count: 268602293,
          media_count: 31995,
          media: {
            data: [
              {
                id: "1",
                media_type: "VIDEO",
                timestamp: "2026-08-20T10:00:00Z",
                view_count: 679098,
                like_count: 12000,
                comments_count: 300,
                permalink: "https://www.instagram.com/p/exemplo1/",
              },
            ],
          },
        },
      });
    });

    const perfil = await buscarBusinessDiscovery("natgeo");
    expect(perfil).toEqual({
      username: "natgeo",
      followers_count: 268602293,
      media_count: 31995,
      media: {
        data: [
          {
            id: "1",
            media_type: "VIDEO",
            timestamp: "2026-08-20T10:00:00Z",
            view_count: 679098,
            like_count: 12000,
            comments_count: 300,
            permalink: "https://www.instagram.com/p/exemplo1/",
          },
        ],
      },
    });
  });

  it("devolve null quando a resposta nao traz business_discovery", async () => {
    mockFetch.mockResolvedValue(respostaJson({}));
    expect(await buscarBusinessDiscovery("conta-sem-business-discovery")).toBeNull();
  });

  it("registra uma chamada em chamadas_meta_api", async () => {
    mockFetch.mockResolvedValue(respostaJson({ business_discovery: { username: "x" } }));
    await buscarBusinessDiscovery("x");
    expect(await chamadasDesde(new Date(0))).toBe(1);
  });
});

describe("erro da Meta (codigo, subcodigo, mensagem)", () => {
  it("lanca ErroMetaApi com codigo e subcodigo quando a resposta traz error", async () => {
    mockFetch.mockResolvedValue(
      respostaJson(
        { error: { message: "Conta pessoal ou privada", type: "GraphMethodException", code: 100, error_subcode: 33 } },
        400,
      ),
    );

    await expect(buscarBusinessDiscovery("conta-pessoal")).rejects.toMatchObject({
      message: "Conta pessoal ou privada",
      codigo: 100,
      subcodigo: 33,
    });
  });

  it("lanca ErroMetaApi mesmo sem corpo de erro, so pelo status HTTP", async () => {
    mockFetch.mockResolvedValue(respostaJson({}, 500));
    await expect(buscarBusinessDiscovery("qualquer")).rejects.toBeInstanceOf(ErroMetaApi);
  });

  /** Achado da leitura previa do Fable, correcao 6: um 5xx com HTML derrubava a funcao com um erro sem codigo. */
  it("corpo que nao e json vira ErroMetaApi com o status http, em vez de derrubar com erro generico", async () => {
    mockFetch.mockResolvedValue(
      new Response("<html>gateway timeout</html>", { status: 504, headers: { "content-type": "text/html" } }),
    );
    await expect(buscarBusinessDiscovery("qualquer")).rejects.toMatchObject({
      codigo: 504,
    });
  });
});

describe("registro de chamada (correcao 5 da leitura previa)", () => {
  it("registra a chamada antes do fetch: mesmo com a rede falhando, ela conta para o limite", async () => {
    mockFetch.mockRejectedValue(new Error("rede fora do ar"));

    await expect(buscarBusinessDiscovery("qualquer")).rejects.toThrow("rede fora do ar");
    expect(await chamadasDesde(new Date(0))).toBe(1);
  });

  it("apaga chamadas com mais de uma hora ao registrar uma nova, sem contar as de fora da janela", async () => {
    await db()
      .insert(chamadasMetaApi)
      .values({ criadoEm: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    expect(await chamadasDesde(new Date(0))).toBe(1);

    mockFetch.mockResolvedValue(respostaJson({ business_discovery: { username: "x" } }));
    await buscarBusinessDiscovery("x");

    expect(await chamadasDesde(new Date(0))).toBe(1); // a antiga saiu, so a nova ficou
  });
});

describe("hashtag search", () => {
  it("busca o id da hashtag e depois o top_media, com os campos confirmados em 08/09/2026", async () => {
    mockFetch.mockImplementation(async (url: URL) => {
      const texto = url.toString();
      if (texto.includes("ig_hashtag_search")) {
        expect(texto).toContain("q=limpeza");
        return respostaJson({ data: [{ id: "17841563347091627" }] });
      }
      if (texto.includes("top_media")) {
        return respostaJson({
          data: [
            {
              id: "1",
              caption: "[exemplo] dica de limpeza",
              media_type: "VIDEO",
              permalink: "https://www.instagram.com/p/exemplo2/",
              timestamp: "2026-08-19T10:00:00Z",
              like_count: 500,
              comments_count: 10,
            },
          ],
        });
      }
      throw new Error(`chamada inesperada nesta fixture: ${texto}`);
    });

    const hashtagId = await buscarIdDaHashtag("limpeza");
    expect(hashtagId).toBe("17841563347091627");

    const topMedia = await buscarTopMediaDaHashtag(hashtagId!);
    expect(topMedia).toEqual([
      {
        id: "1",
        caption: "[exemplo] dica de limpeza",
        media_type: "VIDEO",
        permalink: "https://www.instagram.com/p/exemplo2/",
        timestamp: "2026-08-19T10:00:00Z",
        like_count: 500,
        comments_count: 10,
      },
    ]);
  });

  it("devolve null quando a hashtag nao existe", async () => {
    mockFetch.mockResolvedValue(respostaJson({ data: [] }));
    expect(await buscarIdDaHashtag("hashtag-que-nao-existe")).toBeNull();
  });
});

describe("buscarTodasAsPaginas", () => {
  it("segue paging.cursors.after ate a pagina sem cursor", async () => {
    let chamada = 0;
    mockFetch.mockImplementation(async (url: URL) => {
      chamada += 1;
      if (!url.toString().includes("after=")) {
        return respostaJson({ data: [{ id: "1" }], paging: { cursors: { after: "cursor-2" } } });
      }
      return respostaJson({ data: [{ id: "2" }] });
    });

    const itens = await buscarTodasAsPaginas("algum/caminho", {});
    expect(itens).toEqual([{ id: "1" }, { id: "2" }]);
    expect(chamada).toBe(2);
  });

  it("para em maxPaginas mesmo se a api continuar mandando cursor (nunca um laco sem fim)", async () => {
    mockFetch.mockImplementation(async () =>
      respostaJson({ data: [{ id: "x" }], paging: { cursors: { after: "sempre-mais" } } }),
    );
    const itens = await buscarTodasAsPaginas("algum/caminho", {}, 3);
    expect(itens).toHaveLength(3);
  });
});

describe("aguardarJanela", () => {
  it("sem 200 chamadas na janela, nao espera nada", async () => {
    const esperar = vi.fn(async () => {});
    await aguardarJanela({ limite: 200, esperar });
    expect(esperar).not.toHaveBeenCalled();
  });

  it("com o limite batido, espera ate a mais antiga sair da janela e reconfere (relogio falso, sem esperar de verdade)", async () => {
    const inicio = new Date("2026-09-09T10:00:00Z");
    await db()
      .insert(chamadasMetaApi)
      .values([{ criadoEm: inicio }, { criadoEm: new Date(inicio.getTime() + 1000) }]);

    let relogio = new Date(inicio.getTime() + 5000);
    const esperar = vi.fn(async (ms: number) => {
      relogio = new Date(relogio.getTime() + ms);
    });

    await aguardarJanela({ limite: 2, janelaMs: 10_000, agora: () => relogio, esperar });

    expect(esperar).toHaveBeenCalledTimes(1);
    // A mais antiga (inicio) sai da janela de 10s em inicio+10s; o relogio
    // falso avançou até pelo menos esse ponto.
    expect(relogio.getTime()).toBeGreaterThanOrEqual(inicio.getTime() + 10_000);
  });
});
