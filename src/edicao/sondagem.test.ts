import { describe, expect, it } from "vitest";

import { argumentosDoAudio } from "./audio";
import { comecaComoMp4OuMov } from "./entrada-segura";
import { argumentosDoFfprobe, ErroDeSondagem, interpretarSondagem, recusaDaSondagem, sondarVideo } from "./sondagem";

function saida(opcoes: { largura?: number; altura?: number; duracao?: string; rotacaoLado?: number; rotacaoTag?: string; audio?: boolean; video?: boolean }): string {
  const { largura = 1080, altura = 1920, duracao = "42.5", audio = true, video = true } = opcoes;
  const fluxos: unknown[] = [];
  if (video) {
    fluxos.push({
      codec_type: "video",
      width: largura,
      height: altura,
      ...(opcoes.rotacaoTag ? { tags: { rotate: opcoes.rotacaoTag } } : {}),
      ...(opcoes.rotacaoLado !== undefined ? { side_data_list: [{ side_data_type: "Display Matrix", rotation: opcoes.rotacaoLado }] } : {}),
    });
  }
  if (audio) fluxos.push({ codec_type: "audio" });
  return JSON.stringify({ streams: fluxos, format: { duration: duracao } });
}

describe("interpretarSondagem", () => {
  it("vídeo em pé comum: duração, tamanho, som", () => {
    expect(interpretarSondagem(saida({}))).toEqual({ duracaoS: 42.5, largura: 1080, altura: 1920, rotacao: 0, temVideo: true, temAudio: true });
  });

  it("iPhone em pé: 1920x1080 com rotação de 90 vira 1080x1920 como a pessoa vê (rotação nova e antiga)", () => {
    const novo = interpretarSondagem(saida({ largura: 1920, altura: 1080, rotacaoLado: -90 }));
    expect([novo.largura, novo.altura, novo.rotacao]).toEqual([1080, 1920, 270]);
    const antigo = interpretarSondagem(saida({ largura: 1920, altura: 1080, rotacaoTag: "90" }));
    expect([antigo.largura, antigo.altura, antigo.rotacao]).toEqual([1080, 1920, 90]);
  });

  it("rotação de 180 não troca os lados", () => {
    const s = interpretarSondagem(saida({ largura: 1920, altura: 1080, rotacaoLado: 180 }));
    expect([s.largura, s.altura, s.rotacao]).toEqual([1920, 1080, 180]);
  });

  it("sem faixa de imagem: temVideo falso; sem som: temAudio falso", () => {
    expect(interpretarSondagem(saida({ video: false })).temVideo).toBe(false);
    expect(interpretarSondagem(saida({ audio: false })).temAudio).toBe(false);
  });

  it("não é JSON, ou JSON com duração inválida: ErroDeSondagem", () => {
    expect(() => interpretarSondagem("isso nao e json")).toThrow(ErroDeSondagem);
    expect(() => interpretarSondagem(saida({ duracao: "N/A" }))).toThrow(ErroDeSondagem);
  });
});

describe("recusaDaSondagem", () => {
  const base = { duracaoS: 60, largura: 1080, altura: 1920, rotacao: 0, temVideo: true, temAudio: true };

  it("1080p em pé ou deitado serve", () => {
    expect(recusaDaSondagem(base)).toBeNull();
    expect(recusaDaSondagem({ ...base, largura: 1920, altura: 1080 })).toBeNull();
    expect(recusaDaSondagem({ ...base, largura: 720, altura: 1280 })).toBeNull();
  });

  it("os 3 minutos servem (com a folga do iPhone), acima disso não", () => {
    expect(recusaDaSondagem({ ...base, duracaoS: 180.03 })).toBeNull();
    expect(recusaDaSondagem({ ...base, duracaoS: 181.5 })).toBe("longo");
    expect(recusaDaSondagem({ ...base, duracaoS: 2.5 })).toBe("curto");
  });

  it("4K é recusado, em pé ou deitado", () => {
    expect(recusaDaSondagem({ ...base, largura: 2160, altura: 3840 })).toBe("qualidade-alta");
    expect(recusaDaSondagem({ ...base, largura: 3840, altura: 2160 })).toBe("qualidade-alta");
    expect(recusaDaSondagem({ ...base, largura: 1440, altura: 2560 })).toBe("qualidade-alta");
  });

  it("sem imagem ou sem som", () => {
    expect(recusaDaSondagem({ ...base, temVideo: false })).toBe("sem-video");
    expect(recusaDaSondagem({ ...base, temAudio: false })).toBe("sem-som");
  });
});

describe("sondarVideo", () => {
  it("chama o ffprobe com os argumentos certos e interpreta a saída", async () => {
    let chamado: { comando: string; argumentos: string[] } | null = null;
    const s = await sondarVideo("/volume/ed-1.video", async (comando, argumentos) => {
      chamado = { comando, argumentos };
      return { stdout: saida({}), stderr: "" };
    });
    expect(chamado).toEqual({ comando: "ffprobe", argumentos: argumentosDoFfprobe("/volume/ed-1.video") });
    expect(s.duracaoS).toBe(42.5);
  });

  it("falha do processo vira ErroDeSondagem sem o caminho do arquivo", async () => {
    const erro = await sondarVideo("/segredo/ed-1.video", async () => {
      throw new Error("ffprobe falhou em /segredo/ed-1.video");
    }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeSondagem);
    expect((erro as Error).message).not.toContain("/segredo");
  });
});

describe("entrada segura (A2, 26/11/2026)", () => {
  it("o ffprobe leva o formato fixo e a lista de protocolos antes do arquivo", () => {
    const a = argumentosDoFfprobe("/v/a.video");
    expect(a.join(" ")).toContain("-protocol_whitelist file -f mov");
    expect(a.indexOf("-protocol_whitelist")).toBeLessThan(a.indexOf("/v/a.video"));
  });
  it("o ffmpeg do áudio leva o formato fixo e a lista de protocolos antes do -i", () => {
    const a = argumentosDoAudio("/v/a.video", "/t/a.wav", "/t/a.pcm");
    expect(a.slice(a.indexOf("-protocol_whitelist"), a.indexOf("-i") + 2)).toEqual(["-protocol_whitelist", "file", "-f", "mov", "-i", "/v/a.video"]);
  });
  it("só começa como MP4 ou MOV o que tem uma caixa conhecida nos bytes 4 a 8", () => {
    const caixa = (nome: string) => new Uint8Array([0, 0, 0, 24, ...Buffer.from(nome)]);
    for (const n of ["ftyp", "moov", "mdat", "wide", "free", "skip"]) expect(comecaComoMp4OuMov(caixa(n))).toBe(true);
    expect(comecaComoMp4OuMov(new Uint8Array(Buffer.from("ffconcat version 1.0\nfile 'ed-1.video'\n")))).toBe(false);
    expect(comecaComoMp4OuMov(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe(false);
    expect(comecaComoMp4OuMov(new Uint8Array(4))).toBe(false);
  });
});
