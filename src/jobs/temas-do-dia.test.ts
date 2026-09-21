import { describe, expect, it } from "vitest";

import type { TemaDoDia } from "@/db/schema";
import { temaTemProvaSuficiente, type VideoParaProva } from "@/servicos/prova-tema";

import { evidenciaValida } from "./temas-do-dia";

function tema(dados: Partial<TemaDoDia> = {}): TemaDoDia {
  return {
    titulo: "tema de teste",
    descricao: "descricao",
    porQue: "esta subindo mais rapido que o normal da conta",
    evidencias: [],
    puxaPara: "alcance",
    ...dados,
  };
}

describe("evidenciaValida", () => {
  it("aprova com evidencia so de video", () => {
    const temas = [tema({ evidencias: [1] })];
    expect(evidenciaValida(temas, new Set([1]), new Set())).toBe(true);
  });

  it("aprova com evidencia so de noticia", () => {
    const temas = [tema({ evidenciasNoticias: [10] })];
    expect(evidenciaValida(temas, new Set(), new Set([10]))).toBe(true);
  });

  it("aprova com evidencia dos dois tipos", () => {
    const temas = [tema({ evidencias: [1], evidenciasNoticias: [10] })];
    expect(evidenciaValida(temas, new Set([1]), new Set([10]))).toBe(true);
  });

  it("reprova sem nenhuma evidencia", () => {
    const temas = [tema()];
    expect(evidenciaValida(temas, new Set([1]), new Set([10]))).toBe(false);
  });

  it("reprova id de video invalido (nao enviado ao modelo)", () => {
    const temas = [tema({ evidencias: [999] })];
    expect(evidenciaValida(temas, new Set([1]), new Set())).toBe(false);
  });

  it("reprova id de noticia invalido (nao enviado ao modelo)", () => {
    const temas = [tema({ evidenciasNoticias: [999] })];
    expect(evidenciaValida(temas, new Set(), new Set([10]))).toBe(false);
  });

  it("evidenciasNoticias ausente (tema antigo, sem o campo) conta como lista vazia, nao quebra", () => {
    const temas = [tema({ evidencias: [1] })];
    delete (temas[0] as { evidenciasNoticias?: number[] }).evidenciasNoticias;
    expect(evidenciaValida(temas, new Set([1]), new Set([10]))).toBe(true);
  });

  it("reprova quando so um dos varios temas nao tem evidencia", () => {
    const temas = [tema({ evidencias: [1] }), tema()];
    expect(evidenciaValida(temas, new Set([1]), new Set())).toBe(false);
  });
});

/** V2b, item 8: tema so nasce com prova (escopo 5.12, passo 6). */
describe("temaTemProvaSuficiente", () => {
  const AGORA = new Date("2026-09-19T12:00:00Z");
  const DIA_MS = 24 * 60 * 60 * 1000;
  function diasAtras(dias: number): Date {
    return new Date(AGORA.getTime() - dias * DIA_MS);
  }

  function video(id: number, dados: Partial<VideoParaProva> = {}): VideoParaProva {
    return {
      id,
      contaId: id, // cada video default numa conta propria, salvo quando o teste sobrescreve
      publicadoEm: diasAtras(3),
      idioma: "pt",
      contaPais: null,
      contaIdiomaPrincipal: null,
      ...dados,
    };
  }

  function mapa(videos: VideoParaProva[]): Map<number, VideoParaProva> {
    return new Map(videos.map((v) => [v.id, v]));
  }

  it("aprova com 3 videos de 2 contas, maioria brasileira", () => {
    const videos = [video(1, { contaId: 10 }), video(2, { contaId: 10 }), video(3, { contaId: 20 })];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(true);
  });

  it("reprova com menos de 3 videos, mesmo com 2 contas e maioria brasileira", () => {
    const videos = [video(1, { contaId: 10 }), video(2, { contaId: 20 })];
    expect(temaTemProvaSuficiente([1, 2], mapa(videos), AGORA, 7)).toBe(false);
  });

  it("reprova com 3+ videos de uma so conta (video sem dono nunca conta para 'contas diferentes')", () => {
    const videos = [
      video(1, { contaId: 10 }),
      video(2, { contaId: 10 }),
      video(3, { contaId: null }), // sem dono: conta para o total de videos, nunca para contas distintas
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(false);
  });

  it("video sem dono soma ao total de videos quando ha 2 contas de verdade entre os outros", () => {
    const videos = [video(1, { contaId: 10 }), video(2, { contaId: 20 }), video(3, { contaId: null })];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(true);
  });

  it("reprova com maioria internacional (2 de 3)", () => {
    const videos = [
      video(1, { contaId: 10, idioma: "en" }),
      video(2, { contaId: 20, idioma: "en" }),
      video(3, { contaId: 30, idioma: "pt" }),
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(false);
  });

  it("aprova com maioria brasileira (2 de 3), mesmo com um internacional junto", () => {
    const videos = [
      video(1, { contaId: 10, idioma: "pt" }),
      video(2, { contaId: 20, idioma: "pt" }),
      video(3, { contaId: 30, idioma: "en" }),
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(true);
  });

  it("empate (metade e metade) nao e maioria: reprova", () => {
    const videos = [
      video(1, { contaId: 10, idioma: "pt" }),
      video(2, { contaId: 20, idioma: "pt" }),
      video(3, { contaId: 30, idioma: "en" }),
      video(4, { contaId: 40, idioma: "en" }),
    ];
    expect(temaTemProvaSuficiente([1, 2, 3, 4], mapa(videos), AGORA, 7)).toBe(false);
  });

  it("idioma nulo conta como brasileiro so quando a conta e brasileira (pais ou idioma principal)", () => {
    const videos = [
      video(1, { contaId: 10, idioma: null, contaPais: "BR" }),
      video(2, { contaId: 20, idioma: null, contaIdiomaPrincipal: "pt-BR" }),
      video(3, { contaId: 30, idioma: "en" }),
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(true);
  });

  it("video fora da janela nunca conta, mesmo citado pelo tema", () => {
    const videos = [
      video(1, { contaId: 10, publicadoEm: diasAtras(3) }),
      video(2, { contaId: 20, publicadoEm: diasAtras(3) }),
      video(3, { contaId: 30, publicadoEm: diasAtras(10) }), // fora da janela de 7 dias
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(false);
  });

  it("janela de 14 dias (nicho novo) aceita o video que a janela de 7 dias rejeitaria", () => {
    const videos = [
      video(1, { contaId: 10, publicadoEm: diasAtras(3) }),
      video(2, { contaId: 20, publicadoEm: diasAtras(3) }),
      video(3, { contaId: 30, publicadoEm: diasAtras(10) }),
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 14)).toBe(true);
  });

  it("id citado que nao esta no mapa (nao deveria acontecer, evidenciaValida ja filtra) e ignorado, nao quebra", () => {
    const videos = [video(1, { contaId: 10 }), video(2, { contaId: 20 })];
    expect(temaTemProvaSuficiente([1, 2, 999], mapa(videos), AGORA, 7)).toBe(false);
  });

  it("video sem publicadoEm (nulo) nunca conta para a prova (sobram so 2, abaixo do minimo)", () => {
    const videos = [
      video(1, { contaId: 10, publicadoEm: null }),
      video(2, { contaId: 20 }),
      video(3, { contaId: 30 }),
    ];
    expect(temaTemProvaSuficiente([1, 2, 3], mapa(videos), AGORA, 7)).toBe(false);
  });
});
