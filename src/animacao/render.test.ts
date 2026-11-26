import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { argumentosDoFfmpeg, montarHtmlDaAnimacao, renderizarAnimacao } from "./render";
import { ErroDaAnimacao } from "./tipos";

const pasta = mkdtempSync(join(tmpdir(), "animacao-teste-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

const MALICIOSO = `</p><script>window.hackeado=1</script><img src=x onerror="window.hackeado=2"> "'\``;

describe("montarHtmlDaAnimacao (sem navegador)", () => {
  it("o texto do cliente nunca vira marcação", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: [{ texto: MALICIOSO }] });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("window.hackeado=1</script>");
    expect(html).toContain("&lt;img");
    // O único <script> da página é o do próprio molde.
    expect(html.match(/<script/g)).toHaveLength(1);
  });
  it("a política de conteúdo fecha a rede", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: [{ texto: "oi" }] });
    expect(html).toContain("default-src 'none'");
  });
  it("molde desconhecido é recusado", () => {
    expect(() =>
      montarHtmlDaAnimacao({ cenas: [{ texto: "oi" }], molde: "../../etc/passwd" }),
    ).toThrow(ErroDaAnimacao);
  });
  it("o ffmpeg lê JPEG pelo stdin e escreve MP4 sem som, 30 quadros por segundo", () => {
    const a = argumentosDoFfmpeg("final", "x.parte");
    expect(a).toContain("image2pipe");
    expect(a).toContain("-an");
    expect(a[a.indexOf("-framerate") + 1]).toBe("30");
    expect(a[a.indexOf("-f", a.indexOf("-movflags")) + 1]).toBe("mp4");
  });
  it("o MP4 toca no Safari do iPhone: H.264 em yuv420p e o índice (moov) no começo", () => {
    const a = argumentosDoFfmpeg("final", "x.parte");
    expect(a[a.indexOf("libx264") - 1]).toBe("-c:v");
    expect(a.find((x) => x.includes("format=yuv420p"))).toBeDefined();
    expect(a[a.indexOf("-movflags") + 1]).toBe("+faststart");
  });
});

describe("renderizarAnimacao (Chromium e ffmpeg de verdade)", () => {
  const cenas = [
    { texto: "Você sabia disso?", duracaoS: 1 },
    { texto: MALICIOSO, duracaoS: 1 },
  ];

  it("a prévia de 2 segundos (mais os 2 da chamada final do molde) sai em 540 por 960, 30 quadros por segundo, e abre no ffprobe", async () => {
    const saida = join(pasta, "previa.mp4.parte");
    const r = await renderizarAnimacao({
      cenas: [{ texto: "Você sabia disso?", duracaoS: 2 }],
      qualidade: "previa",
      saida,
    });
    expect(r.quadros).toBe(120);
    const sonda = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,nb_read_frames,pix_fmt,codec_name:format=duration",
        "-of",
        "json",
        saida,
      ]).toString(),
    ) as {
      streams: {
        width: number;
        height: number;
        r_frame_rate: string;
        nb_read_frames: string;
        pix_fmt: string;
        codec_name: string;
      }[];
      format: { duration: string };
    };
    const v = sonda.streams[0];
    expect([v.width, v.height, v.r_frame_rate, v.codec_name, v.pix_fmt]).toEqual([
      540,
      960,
      "30/1",
      "h264",
      "yuv420p",
    ]);
    expect(Number(v.nb_read_frames)).toBe(120);
    expect(Number(sonda.format.duration)).toBeGreaterThan(3.95);
    expect(Number(sonda.format.duration)).toBeLessThan(4.1);
    expect(r.bytes).toBeGreaterThan(1000);
  }, 120_000);

  it("o texto malicioso é só texto e dois renders iguais saem quase iguais (PSNR acima de 30 dB)", async () => {
    // O Chromium não garante o mesmo pixel em toda foto quando a máquina está ocupada (visto em 25/11/2026: de vez em quando um quadro muda de antialiasing), então o teste exige o mesmo vídeo
    // à vista, não o mesmo byte. Em máquina calma os arquivos saem idênticos (PSNR infinito).
    const a = join(pasta, "a.parte");
    const b = join(pasta, "b.parte");
    await renderizarAnimacao({ cenas, qualidade: "previa", saida: a });
    await renderizarAnimacao({ cenas, qualidade: "previa", saida: b });
    const saida = spawnSync("ffmpeg", [
      "-hide_banner",
      "-i",
      a,
      "-i",
      b,
      "-lavfi",
      "psnr",
      "-f",
      "null",
      "-",
    ]).stderr.toString();
    const media = /average:(\S+)/.exec(saida)?.[1];
    expect(media).toBeDefined();
    expect(media === "inf" || Number(media) > 30).toBe(true);
  }, 120_000);

  it("passou do tempo limite: derruba, devolve o erro com código `tempo` e apaga o arquivo parcial", async () => {
    const saida = join(pasta, "limite.parte");
    const inicio = Date.now();
    await expect(
      renderizarAnimacao({
        // Limite curto e vídeo longo: em qualquer máquina o render não termina antes do relógio, então a prova do `tempo` não depende de velocidade.
        cenas: [{ texto: "oi", duracaoS: 30 }],
        qualidade: "final",
        saida,
        limiteMs: 300,
      }),
    ).rejects.toMatchObject({ name: "ErroDaAnimacao", codigo: "tempo" });
    expect(Date.now() - inicio).toBeLessThan(30_000);
    expect(existsSync(saida)).toBe(false);
  }, 60_000);

  it("entrada inválida falha antes de abrir navegador, sem deixar arquivo", async () => {
    const saida = join(pasta, "invalida.parte");
    await expect(
      renderizarAnimacao({ cenas: [], qualidade: "previa", saida }),
    ).rejects.toMatchObject({ codigo: "entrada" });
    expect(existsSync(saida)).toBe(false);
  });
});
