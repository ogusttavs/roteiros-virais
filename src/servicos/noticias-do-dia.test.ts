import { describe, expect, it } from "vitest";

import { compararParaACapa } from "./noticias-do-dia";

const item = (veiculo: string, iso: string) => ({ noticia: { veiculo }, quando: new Date(iso) });

describe("a ordem da capa", () => {
  it("a mais nova vem primeiro quando a diferença passa do bloco de 30 minutos", () => {
    const lista = [item("G1", "2026-11-25T10:00:00Z"), item("Blog", "2026-11-25T11:10:00Z")];
    expect([...lista].sort(compararParaACapa).map((i) => i.noticia.veiculo)).toEqual(["Blog", "G1"]);
  });

  it("no mesmo bloco de 30 minutos, o veículo conhecido ganha o desempate", () => {
    const lista = [item("Blog", "2026-11-25T11:20:00Z"), item("G1", "2026-11-25T11:05:00Z")];
    expect([...lista].sort(compararParaACapa).map((i) => i.noticia.veiculo)).toEqual(["G1", "Blog"]);
  });

  it("dois do mesmo peso no mesmo bloco ficam pela hora", () => {
    const lista = [item("G1", "2026-11-25T11:05:00Z"), item("UOL", "2026-11-25T11:20:00Z")];
    expect([...lista].sort(compararParaACapa).map((i) => i.noticia.veiculo)).toEqual(["UOL", "G1"]);
  });
});
