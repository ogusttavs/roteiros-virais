/**
 * A decisão de qual capa a tela usa e o download da capa (hotfix de 22/10/2026). O fetch é sempre simulado: nenhum teste baixa nada de um CDN de verdade.
 */
import { describe, expect, it, vi } from "vitest";

import {
  baixarCapa,
  escolherCapa,
  statusDeLinkVencido,
  TETO_DA_CAPA_BYTES,
  tipoDeImagemAceito,
  urlDaCapaGuardada,
  urlDeCapaBaixavel,
} from "./capas";

const LINK = "https://scontent-gru2-1.cdninstagram.com/v/t51/capa.jpg?oe=abc&sig=123";

function imagem(tamanho: number, tipo = "image/jpeg", status = 200): Response {
  return new Response(new Uint8Array(tamanho).fill(7), { status, headers: { "content-type": tipo } });
}

describe("escolherCapa", () => {
  it("guardada: a rota da capa do nosso lado, nunca o link do CDN", () => {
    expect(escolherCapa({ videoId: 112308, capaUrl: LINK, situacao: "guardada" })).toBe("/api/capa/112308");
    expect(urlDaCapaGuardada(5)).toBe("/api/capa/5");
  });

  it("vencida: nenhuma capa (a tela troca por embed ou quadro neutro, nunca por imagem quebrada)", () => {
    expect(escolherCapa({ videoId: 1, capaUrl: LINK, situacao: "vencida" })).toBeNull();
  });

  it("ainda sem linha, tentando ou grande: o link da plataforma como veio", () => {
    expect(escolherCapa({ videoId: 1, capaUrl: LINK, situacao: null })).toBe(LINK);
    expect(escolherCapa({ videoId: 1, capaUrl: LINK, situacao: "tentando" })).toBe(LINK);
    expect(escolherCapa({ videoId: 1, capaUrl: LINK, situacao: "grande" })).toBe(LINK);
  });

  it("sem link e sem linha: nenhuma capa; a miniatura do YouTube nunca passa pela guarda", () => {
    expect(escolherCapa({ videoId: 1, capaUrl: null, situacao: null })).toBeNull();
    expect(escolherCapa({ videoId: 1, capaUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg", situacao: null })).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
  });
});

describe("urlDeCapaBaixavel", () => {
  it("só https dos CDNs da Meta e do TikTok", () => {
    expect(urlDeCapaBaixavel(LINK)).toBe(true);
    expect(urlDeCapaBaixavel("https://scontent.xx.fbcdn.net/v/t.jpg")).toBe(true);
    expect(urlDeCapaBaixavel("https://p16-sign.tiktokcdn.com/obj/x.jpeg")).toBe(true);
  });

  it("recusa http, domínio parecido, endereço interno, YouTube e lixo", () => {
    expect(urlDeCapaBaixavel("http://scontent.cdninstagram.com/x.jpg")).toBe(false);
    expect(urlDeCapaBaixavel("https://cdninstagram.com.malvado.example/x.jpg")).toBe(false);
    expect(urlDeCapaBaixavel("https://malvadocdninstagram.com/x.jpg")).toBe(false);
    expect(urlDeCapaBaixavel("https://127.0.0.1/x.jpg")).toBe(false);
    expect(urlDeCapaBaixavel("https://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe(false);
    expect(urlDeCapaBaixavel("nao e um endereco")).toBe(false);
    expect(urlDeCapaBaixavel(null)).toBe(false);
  });
});

describe("statusDeLinkVencido e tipoDeImagemAceito", () => {
  it("403, 404 e 410 são link vencido; 429 e 5xx são passageiros", () => {
    for (const s of [400, 401, 403, 404, 410]) expect(statusDeLinkVencido(s)).toBe(true);
    for (const s of [429, 500, 502, 503]) expect(statusDeLinkVencido(s)).toBe(false);
  });

  it("aceita jpeg, png e webp (com parâmetros e caixa alta); o resto não", () => {
    expect(tipoDeImagemAceito("image/jpeg")).toBe("image/jpeg");
    expect(tipoDeImagemAceito("IMAGE/PNG; charset=binary")).toBe("image/png");
    expect(tipoDeImagemAceito("image/webp")).toBe("image/webp");
    expect(tipoDeImagemAceito("text/html")).toBeNull();
    expect(tipoDeImagemAceito("image/svg+xml")).toBeNull();
    expect(tipoDeImagemAceito(null)).toBeNull();
  });
});

describe("baixarCapa", () => {
  it("guarda os bytes como vieram, com o tipo", async () => {
    const buscar = vi.fn().mockResolvedValue(imagem(2048));
    const r = await baixarCapa(LINK, buscar);
    expect(r.tipo).toBe("guardada");
    if (r.tipo === "guardada") {
      expect(r.contentType).toBe("image/jpeg");
      expect(r.bytes.length).toBe(2048);
    }
    expect(buscar).toHaveBeenCalledWith(LINK, expect.objectContaining({ redirect: "manual" }));
  });

  it("no teto exato guarda; um byte acima vira grande (nunca guarda, nunca dá por vencida)", async () => {
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(imagem(TETO_DA_CAPA_BYTES)))).tipo).toBe("guardada");
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(imagem(TETO_DA_CAPA_BYTES + 1)))).tipo).toBe("grande");
  });

  it("o teto vale mesmo quando o servidor não diz o tamanho (lê o corpo e para)", async () => {
    const corpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(200 * 1024));
        c.enqueue(new Uint8Array(200 * 1024));
        c.close();
      },
    });
    const sem = new Response(corpo, { status: 200, headers: { "content-type": "image/jpeg" } });
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(sem))).tipo).toBe("grande");
  });

  it("o tamanho declarado acima do teto recusa sem ler o corpo", async () => {
    const r = new Response(new Uint8Array(10), { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(TETO_DA_CAPA_BYTES + 5000) } });
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(r))).tipo).toBe("grande");
  });

  it("403 do CDN (o caso do vídeo 112308) é link vencido", async () => {
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(new Response("", { status: 403 })))).tipo).toBe("vencida");
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(new Response("", { status: 404 })))).tipo).toBe("vencida");
  });

  it("5xx, limite de pedidos, redirecionamento e rede caída são passageiros", async () => {
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(new Response("", { status: 503 })))).tipo).toBe("passageiro");
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(new Response("", { status: 429 })))).tipo).toBe("passageiro");
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(new Response("", { status: 302, headers: { location: "https://x.example/y.jpg" } })))).tipo).toBe("passageiro");
    expect((await baixarCapa(LINK, vi.fn().mockRejectedValue(new Error("ECONNRESET")))).tipo).toBe("passageiro");
  });

  it("200 com HTML de erro, ou corpo vazio, é link vencido", async () => {
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(new Response("<html>erro</html>", { status: 200, headers: { "content-type": "text/html" } })))).tipo).toBe("vencida");
    expect((await baixarCapa(LINK, vi.fn().mockResolvedValue(imagem(0)))).tipo).toBe("vencida");
  });

  it("endereço fora dos CDNs nunca é buscado", async () => {
    const buscar = vi.fn();
    expect((await baixarCapa("https://interno.exemplo/x.jpg", buscar)).tipo).toBe("vencida");
    expect(buscar).not.toHaveBeenCalled();
  });
});
