/**
 * Conferência do vídeo montado: o que o ffmpeg mede (com vídeos sintéticos pequenos gerados aqui, sem imagem nem voz de ninguém), os limites de `avaliar` e a largura do texto com a fonte
 * embutida. Precisa de `ffmpeg` e `ffprobe` no PATH, como os outros testes da edição.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIMITES_DA_CONFERENCIA as L } from "@/config/edicao";

import { avaliar, conferirVideo, lerSaidaDoFfmpeg, medirVideo, textoForaDoQuadro, type EsperadoDoVideo, type MedidasDoVideo } from "./conferencia";
import { larguraDoTexto, lerMedidasDaFonte, medidasDaFonteEmbutida } from "./medida-de-texto";
import { pastaDasFontes } from "./render";

let pasta: string;
const esperado: EsperadoDoVideo = { perfil: "previa", duracaoS: 8, respiroFinalS: 0.5 };
const semTexto = { legenda: 0, titulo: 0, piorFolgaPx: 100 };

/** Um vídeo de 540x960. `video` e `audio` são filtros do lavfi; `sem` tira o áudio. */
function gerar(nome: string, opcoes: { segundos?: number; filtroDeVideo?: string; filtroDeAudio?: string; semAudio?: boolean } = {}): string {
  const { segundos = 8, filtroDeVideo = "null", filtroDeAudio = "volume=8dB", semAudio = false } = opcoes;
  const saida = join(pasta, nome);
  execFileSync("ffmpeg", [
    "-nostdin", "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000",
    "-vf", filtroDeVideo,
    ...(semAudio ? ["-an"] : ["-af", filtroDeAudio]),
    "-t", String(segundos), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...(semAudio ? [] : ["-c:a", "aac"]), saida,
  ]);
  return saida;
}

const medidasBoas: MedidasDoVideo = { duracaoS: 8, largura: 540, altura: 960, temVideo: true, temAudio: true, volumeLufs: -14, preto: [], parado: [], mudo: [] };

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "conferencia-"));
});
afterAll(async () => {
  await rm(pasta, { recursive: true, force: true });
});

describe("a medição com o ffmpeg de verdade", () => {
  it("um vídeo bom não tem defeito, e o volume medido fica perto do alvo", async () => {
    const c = await conferirVideo({ caminho: gerar("bom.mp4"), esperado, blocos: [{ inicio: 0, fim: 2, texto: "OI GENTE" }], titulo: { texto: "Você lava a louça do jeito certo?", subtitulo: null } });
    expect(c.graves).toEqual([]);
    expect(c.leves).toEqual([]);
    expect(Math.abs((c.medidas.volumeLufs as number) - L.alvoDeVolumeLufs)).toBeLessThan(L.toleranciaDoVolumeLu);
  }, 30_000);

  it("sem áudio é defeito grave", async () => {
    const c = await conferirVideo({ caminho: gerar("sem-audio.mp4", { semAudio: true }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(c.graves.join(" ")).toContain("nao tem audio");
  }, 30_000);

  it("3 segundos de quadro preto no meio são defeito grave", async () => {
    const c = await conferirVideo({ caminho: gerar("preto.mp4", { filtroDeVideo: "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,5)'" }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(c.graves.join(" ")).toContain("quadro preto");
  }, 30_000);

  it("o fim que escurece de propósito não conta como quadro preto", async () => {
    const c = await conferirVideo({ caminho: gerar("fade.mp4", { filtroDeVideo: "fade=t=out:st=6.6:d=1.4" }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(c.graves).toEqual([]);
    expect(c.leves.join(" ")).not.toContain("preto");
  }, 30_000);

  it("quadro parado no meio vira aviso (leve), mas o último quadro segurando pelo respiro do plano não", async () => {
    // 3 s de imagem andando e 5 s do último quadro parado, no meio do plano.
    const parado = gerar("parado.mp4", { filtroDeVideo: "trim=duration=2,tpad=stop_mode=clone:stop_duration=6" });
    const c = await conferirVideo({ caminho: parado, esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(c.graves).toEqual([]);
    expect(c.leves.join(" ")).toContain("imagem parada");
    // O mesmo parado, mas dentro do respiro final pedido pelo plano: esperado.
    const noRespiro = await conferirVideo({ caminho: parado, esperado: { ...esperado, respiroFinalS: 6.5 }, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(noRespiro.leves.join(" ")).not.toContain("imagem parada");
  }, 30_000);

  it("um vídeo curto demais para o plano é defeito grave de duração", async () => {
    const c = await conferirVideo({ caminho: gerar("curto.mp4", { segundos: 3 }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(c.graves.join(" ")).toContain("duracao");
  }, 30_000);

  it("silêncio longo que o plano não pediu é aviso, e áudio praticamente mudo é grave", async () => {
    const mudoNoMeio = await conferirVideo({ caminho: gerar("mudo-meio.mp4", { filtroDeAudio: "volume=8dB,volume=0:enable='between(t,1,5)'" }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(mudoNoMeio.leves.join(" ")).toContain("mudo");
    const quaseMudo = await conferirVideo({ caminho: gerar("quase-mudo.mp4", { filtroDeAudio: "volume=-40dB" }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(quaseMudo.graves.join(" ")).toContain("mudo");
  }, 30_000);

  it("um volume longe do alvo é só aviso", async () => {
    const c = await conferirVideo({ caminho: gerar("baixo.mp4", { filtroDeAudio: "volume=-4dB" }), esperado, blocos: [], titulo: { texto: "Oi", subtitulo: null } });
    expect(c.graves).toEqual([]);
    expect(c.leves.join(" ")).toContain("LUFS");
  }, 30_000);

  it("medirVideo lê duração, tamanho, imagem e áudio", async () => {
    const m = await medirVideo(gerar("medidas.mp4"));
    expect(m).toMatchObject({ largura: 540, altura: 960, temVideo: true, temAudio: true });
    expect(m.duracaoS).toBeGreaterThan(7.9);
    expect(m.duracaoS).toBeLessThan(8.2);
  }, 30_000);
});

describe("os limites de `avaliar`", () => {
  const ok = (m: Partial<MedidasDoVideo>) => avaliar({ ...medidasBoas, ...m }, esperado, semTexto);

  it("tudo dentro dos limites não acha nada", () => {
    expect(ok({})).toMatchObject({ graves: [], leves: [] });
  });

  it("duração: até 0,35 s de diferença passa, acima é aviso, acima de 1,5 s é grave", () => {
    expect(ok({ duracaoS: 8.3 }).leves).toEqual([]);
    expect(ok({ duracaoS: 8.4 }).leves).toHaveLength(1);
    expect(ok({ duracaoS: 9.4 })).toMatchObject({ graves: [] });
    expect(ok({ duracaoS: 9.6 }).graves).toHaveLength(1);
    expect(ok({ duracaoS: null }).graves).toHaveLength(1);
  });

  it("duração: em vídeo longo o limite grave cresce com a duração (8%)", () => {
    const longo: EsperadoDoVideo = { ...esperado, duracaoS: 100 };
    expect(avaliar({ ...medidasBoas, duracaoS: 106 }, longo, semTexto).graves).toEqual([]);
    expect(avaliar({ ...medidasBoas, duracaoS: 109 }, longo, semTexto).graves).toHaveLength(1);
  });

  it("volume: dentro de 2 LU do alvo passa, fora é aviso, abaixo de -35 LUFS é grave", () => {
    expect(ok({ volumeLufs: -12.1 }).leves).toEqual([]);
    expect(ok({ volumeLufs: -11.5 }).leves).toHaveLength(1);
    expect(ok({ volumeLufs: -20 })).toMatchObject({ graves: [] });
    expect(ok({ volumeLufs: -36 }).graves).toHaveLength(1);
    expect(ok({ volumeLufs: null }).leves).toEqual(["volume nao medido"]);
  });

  it("quadro preto: 0,5 s é aviso e 2 s é grave, mas o escurecer do fim (a partir de duração - 1,2 s) não conta", () => {
    expect(ok({ preto: [{ inicio: 3, duracao: 0.4 }] })).toMatchObject({ graves: [], leves: [] });
    expect(ok({ preto: [{ inicio: 3, duracao: 0.6 }] }).leves).toHaveLength(1);
    expect(ok({ preto: [{ inicio: 3, duracao: 2 }] }).graves).toHaveLength(1);
    expect(ok({ preto: [{ inicio: 6.9, duracao: 1.1 }] })).toMatchObject({ graves: [], leves: [] });
    // Um preto longo que começa antes do fim conta só até o fim esperado do escurecer.
    expect(ok({ preto: [{ inicio: 4, duracao: 4 }] }).graves).toHaveLength(1);
  });

  it("imagem parada e silêncio: abaixo do limite não avisa, e o que está no respiro final do plano é esperado", () => {
    expect(ok({ parado: [{ inicio: 1, duracao: 2.9 }] }).leves).toEqual([]);
    expect(ok({ parado: [{ inicio: 1, duracao: 3.1 }] }).leves).toHaveLength(1);
    expect(ok({ parado: [{ inicio: 7.2, duracao: 0.8 }] }).leves).toEqual([]);
    expect(ok({ mudo: [{ inicio: 1, duracao: 2.4 }] }).leves).toEqual([]);
    expect(ok({ mudo: [{ inicio: 1, duracao: 2.6 }] }).leves).toHaveLength(1);
    expect(ok({ mudo: [{ inicio: 7, duracao: 1 }] }).leves).toEqual([]);
  });

  it("forma: sem imagem, sem som ou do tamanho errado são graves", () => {
    expect(ok({ temVideo: false, largura: null, altura: null }).graves.length).toBeGreaterThan(0);
    expect(ok({ temAudio: false }).graves).toContain("o arquivo nao tem audio");
    expect(ok({ largura: 1080, altura: 1920 }).graves).toHaveLength(1);
    expect(ok({ largura: 960, altura: 540 }).graves).toHaveLength(1);
  });

  it("texto fora do quadro é só aviso", () => {
    const c = avaliar(medidasBoas, esperado, { legenda: 2, titulo: 1, piorFolgaPx: -40 });
    expect(c.graves).toEqual([]);
    expect(c.leves).toHaveLength(2);
  });
});

describe("a leitura da saída do ffmpeg", () => {
  it("lê preto, parado, mudo e o volume do resumo, e fecha o intervalo que vai até o fim do arquivo", () => {
    const saida = [
      "[blackdetect @ 0x1] black_start:2 black_end:5 black_duration:3",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 1.5",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 4",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 5.5",
      "[silencedetect @ 0x3] silence_start: 6",
      "[Parsed_ebur128_0 @ 0x4] Summary:",
      "  Integrated loudness:",
      "    I:         -14.3 LUFS",
    ].join("\n");
    const r = lerSaidaDoFfmpeg(saida, 9);
    expect(r.preto).toEqual([{ inicio: 2, duracao: 3 }]);
    expect(r.parado).toEqual([{ inicio: 1.5, duracao: 4 }]);
    expect(r.mudo).toEqual([{ inicio: 6, duracao: 3 }]);
    expect(r.volumeLufs).toBe(-14.3);
    expect(lerSaidaDoFfmpeg("I:         -70.0 LUFS\n", 5).volumeLufs).toBeNull();
  });
});

describe("a largura do texto com a fonte embutida", () => {
  it("lê a fonte: letra larga é mais larga que letra estreita e o espaço tem largura", async () => {
    const fonte = await medidasDaFonteEmbutida();
    expect(larguraDoTexto(fonte, "WWWW", 72)).toBeGreaterThan(larguraDoTexto(fonte, "IIII", 72));
    expect(larguraDoTexto(fonte, "A A", 72)).toBeGreaterThan(larguraDoTexto(fonte, "AA", 72));
    expect(larguraDoTexto(fonte, "OI", 144)).toBeCloseTo(2 * larguraDoTexto(fonte, "OI", 72), 5);
    // Com acento a letra existe na fonte (não cai no glifo vazio).
    expect(larguraDoTexto(fonte, "Ç", 72)).toBeGreaterThan(20);
    // O mesmo que `lerMedidasDaFonte` direto do arquivo.
    const direto = lerMedidasDaFonte(await readFile(join(pastaDasFontes(), "Montserrat-Bold.ttf")));
    expect(larguraDoTexto(direto, "OI", 72)).toBe(larguraDoTexto(fonte, "OI", 72));
  });

  it("uma legenda típica de 18 letras em caixa alta cabe no quadro; uma linha de 40 letras e um bloco de 18 letras largas (W) não", async () => {
    const fonte = await medidasDaFonteEmbutida();
    const cabe = textoForaDoQuadro([{ inicio: 0, fim: 1, texto: "QUANTO CUSTA ISSO?" }], { texto: "Oi", subtitulo: null }, fonte);
    expect(cabe.legenda).toBe(0);
    const passa = textoForaDoQuadro([{ inicio: 0, fim: 1, texto: "ESTA LINHA TEM LETRAS DEMAIS PARA CABER" }], { texto: "Oi", subtitulo: null }, fonte);
    expect(passa.legenda).toBe(1);
    expect(passa.piorFolgaPx).toBeLessThan(0);
    expect(textoForaDoQuadro([{ inicio: 0, fim: 1, texto: "WWWWWWWWWWWWWWWWWW" }], { texto: "Oi", subtitulo: null }, fonte).legenda).toBe(1);
  });

  it("o título quebrado em linhas de até 20 letras cabe", async () => {
    const fonte = await medidasDaFonteEmbutida();
    const r = textoForaDoQuadro([], { texto: "Você lava a louça do jeito certo mesmo", subtitulo: null }, fonte);
    expect(r.titulo).toBe(0);
  });
});
