/**
 * E19b: o vídeo guardado por pouco tempo para a Meta baixar (`lib/video-temporario.ts`), em disco de verdade (uma pasta só deste teste) e sem rede.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

describe("dois envios do mesmo vídeo (revisão do Fable de 27/10, achado 3)", () => {
  const nomesNaPasta = () => readdirSync(process.env.PUBLICAR_PASTA_TEMP as string);

  it("grava num arquivo temporário e só renomeia no fim: no meio do envio o endereço servido ainda não existe", async () => {
    let liberar!: () => void;
    const portao = new Promise<void>((resolver) => (liberar = resolver));
    let primeira = true;
    const emDois = new ReadableStream<Uint8Array>({
      async pull(controle) {
        if (primeira) {
          primeira = false;
          controle.enqueue(new Uint8Array(10).fill(7));
          return;
        }
        await portao;
        controle.enqueue(new Uint8Array(10).fill(8));
        controle.close();
      },
    });
    const gravando = guardarVideo(20, emDois, 20);
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(existsSync(caminhoDoVideo(20))).toBe(false);
    expect(nomesNaPasta().some((n) => /^pub-20\.[0-9a-f]{12}\.parte$/.test(n))).toBe(true);
    liberar();
    await gravando;
    expect(readFileSync(caminhoDoVideo(20)).length).toBe(20);
    expect(nomesNaPasta().filter((n) => n.startsWith("pub-20."))).toEqual(["pub-20.video"]);
  });

  it("um envio que falha apaga só o próprio arquivo temporário, nunca o vídeo inteiro que outro envio já deixou", async () => {
    await guardarVideo(21, fluxo([new Uint8Array(6).fill(1)]), 6);
    await expect(guardarVideo(21, fluxo([new Uint8Array(3).fill(2)]), 6)).rejects.toThrow("menor do que o declarado");
    expect(readFileSync(caminhoDoVideo(21))).toEqual(Buffer.alloc(6, 1));
    expect(nomesNaPasta().filter((n) => n.startsWith("pub-21."))).toEqual(["pub-21.video"]);
  });

  it("dois gravando ao mesmo tempo no mesmo número: o arquivo fica sempre inteiro, sem sobra", async () => {
    await Promise.all([guardarVideo(22, fluxo([new Uint8Array(500_000).fill(1)]), 500_000), guardarVideo(22, fluxo([new Uint8Array(500_000).fill(2)]), 500_000)]);
    const bytes = readFileSync(caminhoDoVideo(22));
    expect(bytes.length).toBe(500_000);
    expect(new Set(bytes).size).toBe(1);
    expect(nomesNaPasta().filter((n) => n.startsWith("pub-22."))).toEqual(["pub-22.video"]);
  });

  it("a varredura também leva embora o temporário esquecido por um processo que caiu", async () => {
    const orfao = join(process.env.PUBLICAR_PASTA_TEMP as string, "pub-23.0123456789ab.parte");
    writeFileSync(orfao, "x");
    const velho = new Date(Date.now() - IDADE_MAXIMA_MS - 60_000);
    utimesSync(orfao, velho, velho);
    expect(await varrerVideosVelhos(new Date())).toBeGreaterThanOrEqual(1);
    expect(existsSync(orfao)).toBe(false);
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
