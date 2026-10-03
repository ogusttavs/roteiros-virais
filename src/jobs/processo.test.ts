/**
 * `executarComLimite` (M5c): o processo de fora que passa do limite é MORTO e vira um erro com nome. Aqui roda processo de
 * verdade (o próprio `node`), porque o que importa provar é que o limite mata o processo e devolve a vez, e isso um falso
 * não prova.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { apagarSobrasDoDownload, ErroTempoLimite, executarComLimite } from "./processo";

describe("executarComLimite", () => {
  it("um processo que passa do limite é morto e vira ErroTempoLimite, rápido, sem esperar o processo acabar", async () => {
    const comeco = Date.now();

    // Um processo que dormiria 60 s: com o limite de 300 ms o teste leva bem menos de 10 s.
    const chamada = executarComLimite(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], 300);

    await expect(chamada).rejects.toBeInstanceOf(ErroTempoLimite);
    expect(Date.now() - comeco).toBeLessThan(10_000);
  }, 20_000);

  it("a mensagem diz o comando e o limite, e nunca os argumentos (a linha de comando leva o proxy com usuário e senha)", async () => {
    const erro = await executarComLimite(process.execPath, ["-e", "setTimeout(() => {}, 60000)", "--", "--proxy", "http://usuario:senha@host:823"], 300).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroTempoLimite);
    const mensagem = (erro as Error).message;
    expect(mensagem).toContain("tempo limite");
    expect(mensagem).not.toContain("senha");
    expect(mensagem).not.toContain("--proxy");
    expect((erro as ErroTempoLimite).limiteMs).toBe(300);
  }, 20_000);

  it("um processo que termina antes do limite devolve a saída, sem erro", async () => {
    const { stdout } = await executarComLimite(process.execPath, ["-e", "process.stdout.write('pronto')"], 20_000);
    expect(stdout).toBe("pronto");
  });

  it("um processo que falha (código de saída diferente de zero) lança o erro de sempre, não o de tempo limite", async () => {
    const erro = await executarComLimite(process.execPath, ["-e", "process.exit(3)"], 20_000).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(ErroTempoLimite);
  });

  it("o executor falso do teste recebe o limite e o sinal que mata de verdade (SIGKILL)", async () => {
    let recebido: { timeout: number; killSignal: string } | null = null;
    await executarComLimite("yt-dlp", ["--versao"], 1234, async (_comando, _argumentos, opcoes) => {
      recebido = opcoes;
      return { stdout: "", stderr: "" };
    });
    expect(recebido).toEqual({ timeout: 1234, killSignal: "SIGKILL" });
  });

  it("um erro com killed: true, de qualquer executor, é o limite", async () => {
    const chamada = executarComLimite("yt-dlp", [], 500, async () => {
      throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL", code: null });
    });
    await expect(chamada).rejects.toBeInstanceOf(ErroTempoLimite);
  });
});

describe("apagarSobrasDoDownload", () => {
  let pasta: string | null = null;

  afterEach(async () => {
    if (pasta) await rm(pasta, { recursive: true, force: true });
    pasta = null;
  });

  it("apaga só o que tem o prefixo do download (o .part e o áudio pela metade), nunca o de outro download", async () => {
    pasta = await mkdtemp(join(tmpdir(), "processo-teste-"));
    await writeFile(join(pasta, "audio-abc.webm.part"), "x");
    await writeFile(join(pasta, "audio-abc.mp3"), "x");
    await writeFile(join(pasta, "audio-outro.mp3"), "x");

    await apagarSobrasDoDownload(pasta, "audio-abc");

    expect(await readdir(pasta)).toEqual(["audio-outro.mp3"]);
  });

  it("pasta que não existe não lança", async () => {
    await expect(apagarSobrasDoDownload(join(tmpdir(), "pasta-que-nao-existe-m5c"), "audio-abc")).resolves.toBeUndefined();
  });
});
