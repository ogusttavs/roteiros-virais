/**
 * E19b: o vídeo guardado por pouco tempo para a Meta baixar (`lib/video-temporario.ts`), em disco de verdade (uma pasta só deste teste) e sem rede.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return { ...original, config: { ...original.config, appUrl: "https://klaki.exemplo.teste/", auth: { ...original.config.auth, secret: "segredo-de-sessao-de-teste" } } };
});

import {
  caminhoDoVideo,
  criarCodigoDoVideo,
  descartarVideo,
  enderecoPublicoDoVideo,
  guardarVideo,
  IDADE_MAXIMA_MS,
  lerCodigoDoVideo,
  tamanhoDoVideoGuardado,
  VALIDADE_DO_ENDERECO_MS,
  varrerVideosVelhos,
} from "./video-temporario";

let pasta: string;
beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), "teste-video-temp-"));
  process.env.PUBLICAR_PASTA_TEMP = join(pasta, "publicar");
});
afterAll(() => {
  delete process.env.PUBLICAR_PASTA_TEMP;
  rmSync(pasta, { recursive: true, force: true });
});

function fluxo(pedacos: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controle) {
      if (i < pedacos.length) controle.enqueue(pedacos[i++]);
      else controle.close();
    },
  });
}

describe("guardar o vídeo em disco", () => {
  it("grava o corpo inteiro em fluxo, com o tamanho exato", async () => {
    await guardarVideo(1, fluxo([new Uint8Array(1000).fill(1), new Uint8Array(500).fill(2)]), 1500);
    expect(await tamanhoDoVideoGuardado(1)).toBe(1500);
    const bytes = readFileSync(caminhoDoVideo(1));
    expect(bytes[0]).toBe(1);
    expect(bytes[1499]).toBe(2);
  });

  it("maior ou menor que o declarado: recusa e não deixa arquivo parcial", async () => {
    await expect(guardarVideo(2, fluxo([new Uint8Array(100)]), 99)).rejects.toThrow("maior do que o declarado");
    expect(existsSync(caminhoDoVideo(2))).toBe(false);
    await expect(guardarVideo(3, fluxo([new Uint8Array(100)]), 101)).rejects.toThrow("menor do que o declarado");
    expect(existsSync(caminhoDoVideo(3))).toBe(false);
  });

  it("um fluxo que quebra no meio também não deixa arquivo", async () => {
    const quebrado = new ReadableStream<Uint8Array>({
      start(controle) {
        controle.enqueue(new Uint8Array(10));
        controle.error(new Error("o navegador fechou"));
      },
    });
    await expect(guardarVideo(4, quebrado, 20)).rejects.toThrow();
    expect(existsSync(caminhoDoVideo(4))).toBe(false);
  });

  it("descartar apaga, e descartar o que não existe não é erro", async () => {
    await guardarVideo(5, fluxo([new Uint8Array(8)]), 8);
    await descartarVideo(5);
    expect(existsSync(caminhoDoVideo(5))).toBe(false);
    await expect(descartarVideo(5)).resolves.toBeUndefined();
    expect(await tamanhoDoVideoGuardado(5)).toBeNull();
  });
});

describe("a varredura do que ficou para trás", () => {
  it("apaga só o arquivo mais velho que o limite, e só os que têm o nome dos vídeos", async () => {
    await guardarVideo(10, fluxo([new Uint8Array(4)]), 4);
    await guardarVideo(11, fluxo([new Uint8Array(4)]), 4);
    const outro = join(process.env.PUBLICAR_PASTA_TEMP as string, "nao-e-video.txt");
    writeFileSync(outro, "x");
    const velho = new Date(Date.now() - IDADE_MAXIMA_MS - 60_000);
    utimesSync(caminhoDoVideo(10), velho, velho);
    utimesSync(outro, velho, velho);
    expect(await varrerVideosVelhos(new Date())).toBe(1);
    expect(existsSync(caminhoDoVideo(10))).toBe(false);
    expect(existsSync(caminhoDoVideo(11))).toBe(true);
    expect(existsSync(outro)).toBe(true);
  });

  it("sem a pasta, não faz nada", async () => {
    const antes = process.env.PUBLICAR_PASTA_TEMP;
    process.env.PUBLICAR_PASTA_TEMP = join(pasta, "nao-existe");
    expect(await varrerVideosVelhos()).toBe(0);
    process.env.PUBLICAR_PASTA_TEMP = antes;
  });
});

describe("o endereço público assinado", () => {
  const agora = new Date("2026-10-27T12:00:00Z");

  it("leva a publicação e o prazo, e a leitura devolve a publicação", () => {
    const codigo = criarCodigoDoVideo(42, agora);
    expect(lerCodigoDoVideo(codigo, agora)).toEqual({ publicacaoId: 42 });
    expect(lerCodigoDoVideo(codigo, new Date(agora.getTime() + VALIDADE_DO_ENDERECO_MS - 1000))).toEqual({ publicacaoId: 42 });
  });

  it("depois do prazo não vale", () => {
    const codigo = criarCodigoDoVideo(42, agora);
    expect(lerCodigoDoVideo(codigo, new Date(agora.getTime() + VALIDADE_DO_ENDERECO_MS + 1))).toBeNull();
  });

  it("trocar o número da publicação, o prazo ou a assinatura invalida; lixo também", () => {
    const [id, vence, assinatura] = criarCodigoDoVideo(42, agora).split(".");
    expect(lerCodigoDoVideo(`43.${vence}.${assinatura}`, agora)).toBeNull();
    expect(lerCodigoDoVideo(`${id}.${Number(vence) + 3_600_000}.${assinatura}`, agora)).toBeNull();
    expect(lerCodigoDoVideo(`${id}.${vence}.${assinatura.slice(0, -2)}xx`, agora)).toBeNull();
    for (const lixo of ["", "42", "42.1", "a.b.c", "42.1792792153212.", "../../etc/passwd"]) expect(lerCodigoDoVideo(lixo, agora)).toBeNull();
  });

  it("o endereço é público, no APP_URL, sem barra dobrada, e termina no nome do arquivo", () => {
    const url = enderecoPublicoDoVideo(42, agora);
    expect(url).toMatch(/^https:\/\/klaki\.exemplo\.teste\/api\/publicar-arquivo\/42\.\d+\.[\w-]+\/video\.mp4$/);
  });
});
