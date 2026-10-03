/**
 * A prova de um tema com ramos alternativos (E45 PR 3, item 0b da E48): a janela e a proporção do Brasil são as do setor de cada vídeo, e o mínimo de
 * brasileiros é a soma dos mínimos de cada setor. Sem as regras por setor, tudo como antes.
 */
import { describe, expect, it } from "vitest";

import { motivoSemProva, temaTemProvaSuficiente, type RegraDoSetor, type VideoParaProva } from "./prova-tema";

const AGORA = new Date("2026-10-03T12:00:00Z");
const DIA_MS = 24 * 60 * 60 * 1000;

function video(id: number, nichoId: number, brasileiro: boolean, diasAtras = 1, contaId = id): VideoParaProva {
  return {
    id,
    nichoId,
    contaId,
    publicadoEm: new Date(AGORA.getTime() - diasAtras * DIA_MS),
    idioma: brasileiro ? "pt" : "en",
    contaPais: brasileiro ? "BR" : "US",
    contaIdiomaPrincipal: brasileiro ? "pt" : "en",
  };
}

const PRINCIPAL = 1;
const ALTERNATIVO = 2;

describe("temaTemProvaSuficiente com regras por setor", () => {
  it("um principal de proporção 0,3 e um alternativo de 0,7: a proporção ponderada é 0,5 e o mínimo sobre os seis vídeos é 3 (dois brasileiros não bastam)", () => {
    const videos = new Map<number, VideoParaProva>(
      [
        video(1, PRINCIPAL, true),
        video(2, PRINCIPAL, false),
        video(3, PRINCIPAL, false),
        video(4, ALTERNATIVO, true),
        video(5, ALTERNATIVO, false),
        video(6, ALTERNATIVO, false),
      ].map((v) => [v.id, v]),
    );
    const ids = [1, 2, 3, 4, 5, 6];
    const regras = new Map<number, RegraDoSetor>([
      [PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.3 }],
      [ALTERNATIVO, { janelaDias: 7, proporcaoBrasil: 0.7 }],
    ]);

    // Sem as regras por setor, a régua do principal vale para os seis: mínimo 2, e dois brasileiros passam (o defeito que o item 0b fecha).
    expect(temaTemProvaSuficiente(ids, videos, AGORA, 7, 0.3)).toBe(true);
    // Com elas: proporção ponderada (3 x 0,3 + 3 x 0,7) / 6 = 0,5, mínimo ceil(6 x 0,5) = 3 sobre o total; só há 2.
    expect(temaTemProvaSuficiente(ids, videos, AGORA, 7, 0.3, regras)).toBe(false);
    expect(motivoSemProva(ids, videos, AGORA, 7, 0.3, regras)).toBe("só 2 de 6 vídeos citados são do Brasil, precisa de pelo menos 3");
  });

  it("os cenários da revisão do #113: 1 vídeo mais 3 a 0,5 pede 2 de 4 (a soma por setor pedia 3); 3 a 0,7 mais 1 a 0,3 pede 3 de 4", () => {
    const meio = new Map<number, RegraDoSetor>([
      [PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.5 }],
      [ALTERNATIVO, { janelaDias: 7, proporcaoBrasil: 0.5 }],
    ]);
    const umMaisTres = (brasileiros: number) =>
      new Map<number, VideoParaProva>(
        [
          video(1, ALTERNATIVO, brasileiros >= 1),
          video(2, PRINCIPAL, brasileiros >= 2),
          video(3, PRINCIPAL, false),
          video(4, PRINCIPAL, false),
        ].map((v) => [v.id, v]),
      );
    expect(motivoSemProva([1, 2, 3, 4], umMaisTres(2), AGORA, 7, 0.5, meio)).toBeNull();
    expect(motivoSemProva([1, 2, 3, 4], umMaisTres(1), AGORA, 7, 0.5, meio)).toBe("só 1 de 4 vídeos citados são do Brasil, precisa de pelo menos 2");

    const regras = new Map<number, RegraDoSetor>([
      [PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.7 }],
      [ALTERNATIVO, { janelaDias: 7, proporcaoBrasil: 0.3 }],
    ]);
    const quatro = (brasileiros: number) =>
      new Map<number, VideoParaProva>(
        [
          video(1, PRINCIPAL, brasileiros >= 1),
          video(2, PRINCIPAL, brasileiros >= 2),
          video(3, PRINCIPAL, brasileiros >= 3),
          video(4, ALTERNATIVO, false),
        ].map((v) => [v.id, v]),
      );
    expect(motivoSemProva([1, 2, 3, 4], quatro(2), AGORA, 7, 0.7, regras)).toBe("só 2 de 4 vídeos citados são do Brasil, precisa de pelo menos 3");
    expect(motivoSemProva([1, 2, 3, 4], quatro(3), AGORA, 7, 0.7, regras)).toBeNull();
  });

  it("marca sem alternativo: o mapa só com o principal dá o mesmo resultado de sem mapa", () => {
    const videos = new Map<number, VideoParaProva>(
      [video(1, PRINCIPAL, true), video(2, PRINCIPAL, false), video(3, PRINCIPAL, false), video(4, PRINCIPAL, true)].map((v) => [v.id, v]),
    );
    const so = new Map<number, RegraDoSetor>([[PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.6 }]]);
    for (const proporcao of [0.3, 0.5, 0.6, 0.7, 1]) {
      const regras = new Map<number, RegraDoSetor>([[PRINCIPAL, { janelaDias: 7, proporcaoBrasil: proporcao }]]);
      expect(motivoSemProva([1, 2, 3, 4], videos, AGORA, 7, proporcao, regras)).toBe(motivoSemProva([1, 2, 3, 4], videos, AGORA, 7, proporcao));
    }
    expect(so.size).toBe(1);
  });

  it("com os brasileiros que a proporção ponderada pede, passa", () => {
    const videos = new Map<number, VideoParaProva>(
      [
        video(1, PRINCIPAL, true),
        video(2, PRINCIPAL, false),
        video(3, PRINCIPAL, false),
        video(4, ALTERNATIVO, true),
        video(5, ALTERNATIVO, true),
        video(6, ALTERNATIVO, false),
      ].map((v) => [v.id, v]),
    );
    const regras = new Map<number, RegraDoSetor>([
      [PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.3 }],
      [ALTERNATIVO, { janelaDias: 7, proporcaoBrasil: 0.7 }],
    ]);
    expect(temaTemProvaSuficiente([1, 2, 3, 4, 5, 6], videos, AGORA, 7, 0.3, regras)).toBe(true);
  });

  it("a janela é a do setor de cada vídeo: um setor novo (14 dias) aceita um vídeo de 10 dias que o setor antigo (7 dias) recusa", () => {
    const videos = new Map<number, VideoParaProva>(
      [video(1, PRINCIPAL, true, 10), video(2, PRINCIPAL, true, 10), video(3, PRINCIPAL, true, 10)].map((v) => [v.id, v]),
    );
    const antigo = new Map<number, RegraDoSetor>([[PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.7 }]]);
    const novo = new Map<number, RegraDoSetor>([[PRINCIPAL, { janelaDias: 14, proporcaoBrasil: 0.7 }]]);

    expect(temaTemProvaSuficiente([1, 2, 3], videos, AGORA, 7, 0.7, antigo)).toBe(false);
    expect(temaTemProvaSuficiente([1, 2, 3], videos, AGORA, 7, 0.7, novo)).toBe(true);
    // E um alternativo de setor novo traz o vídeo dele para dentro da janela mesmo com o principal antigo.
    const misto = new Map<number, VideoParaProva>(
      [video(1, PRINCIPAL, true, 2), video(2, PRINCIPAL, true, 3, 20), video(3, ALTERNATIVO, true, 10, 30)].map((v) => [v.id, v]),
    );
    const regras = new Map<number, RegraDoSetor>([
      [PRINCIPAL, { janelaDias: 7, proporcaoBrasil: 0.7 }],
      [ALTERNATIVO, { janelaDias: 14, proporcaoBrasil: 0.7 }],
    ]);
    expect(temaTemProvaSuficiente([1, 2, 3], misto, AGORA, 7, 0.7, regras)).toBe(true);
    expect(temaTemProvaSuficiente([1, 2, 3], misto, AGORA, 7, 0.7)).toBe(false);
  });

  it("sem o mapa de regras, vídeos de setores diferentes contam como um total só (os temas do dia nunca agrupam por setor)", () => {
    const videos = new Map<number, VideoParaProva>(
      [
        video(1, PRINCIPAL, true),
        video(2, PRINCIPAL, false),
        video(3, PRINCIPAL, false),
        video(4, ALTERNATIVO, true),
        video(5, ALTERNATIVO, false),
        video(6, ALTERNATIVO, false),
      ].map((v) => [v.id, v]),
    );
    // Total 6, proporção 0,3: mínimo ceil(1,8) = 2, e há 2 brasileiros. Por setor seriam 1 + 1 = 2 também, mas com 0,7 o total pede 4 e passaria a ser tratado por grupo.
    expect(temaTemProvaSuficiente([1, 2, 3, 4, 5, 6], videos, AGORA, 7, 0.3)).toBe(true);
    expect(motivoSemProva([1, 2, 3, 4, 5, 6], videos, AGORA, 7, 0.7)).toBe("só 2 de 6 vídeos citados são do Brasil, precisa de pelo menos 4");
  });

  it("sem regras por setor, ou com um vídeo de setor que não está no mapa, vale o par de sempre", () => {
    const videos = new Map<number, VideoParaProva>([video(1, 9, true), video(2, 9, true), video(3, 9, true)].map((v) => [v.id, v]));
    expect(temaTemProvaSuficiente([1, 2, 3], videos, AGORA, 7, 0.7)).toBe(true);
    expect(temaTemProvaSuficiente([1, 2, 3], videos, AGORA, 7, 0.7, new Map())).toBe(true);
  });
});
