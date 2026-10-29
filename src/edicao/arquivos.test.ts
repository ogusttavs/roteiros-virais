import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { apagarArquivoDaEdicao, arquivoExiste, caminhoNoVolume, guardarBruto, nomeRelativoDoBruto, nomeRelativoDoEditado, pastaDaEdicao, varrerSobrasDoVolume } from "./arquivos";

let pasta: string;
let anterior: string | undefined;

function fluxo(...pedacos: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pedacos) c.enqueue(new Uint8Array(p));
      c.close();
    },
  });
}

async function arquivosDe(sub: string): Promise<string[]> {
  return (await readdir(join(pasta, sub)).catch(() => [])).sort();
}

beforeAll(async () => {
  anterior = process.env.EDICAO_PASTA;
  pasta = await mkdtemp(join(tmpdir(), "edicao-teste-"));
  process.env.EDICAO_PASTA = pasta;
});

afterAll(async () => {
  if (anterior === undefined) delete process.env.EDICAO_PASTA;
  else process.env.EDICAO_PASTA = anterior;
  await rm(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(join(pasta, "bruto"), { recursive: true, force: true });
  await rm(join(pasta, "editado"), { recursive: true, force: true });
});

describe("caminhoNoVolume", () => {
  it("só aceita os nomes que o código gera", () => {
    expect(caminhoNoVolume(nomeRelativoDoBruto(7))).toBe(join(pastaDaEdicao(), "bruto", "ed-7.video"));
    expect(caminhoNoVolume(nomeRelativoDoEditado(7))).toBe(join(pastaDaEdicao(), "editado", "ed-7.mp4"));
  });

  it("recusa subida de pasta, caminho absoluto e nome estranho", () => {
    for (const ruim of ["../etc/passwd", "bruto/../../x", "/etc/passwd", "bruto/ed-1.video/../../x", "bruto/ed-1.txt", "outro/ed-1.video", "bruto/ed-x.video", ""]) {
      expect(() => caminhoNoVolume(ruim), ruim).toThrow();
    }
  });
});

describe("guardarBruto", () => {
  it("grava em fluxo, com o tamanho exato, e só deixa o arquivo final", async () => {
    const relativo = await guardarBruto(5, fluxo([1, 2, 3], [4, 5]), 5);
    expect(relativo).toBe("bruto/ed-5.video");
    expect(await arquivosDe("bruto")).toEqual(["ed-5.video"]);
    expect(await arquivoExiste(relativo)).toBe(true);
  });

  it("maior que o declarado: falha e não deixa nada (nem o parcial)", async () => {
    await expect(guardarBruto(6, fluxo([1, 2, 3, 4, 5, 6]), 5)).rejects.toThrow();
    expect(await arquivosDe("bruto")).toEqual([]);
  });

  it("menor que o declarado: falha e não deixa nada", async () => {
    await expect(guardarBruto(7, fluxo([1, 2, 3]), 5)).rejects.toThrow();
    expect(await arquivosDe("bruto")).toEqual([]);
  });

  it("um envio que falha não apaga o arquivo bom de outro envio da mesma edição", async () => {
    await guardarBruto(8, fluxo([1, 2, 3, 4, 5]), 5);
    await expect(guardarBruto(8, fluxo([1]), 5)).rejects.toThrow();
    expect(await arquivosDe("bruto")).toEqual(["ed-8.video"]);
  });
});

describe("apagarArquivoDaEdicao", () => {
  it("apaga, e apagar o que não existe não é erro", async () => {
    const relativo = await guardarBruto(9, fluxo([1, 2]), 2);
    expect(await apagarArquivoDaEdicao(relativo)).toBe(true);
    expect(await apagarArquivoDaEdicao(relativo)).toBe(false);
    expect(await apagarArquivoDaEdicao(null)).toBe(false);
    expect(await apagarArquivoDaEdicao("../fora")).toBe(false);
  });
});

describe("varrerSobrasDoVolume", () => {
  const agora = new Date("2026-10-29T12:00:00Z");
  const horas = (h: number) => new Date(agora.getTime() - h * 3_600_000);

  async function criar(relativo: string, idade: Date): Promise<void> {
    const caminho = join(pasta, ...relativo.split("/"));
    await mkdir(join(caminho, ".."), { recursive: true });
    await writeFile(caminho, "x");
    await utimes(caminho, idade, idade);
  }

  it("apaga o que não tem dono e é velho; guarda o que tem dono, o recente e o que não é nosso", async () => {
    await criar("bruto/ed-1.video", horas(5)); // tem dono
    await criar("bruto/ed-2.video", horas(5)); // sem dono e velho: sai
    await criar("bruto/ed-3.video", horas(0.05)); // sem dono mas acabou de chegar: fica
    await criar("editado/ed-2.mp4", horas(30)); // sem dono e velho: sai
    await criar("bruto/ed-4.aabbccddeeff.parte", horas(5)); // parte velha: sai
    await criar("bruto/ed-5.112233445566.parte", horas(0.5)); // parte recente (envio em curso): fica
    await criar("bruto/leia-me.txt", horas(100)); // não é nosso: fica
    const r = await varrerSobrasDoVolume(new Set(["bruto/ed-1.video"]), agora, 10 * 60_000, 2 * 3_600_000);
    expect(r).toEqual({ orfaos: 2, partes: 1 });
    expect(await arquivosDe("bruto")).toEqual(["ed-1.video", "ed-3.video", "ed-5.112233445566.parte", "leia-me.txt"]);
    expect(await arquivosDe("editado")).toEqual([]);
  });

  it("volume que ainda não existe não é erro", async () => {
    expect(await varrerSobrasDoVolume(new Set(), agora, 1, 1)).toEqual({ orfaos: 0, partes: 0 });
  });
});
