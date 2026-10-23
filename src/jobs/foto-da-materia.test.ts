import { describe, expect, it } from "vitest";

import {
  assinaturaDaPaginaDoGoogle,
  baixarFotoDaMateria,
  corpoDoPedidoDeResolucao,
  enderecoDaRespostaDeResolucao,
  fotoDaMateria,
  fotoDaPagina,
  hostDeVeiculoPermitido,
  idDoArtigoDoGoogleNews,
  LIMITE_BYTES_DA_FOTO,
  resolverLinkDoGoogleNews,
  tipoDaFoto,
} from "./foto-da-materia";
import type { BuscarLeitor } from "./site-api";

const PAGINA = "https://g1.globo.com/economia/noticia/2026/10/21/a.ghtml";

function jpeg(tamanho: number): Uint8Array {
  const bytes = new Uint8Array(tamanho);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

function resposta(corpo: Uint8Array | string, status = 200, cabecalhos: Record<string, string> = {}) {
  const bytes = typeof corpo === "string" ? new TextEncoder().encode(corpo) : corpo;
  return {
    status,
    headers: new Headers(cabecalhos),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  } as unknown as Awaited<ReturnType<BuscarLeitor>>;
}

describe("fotoDaPagina (escolha da imagem da página)", () => {
  it("prefere og:image:secure_url, depois og:image, depois twitter:image", () => {
    const html = `<meta name="twitter:image" content="https://x.com/tw.jpg"><meta property="og:image" content="https://x.com/og.jpg"><meta property="og:image:secure_url" content="https://x.com/seguro.jpg">`;
    expect(fotoDaPagina(html, PAGINA)).toBe("https://x.com/seguro.jpg");
    expect(fotoDaPagina(`<meta name="twitter:image" content="https://x.com/tw.jpg"><meta property="og:image" content="https://x.com/og.jpg">`, PAGINA)).toBe("https://x.com/og.jpg");
    expect(fotoDaPagina(`<meta name="twitter:image" content="https://x.com/tw.jpg">`, PAGINA)).toBe("https://x.com/tw.jpg");
  });

  it("aceita o atributo content antes do property, aspas simples, entidades, e resolve o endereço relativo", () => {
    expect(fotoDaPagina(`<meta content='https://x.com/a.jpg?a=1&amp;b=2' property='og:image'>`, PAGINA)).toBe("https://x.com/a.jpg?a=1&b=2");
    expect(fotoDaPagina(`<meta property="og:image" content="/img/capa.jpg">`, PAGINA)).toBe("https://g1.globo.com/img/capa.jpg");
  });

  it("sobe http para https e recusa data:, SVG, IP direto e página sem foto", () => {
    expect(fotoDaPagina(`<meta property="og:image" content="http://x.com/a.jpg">`, PAGINA)).toBe("https://x.com/a.jpg");
    expect(fotoDaPagina(`<meta property="og:image" content="data:image/png;base64,AAAA">`, PAGINA)).toBeNull();
    expect(fotoDaPagina(`<meta property="og:image" content="https://x.com/logo.svg">`, PAGINA)).toBeNull();
    expect(fotoDaPagina(`<meta property="og:image" content="https://10.0.0.5/a.jpg">`, PAGINA)).toBeNull();
    expect(fotoDaPagina(`<html><head><title>x</title></head></html>`, PAGINA)).toBeNull();
  });

  it("cai no image_src antigo quando não há metatag", () => {
    expect(fotoDaPagina(`<link rel="image_src" href="https://x.com/antiga.jpg">`, PAGINA)).toBe("https://x.com/antiga.jpg");
  });
});

describe("tipoDaFoto (pelos bytes, nunca pelo cabeçalho)", () => {
  it("reconhece JPEG, PNG e WebP; recusa SVG, HTML e GIF", () => {
    expect(tipoDaFoto(jpeg(10))).toBe("image/jpeg");
    expect(tipoDaFoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(tipoDaFoto(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(tipoDaFoto(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(tipoDaFoto(new TextEncoder().encode("<html>"))).toBeNull();
    expect(tipoDaFoto(new TextEncoder().encode("GIF89a......"))).toBeNull();
  });
});

describe("baixarFotoDaMateria (teto de tamanho)", () => {
  const baixar = (bytes: Uint8Array, cabecalhos: Record<string, string> = { "content-type": "image/jpeg" }) =>
    baixarFotoDaMateria("https://img.exemplo-jornal.com.br/a.jpg", { buscar: async () => resposta(bytes, 200, cabecalhos) });

  it("guarda a foto dentro do teto, com o tipo certo", async () => {
    const r = await baixar(jpeg(50_000));
    expect(r?.tipo).toBe("image/jpeg");
    expect(r?.bytes.length).toBe(50_000);
  });

  it("descarta (não corta) a foto acima do teto de 1,5 MB", async () => {
    expect(await baixar(jpeg(LIMITE_BYTES_DA_FOTO + 10))).toBeNull();
    expect((await baixar(jpeg(LIMITE_BYTES_DA_FOTO)))?.bytes.length).toBe(LIMITE_BYTES_DA_FOTO);
  });

  it("descarta o que é pequeno demais (pixel de rastreio) e o que não é imagem, mesmo com cabeçalho de imagem", async () => {
    expect(await baixar(jpeg(500))).toBeNull();
    expect(await baixar(new TextEncoder().encode("<svg>".padEnd(20_000, " ")), { "content-type": "image/jpeg" })).toBeNull();
  });

  it("falha de rede ou resposta 404 vira nulo, sem lançar", async () => {
    expect(await baixarFotoDaMateria("https://img.exemplo-jornal.com.br/a.jpg", { buscar: async () => resposta("nao", 404) })).toBeNull();
    expect(await baixarFotoDaMateria("https://img.exemplo-jornal.com.br/a.jpg", { buscar: async () => Promise.reject(new Error("rede")) })).toBeNull();
  });

  it("recusa endereço de rede interna ou IP direto antes de conectar", async () => {
    let chamadas = 0;
    const buscar: BuscarLeitor = async () => {
      chamadas += 1;
      return resposta(jpeg(10_000));
    };
    expect(await baixarFotoDaMateria("https://10.0.0.5/a.jpg", { buscar })).toBeNull();
    expect(await baixarFotoDaMateria("https://roteiros-postgres/a.jpg", { buscar })).toBeNull();
    expect(await baixarFotoDaMateria("http://exemplo.com/a.jpg", { buscar })).toBeNull();
    expect(chamadas).toBe(0);
  });
});

describe("o link do Google News", () => {
  it("acha o id do artigo e ignora outro host", () => {
    expect(idDoArtigoDoGoogleNews("https://news.google.com/rss/articles/CBMiAbC_-d?oc=5")).toBe("CBMiAbC_-d");
    expect(idDoArtigoDoGoogleNews("https://news.google.com/articles/CBMiAbC")).toBe("CBMiAbC");
    expect(idDoArtigoDoGoogleNews("https://g1.globo.com/a")).toBeNull();
  });

  it("lê a assinatura da página e a resposta do batchexecute", () => {
    expect(assinaturaDaPaginaDoGoogle(`<c-wiz data-n-a-id="ID1" data-n-a-ts="1792709636" data-n-a-sg="AbC_d">`)).toEqual({ id: "ID1", ts: "1792709636", sg: "AbC_d" });
    expect(assinaturaDaPaginaDoGoogle("<html></html>")).toBeNull();
    expect(decodeURIComponent(corpoDoPedidoDeResolucao({ id: "ID1", ts: "1", sg: "S" }))).toContain('garturlreq');
    const inner = JSON.stringify(["garturlres", "https://g1.globo.com/a.ghtml", 1]);
    const texto = `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", inner, null, null, null, "generic"], ["di", 8]])}`;
    expect(enderecoDaRespostaDeResolucao(texto)).toBe("https://g1.globo.com/a.ghtml");
    expect(enderecoDaRespostaDeResolucao("lixo")).toBeNull();
  });

  it("resolve até a matéria (página do Google mais POST); link que não é do Google volta como está", async () => {
    const inner = JSON.stringify(["garturlres", "https://g1.globo.com/economia/a.ghtml", 1]);
    const buscar: BuscarLeitor = async (url) => {
      expect(url).toContain("news.google.com/rss/articles/ABC");
      return resposta(`<c-wiz data-n-a-id="ABC" data-n-a-ts="1792709636" data-n-a-sg="SIG">`);
    };
    const postar = async (_url: string, corpo: string) => {
      expect(corpo).toContain("f.req=");
      return `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", inner]])}`;
    };
    expect(await resolverLinkDoGoogleNews("https://news.google.com/rss/articles/ABC?oc=5", { buscar, postar })).toBe("https://g1.globo.com/economia/a.ghtml");
    expect(await resolverLinkDoGoogleNews("https://g1.globo.com/economia/a.ghtml")).toBe("https://g1.globo.com/economia/a.ghtml");
  });

  it("a página do Google sem assinatura, ou uma resposta que aponta para o próprio Google, dão nulo", async () => {
    const semAssinatura: BuscarLeitor = async () => resposta("<html></html>");
    expect(await resolverLinkDoGoogleNews("https://news.google.com/rss/articles/ABC", { buscar: semAssinatura })).toBeNull();
    const buscar: BuscarLeitor = async () => resposta(`<c-wiz data-n-a-id="ABC" data-n-a-ts="1" data-n-a-sg="S">`);
    const postar = async () => `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", "https://news.google.com/articles/X"])]])}`;
    expect(await resolverLinkDoGoogleNews("https://news.google.com/rss/articles/ABC", { buscar, postar })).toBeNull();
  });
});

describe("hostDeVeiculoPermitido", () => {
  it("aceita veículo e recusa rede interna e o próprio Google", () => {
    expect(hostDeVeiculoPermitido("g1.globo.com")).toBe(true);
    expect(hostDeVeiculoPermitido("www.exemplo.com.br")).toBe(true);
    for (const h of ["localhost", "roteiros-postgres", "api.interno.internal", "router.local", "news.google.com", "x.google.com"]) expect(hostDeVeiculoPermitido(h), h).toBe(false);
  });
});

describe("fotoDaMateria (o caminho inteiro, sem rede)", () => {
  it("do link do Google à foto guardada", async () => {
    const inner = JSON.stringify(["garturlres", PAGINA, 1]);
    const buscar: BuscarLeitor = async (url) => {
      if (url.includes("news.google.com")) return resposta(`<c-wiz data-n-a-id="ABC" data-n-a-ts="1" data-n-a-sg="S">`);
      if (url === PAGINA) return resposta(`<head><meta property="og:image" content="https://s2-g1.glbimg.com/foto.jpg"></head>`);
      if (url === "https://s2-g1.glbimg.com/foto.jpg") return resposta(jpeg(20_000));
      throw new Error(`inesperado: ${url}`);
    };
    const postar = async () => `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", inner]])}`;
    const r = await fotoDaMateria("https://news.google.com/rss/articles/ABC?oc=5", { buscar, postar });
    expect(r).toMatchObject({ situacao: "guardada", tipo: "image/jpeg", origem: "https://s2-g1.glbimg.com/foto.jpg" });
  });

  it("página sem foto é definitiva; link que não resolve e página que não abre são passageiros", async () => {
    const semFoto = await fotoDaMateria(PAGINA, { buscar: async () => resposta("<head></head>") });
    expect(semFoto).toMatchObject({ situacao: "sem_foto", motivo: "pagina_sem_foto", passageiro: false });
    const naoAbre = await fotoDaMateria(PAGINA, { buscar: async () => resposta("erro", 503) });
    expect(naoAbre).toMatchObject({ situacao: "sem_foto", motivo: "pagina_nao_abriu", passageiro: true });
    const naoResolve = await fotoDaMateria("https://news.google.com/rss/articles/ABC", { buscar: async () => resposta("<html></html>") });
    expect(naoResolve).toMatchObject({ situacao: "sem_foto", motivo: "nao_resolveu_o_link", passageiro: true });
  });
});
