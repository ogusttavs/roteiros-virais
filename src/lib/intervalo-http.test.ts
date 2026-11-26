import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lerIntervalo, responderArquivo } from "./intervalo-http";

let pasta: string;
let arquivo: string;
const CONTEUDO = Buffer.from("0123456789abcdefghij");

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "intervalo-http-"));
  arquivo = join(pasta, "v.mp4");
  await writeFile(arquivo, CONTEUDO);
});
afterAll(async () => {
  await rm(pasta, { recursive: true, force: true });
});

const pedir = (range?: string) => responderArquivo(new Request("http://x/final", { headers: range ? { range } : {} }), { caminho: arquivo, tamanho: CONTEUDO.length, tipo: "video/mp4" });

describe("responderArquivo (vídeo que o Safari do iPhone exige tocar com Range)", () => {
  it("sem Range: 200, video/mp4, Accept-Ranges e o arquivo inteiro", async () => {
    const r = pedir();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-length")).toBe("20");
    expect(Buffer.from(await r.arrayBuffer()).equals(CONTEUDO)).toBe(true);
  });
  it("com Range: 206, Content-Range e só o pedaço pedido", async () => {
    const r = pedir("bytes=5-9");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(r.headers.get("content-length")).toBe("5");
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("56789");
  });
  it("Range aberto (bytes=0-) devolve 206 com o arquivo todo, como o Safari pede", async () => {
    const r = pedir("bytes=0-");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-19/20");
  });
  it("Range fora do arquivo: 416", () => {
    const r = pedir("bytes=50-60");
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */20");
  });
  it("lerIntervalo aceita o sufixo bytes=-4", () => {
    expect(lerIntervalo("bytes=-4", 20)).toEqual({ inicio: 16, fim: 19 });
  });
});
