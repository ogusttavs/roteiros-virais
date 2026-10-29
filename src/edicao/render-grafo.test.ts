import { describe, expect, it } from "vitest";

import { AJUSTES_DO_RENDER, limiteDoRenderMs } from "@/config/edicao";

import { cadeiaDeHdr, montarGrafoDoRender, TRANSICAO_DO_FFMPEG } from "./render-grafo";
import type { Edl, TransicaoCorte, Trecho } from "./tipos";

function trecho(origem: [number, number], destino: [number, number], transicao?: TransicaoCorte, escala = 1): Trecho {
  return { origem, corteDepois: "pausa", destino, escala, ...(transicao ? { transicaoEntrada: transicao } : {}) };
}

/** Três trechos: o primeiro direto, o segundo entra com "combinar", o terceiro cola no segundo (corte seco). */
function planoDeTres(extra: Partial<Edl> = {}): Edl {
  return {
    limiarSilencioDb: -40,
    duracao: 10,
    respiroFinal: 1.2,
    duracaoOrigem: 30,
    trechos: [trecho([1, 5], [0, 4]), trecho([8, 12], [4, 8], "combinar"), trecho([13, 15], [8, 10])],
    alertas: [],
    palavrasMantidas: [],
    ...extra,
  };
}

const base = { perfil: "previa" as const, bruto: "/v/bruto.video", saida: "/v/saida.parte", hdr: null, assRelativo: "legenda.ass", fontesRelativo: "fontes" };

describe("montarGrafoDoRender", () => {
  it("uma entrada por trecho, cada uma lida só no pedaço que fica, e a duração da saída é a do plano mais o respiro", () => {
    const grafo = montarGrafoDoRender({ ...base, edl: planoDeTres() });
    const a = grafo.argumentos;
    expect(a.filter((x) => x === "-i")).toHaveLength(3);
    // `-ss` no começo do trecho no bruto; `-t` é o trecho mais a transição que vem depois e meio segundo de folga.
    expect(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 6)).toEqual(["-ss", "1", "-t", expect.any(String), "-i", "/v/bruto.video"]);
    expect(grafo.duracaoDaSaidaS).toBeCloseTo(11.2, 5);
    expect(grafo.quadros).toBe(336);
    expect(a[a.indexOf("-t", a.indexOf("-map")) + 1]).toBe("11.2");
    expect(a[a.length - 1]).toBe("/v/saida.parte");
    expect(a.slice(-3, -1)).toEqual(["-f", "mp4"]);
  });

  it("a tela é a do perfil: 540x960 na prévia e 1080x1920 no final, com os mesmos cortes", () => {
    const previa = montarGrafoDoRender({ ...base, edl: planoDeTres() });
    const final = montarGrafoDoRender({ ...base, perfil: "final", edl: planoDeTres() });
    expect(previa.filtro).toContain("scale=540:960:force_original_aspect_ratio=decrease");
    expect(previa.filtro).toContain("pad=540:960:");
    expect(final.filtro).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(final.argumentos[final.argumentos.indexOf("-crf") + 1]).toBe(String(AJUSTES_DO_RENDER.final.crf));
    expect(previa.argumentos[previa.argumentos.indexOf("-crf") + 1]).toBe(String(AJUSTES_DO_RENDER.previa.crf));
    expect(final.duracaoDaSaidaS).toBe(previa.duracaoDaSaidaS);
  });

  it("a transição 'combinar' começa no quadro do corte e dura 14 quadros; o trecho que sai continua por baixo", () => {
    const grafo = montarGrafoDoRender({ ...base, edl: planoDeTres() });
    // O segundo trecho entra aos 4 s: xfade offset 4 (120 quadros), 14 quadros = 0,466667 s.
    expect(grafo.filtro).toContain("xfade=transition=fade:duration=0.466667:offset=4");
    // O primeiro trecho tem 120 quadros e continua mais 14 por baixo da transição.
    expect(grafo.filtro).toContain("trim=end_frame=134");
    // O terceiro cola no segundo por corte seco: um concat de 2 entradas, não um xfade.
    expect(grafo.filtro).toMatch(/\[v1\]\[v2\]concat=n=2:v=1:a=0/);
    expect(grafo.filtro.match(/xfade=/g)).toHaveLength(1);
  });

  it("cada tipo de transição vira o xfade certo", () => {
    for (const [nome, tipo] of Object.entries(TRANSICAO_DO_FFMPEG)) {
      const edl = planoDeTres({ trechos: [trecho([1, 5], [0, 4]), trecho([8, 12], [4, 8], nome as TransicaoCorte), trecho([13, 15], [8, 10])] });
      expect(montarGrafoDoRender({ ...base, edl }).filtro).toContain(`xfade=transition=${tipo}:`);
    }
  });

  it("transição num trecho curto demais vira corte seco (nunca mais que metade do trecho)", () => {
    const edl = planoDeTres({ trechos: [trecho([1, 5], [0, 4]), trecho([8, 8.1], [4, 4.1], "combinar")], duracao: 4.1 });
    const grafo = montarGrafoDoRender({ ...base, edl });
    expect(grafo.filtro).not.toContain("xfade");
    expect(grafo.filtro).toMatch(/\[v0\]\[v1\]concat=n=2:v=1:a=0/);
  });

  it("o áudio é a fala dos trechos, sem música, com fade em cada ponta, passa-alta e volume; e nada de entrada de música", () => {
    const grafo = montarGrafoDoRender({ ...base, edl: planoDeTres() });
    expect(grafo.filtro).toContain("[a0][a1][a2]concat=n=3:v=0:a=1,highpass=f=70,loudnorm=I=-14");
    expect(grafo.filtro).toContain("afade=t=in:st=0:d=0.03");
    expect(grafo.argumentos.filter((x) => x === "-i")).toHaveLength(3);
    expect(grafo.filtro).not.toMatch(/amix|amovie|stream_loop/);
  });

  it("o fim: último quadro parado pelo respiro, legenda e título queimados, a imagem escurece e o áudio sai em fade", () => {
    const grafo = montarGrafoDoRender({ ...base, edl: planoDeTres() });
    expect(grafo.filtro).toContain("tpad=stop_mode=clone:stop_duration=1.2");
    expect(grafo.filtro).toContain("subtitles=legenda.ass:fontsdir=fontes");
    expect(grafo.filtro).toContain("fade=t=out:st=10.4:d=0.8");
    expect(grafo.filtro).toContain("afade=t=out:st=10.8:d=0.4");
  });

  it("sem respiro final não congela quadro", () => {
    const grafo = montarGrafoDoRender({ ...base, edl: planoDeTres({ respiroFinal: 0 }) });
    expect(grafo.filtro).not.toContain("stop_duration=0");
    expect(grafo.duracaoDaSaidaS).toBeCloseTo(10, 5);
  });

  it("HDR do iPhone passa por conversão de cor; cor normal não", () => {
    const sem = montarGrafoDoRender({ ...base, edl: planoDeTres() });
    const hlg = montarGrafoDoRender({ ...base, edl: planoDeTres(), hdr: "hlg" });
    const pq = montarGrafoDoRender({ ...base, edl: planoDeTres(), hdr: "pq" });
    expect(sem.filtro).not.toMatch(/zscale|tonemap/);
    expect(hlg.filtro).toContain(cadeiaDeHdr("hlg"));
    expect(hlg.filtro).toContain("tin=arib-std-b67");
    expect(pq.filtro).toContain("tin=smpte2084");
    expect(hlg.filtro.match(/tonemap=tonemap=/g)).toHaveLength(3);
    // A saída é sempre BT.709, 8 bits.
    for (const g of [sem, hlg]) {
      expect(g.argumentos).toEqual(expect.arrayContaining(["-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_trc", "bt709"]));
    }
  });

  it("zoom no trecho vira escala e recorte; sem zoom nada", () => {
    expect(montarGrafoDoRender({ ...base, edl: planoDeTres() }).filtro).not.toContain("crop=");
    const edl = planoDeTres({ trechos: [trecho([1, 5], [0, 4]), trecho([8, 12], [4, 8], undefined, 1.08), trecho([13, 15], [8, 10])] });
    expect(montarGrafoDoRender({ ...base, edl }).filtro).toContain("scale=584:1036,crop=540:960");
  });

  it("a soma dos quadros bate com o total mesmo com tempos que não caem em quadro inteiro", () => {
    const edl = planoDeTres({
      duracao: 9.013,
      respiroFinal: 0,
      trechos: [trecho([1, 4.3333], [0, 3.3333]), trecho([8, 10.7], [3.3333, 6.0333]), trecho([13, 15.98], [6.0333, 9.013])],
    });
    const grafo = montarGrafoDoRender({ ...base, edl });
    expect(grafo.quadros).toBe(Math.round(9.013 * 30));
    expect(grafo.filtro).toContain(`trim=end_frame=${grafo.quadros}`);
  });

  it("plano sem trecho é recusado", () => {
    expect(() => montarGrafoDoRender({ ...base, edl: planoDeTres({ trechos: [] }) })).toThrow();
  });

  it("o tempo máximo é três vezes o esperado, com piso e teto", () => {
    expect(limiteDoRenderMs("previa", 60)).toBe(135_000);
    expect(limiteDoRenderMs("final", 60)).toBe(600_000);
    expect(limiteDoRenderMs("previa", 5)).toBe(90_000);
    expect(limiteDoRenderMs("final", 10_000)).toBe(30 * 60_000);
  });
});
