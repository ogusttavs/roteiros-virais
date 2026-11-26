/**
 * M4 da auditoria de segurança de 26/11/2026: o Chromium do carrossel não busca nada fora do próprio HTML. Contra o Chromium de verdade e sem banco: um slide com imagem apontando para o
 * endereço de metadados da nuvem (169.254.169.254), para `file:///etc/passwd`, para o banco pelo nome, para um servidor local que conta as visitas e para um arquivo que existe no disco não
 * busca nada; a imagem embutida (`data:`) carrega; o `<script>` que entrasse no HTML não roda; e nenhum nome de servidor resolve. A folha do roteiro (o PDF e a imagem) só busca do próprio
 * painel: a mesma imagem para 169.254.169.254, para `file:///etc/passwd` e para outro servidor não sai, um pulo (302) do painel para outro servidor também não, e o CSS e a imagem do painel
 * carregam.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { abrirChromiumDaFolha, abrirChromiumSemRede, argumentosDaFolha, paginaSemRede, paginaSoDaOrigem, pedidoDaMesmaOrigem, pedidoDoProprioHtml } from "@/lib/chromium-sem-rede";

/** Um PNG de 1 por 1, válido. */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** O que o slide de mentira injeta: o que um escape esquecido deixaria entrar. `vi.hoisted` porque o mock do modelo lê isto. */
const injetado = vi.hoisted(() => ({ html: "" }));

vi.mock("@/carrossel/modelos", async (original) => {
  const real = await original<typeof import("@/carrossel/modelos")>();
  return { ...real, htmlDoSlide: (d: Parameters<typeof real.htmlDoSlide>[0]) => real.htmlDoSlide(d).replace("</body>", `${injetado.html}</body>`) };
});

let servidor: Server;
let base = "";
let visitas: string[] = [];
let pasta = "";
let arquivoNoDisco = "";

beforeAll(async () => {
  servidor = createServer((pedido, resposta) => {
    visitas.push(pedido.url ?? "");
    resposta.writeHead(200, { "content-type": pedido.url?.endsWith(".css") ? "text/css" : "image/png" });
    resposta.end(pedido.url?.endsWith(".css") ? "body{background:url(/de-dentro-do-css.png)}" : Buffer.from(PNG_1X1, "base64"));
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", () => pronto()));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  pasta = mkdtempSync(path.join(tmpdir(), "carrossel-rede-"));
  arquivoNoDisco = path.join(pasta, "segredo.png");
  writeFileSync(arquivoNoDisco, Buffer.from(PNG_1X1, "base64"));
});

afterAll(async () => {
  await new Promise<void>((fechou) => servidor.close(() => fechou()));
  rmSync(pasta, { recursive: true, force: true });
});

/** Tudo que um escape esquecido poderia pôr no slide para buscar algo de fora. */
function htmlQueTentaBuscar(): string {
  return [
    `<img id="metadados" src="http://169.254.169.254/latest/meta-data/iam/security-credentials/">`,
    `<img id="senhas" src="file:///etc/passwd">`,
    `<img id="banco" src="http://roteiros-postgres:5432/">`,
    `<img id="local" src="${base}/foto.png">`,
    `<img id="disco" src="${pathToFileURL(arquivoNoDisco).href}">`,
    `<img id="embutida" src="data:image/png;base64,${PNG_1X1}">`,
    `<link rel="stylesheet" href="${base}/estilo.css">`,
    `<div style="width:4px;height:4px;background:url(${base}/fundo.png)"></div>`,
    `<iframe src="${base}/quadro"></iframe>`,
    `<script>document.title = "rodou"; fetch("${base}/do-script");</script>`,
  ].join("");
}

async function larguras(pagina: Page): Promise<Record<string, number>> {
  return (await pagina.evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('img[id]')).map((i) => [i.id, i.naturalWidth]))`)) as Record<string, number>;
}

describe("o Chromium do carrossel não busca nada fora do próprio HTML (M4)", () => {
  it("só passa o que vem embutido no HTML (data:)", () => {
    expect(pedidoDoProprioHtml(`data:image/png;base64,${PNG_1X1}`)).toBe(true);
    expect(pedidoDoProprioHtml("DATA:font/woff2;base64,AAAA")).toBe(true);
    for (const fora of [
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "http://roteiros-postgres:5432/",
      "http://127.0.0.1:3000/api/carrossel/1/zip",
      "https://exemplo.com/foto.png",
      "blob:http://127.0.0.1/abc",
      "about:blank#data:",
    ])
      expect(pedidoDoProprioHtml(fora), fora).toBe(false);
  });

  it("um slide de verdade com imagem para 169.254.169.254 e file:///etc/passwd não busca nada, e o slide sai", async () => {
    const { renderizarSlides } = await import("@/carrossel/render");
    visitas = [];
    injetado.html = htmlQueTentaBuscar();
    try {
      const r = await renderizarSlides({ slides: [{ tipo: "chamada", titulo: "Quer saber mais?", texto: "Traga a sua dúvida", acoes: ["Salve", "Mande"] }], fotos: [], cor: "#0e5a6a", escala: 0.3 });
      expect(r.png).toHaveLength(1);
      expect(r.png[0].subarray(1, 4).toString("ascii")).toBe("PNG");
    } finally {
      injetado.html = "";
    }
    expect(visitas).toEqual([]);
  }, 60_000);

  describe("a página sem rede", () => {
    let navegador: Browser;
    beforeAll(async () => {
      navegador = await abrirChromiumSemRede();
    });
    afterAll(async () => {
      await navegador.close();
    });

    it("barra http, file e endereço interno, deixa o data: e não roda o script da página", async () => {
      visitas = [];
      const pagina = await paginaSemRede(navegador, { viewport: { width: 200, height: 200 } });
      const terminados: string[] = [];
      pagina.on("requestfinished", (p) => terminados.push(p.url()));
      await pagina.setContent(`<!doctype html><html><head><title>slide</title></head><body>${htmlQueTentaBuscar()}</body></html>`, { waitUntil: "load" });
      await pagina.evaluate("document.fonts.ready.then(() => true)");
      expect(visitas).toEqual([]);
      expect(terminados.filter((u) => !u.startsWith("data:"))).toEqual([]);
      expect(await larguras(pagina)).toEqual({ metadados: 0, senhas: 0, banco: 0, local: 0, disco: 0, embutida: 1 });
      expect(await pagina.title()).toBe("slide");
      await pagina.context().close();
    }, 30_000);

    it("a rota sozinha já barra, num navegador comum (sem o argumento que impede resolver nome)", async () => {
      visitas = [];
      const comum = await chromium.launch();
      try {
        const pagina = await paginaSemRede(comum);
        await pagina.setContent(`<!doctype html><html><body>${htmlQueTentaBuscar()}</body></html>`, { waitUntil: "load" });
        expect(visitas).toEqual([]);
        expect(await larguras(pagina)).toEqual({ metadados: 0, senhas: 0, banco: 0, local: 0, disco: 0, embutida: 1 });
      } finally {
        await comum.close();
      }
    }, 30_000);

    it("o código do próprio render ainda roda com o JavaScript da página desligado (a redução da ilustração)", async () => {
      const { reduzirIlustracao } = await import("@/carrossel/reduzir-ilustracao");
      const jpeg = await reduzirIlustracao(Buffer.from(PNG_1X1, "base64"), "image/png");
      expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
    }, 30_000);

    it("nenhum servidor resolve, nem pelo nome nem escrito em número, mesmo fora da rota", async () => {
      visitas = [];
      const pagina = await navegador.newPage();
      const porta = new URL(base).port;
      await expect(pagina.goto(`http://localhost:${porta}/pelo-nome`)).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
      await expect(pagina.goto(`${base}/pelo-numero`)).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
      await expect(pagina.goto("http://169.254.169.254/latest/meta-data/", { timeout: 10_000 })).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
      expect(visitas).toEqual([]);
      await pagina.close();
    }, 30_000);
  });
});

describe("a folha do roteiro (PDF e imagem) só busca do próprio painel (M4)", () => {
  let painel: Server;
  let origemDoPainel = "";
  let doPainel: string[] = [];

  beforeAll(async () => {
    painel = createServer((pedido, resposta) => {
      doPainel.push(pedido.url ?? "");
      if (pedido.url === "/pula") {
        // Um 302 do próprio painel para outro servidor: a rota só vê o primeiro endereço, quem segura o destino é o resolvedor.
        resposta.writeHead(302, { location: `http://localhost:${new URL(base).port}/depois-do-pulo` });
        resposta.end();
        return;
      }
      if (pedido.url?.startsWith("/folha")) {
        resposta.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        resposta.end(
          `<!doctype html><html><head><title>folha</title><link rel="stylesheet" href="/estilo-do-painel.css"></head><body>` +
            `<img id="painel" src="/logo.png"><img id="pulo" src="/pula">${htmlQueTentaBuscar()}</body></html>`,
        );
        return;
      }
      resposta.writeHead(200, { "content-type": pedido.url?.endsWith(".css") ? "text/css" : "image/png" });
      resposta.end(pedido.url?.endsWith(".css") ? "body{margin:0}" : Buffer.from(PNG_1X1, "base64"));
    });
    await new Promise<void>((pronto) => painel.listen(0, "127.0.0.1", () => pronto()));
    origemDoPainel = `http://127.0.0.1:${(painel.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((fechou) => painel.close(() => fechou()));
  });

  it("passa a mesma origem e o data:, e mais nada", () => {
    const origem = "http://127.0.0.1:3000";
    expect(pedidoDaMesmaOrigem("http://127.0.0.1:3000/_next/static/css/a.css", origem)).toBe(true);
    expect(pedidoDaMesmaOrigem(`data:image/png;base64,${PNG_1X1}`, origem)).toBe(true);
    for (const fora of [
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "http://roteiros-postgres:5432/",
      "http://127.0.0.1:5432/",
      "https://127.0.0.1:3000/",
      "http://localhost:3000/",
      "http://127.0.0.1:3000@169.254.169.254/",
      "https://exemplo.com/foto.png",
      "nao e endereco",
    ])
      expect(pedidoDaMesmaOrigem(fora, origem), fora).toBe(false);
    // `file:` tem origem "null": nem uma folha aberta de arquivo deixaria outro arquivo passar.
    expect(pedidoDaMesmaOrigem("file:///etc/passwd", "null")).toBe(false);
  });

  it("só o servidor da folha resolve, e um servidor estranho no endereço não vira argumento", () => {
    expect(argumentosDaFolha("http://127.0.0.1:3000/roteiros/1/imprimir?token=t")).toEqual(["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]);
    expect(() => argumentosDaFolha("http://[::1]:3000/")).toThrow();
  });

  it("a folha com imagem para 169.254.169.254, file:///etc/passwd, outro servidor e um pulo para fora não busca nada de fora, e o que é do painel carrega", async () => {
    visitas = [];
    doPainel = [];
    const endereco = `${origemDoPainel}/folha?token=t`;
    const navegador = await abrirChromiumDaFolha(endereco);
    try {
      const pagina = await paginaSoDaOrigem(navegador, endereco, { viewport: { width: 200, height: 200 } });
      const resposta = await pagina.goto(endereco, { waitUntil: "networkidle" });
      expect(resposta?.ok()).toBe(true);
      // O JavaScript fica ligado na folha (é a página do painel): o script injetado roda, mas o `fetch` dele para outro servidor é barrado.
      expect(await pagina.title()).toBe("rodou");
      expect(visitas).toEqual([]);
      expect(doPainel).toEqual(expect.arrayContaining(["/folha?token=t", "/estilo-do-painel.css", "/logo.png", "/pula"]));
      expect(await larguras(pagina)).toEqual({ painel: 1, pulo: 0, metadados: 0, senhas: 0, banco: 0, local: 0, disco: 0, embutida: 1 });
      // Fora da rota (uma página sem ela), o endereço escrito em número também não resolve; na CI do GitHub 169.254.169.254 responde de verdade.
      const semRota = await navegador.newPage();
      await expect(semRota.goto("http://169.254.169.254/latest/meta-data/", { timeout: 10_000 })).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    } finally {
      await navegador.close();
    }
  }, 30_000);
});
