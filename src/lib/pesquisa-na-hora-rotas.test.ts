import { describe, expect, it } from "vitest";

import type { DestinoDaPesquisa } from "@/db/schema";

import { enderecoDoObjetivo, enderecoParaMudarOPedido } from "./pesquisa-na-hora-rotas";

type Objetivo = Extract<DestinoDaPesquisa, { tipo: "objetivo" }>;
const livre = (consulta: Objetivo["consulta"]): Objetivo => ({ tipo: "objetivo", consulta });

describe("enderecoDoObjetivo", () => {
  it("o tema livre sozinho", () => {
    expect(enderecoDoObjetivo(livre({ livre: "o preço subiu" }))).toBe("/criar/objetivo?livre=o+pre%C3%A7o+subiu");
  });

  it("com a pesquisa, o id vai junto", () => {
    expect(enderecoDoObjetivo(livre({ livre: "o preço subiu" }), 7)).toBe("/criar/objetivo?livre=o+pre%C3%A7o+subiu&pesquisa=7");
  });

  it("leva tudo o que veio preso ao tema, e o dia por último", () => {
    const destino = livre({ livre: "x", alta: "frente fria", noticiaId: "4", noticiaAssuntoId: "9", pergunta: "a1b2c3d4e5f6", data: "2026-10-20" });
    expect(enderecoDoObjetivo(destino, 3)).toBe("/criar/objetivo?livre=x&alta=frente+fria&noticiaId=4&noticiaAssuntoId=9&pergunta=a1b2c3d4e5f6&pesquisa=3&data=2026-10-20");
  });
});

describe("enderecoParaMudarOPedido", () => {
  it("o Tema livre volta com o texto (que vence o rascunho) e o que estava preso", () => {
    expect(enderecoParaMudarOPedido(livre({ livre: "o preço subiu", data: "2026-10-20", alta: "a b" }))).toBe("/criar/tema-livre?tema=o+pre%C3%A7o+subiu&alta=a+b&data=2026-10-20");
  });

  it("leva a notícia, o assunto da marca e a pergunta que estavam presos ao tema (senão o Tema livre abre comum)", () => {
    expect(enderecoParaMudarOPedido(livre({ livre: "x", noticiaId: "4", noticiaAssuntoId: "9", pergunta: "a1b2c3d4e5f6" }))).toBe(
      "/criar/tema-livre?tema=x&noticiaId=4&noticiaAssuntoId=9&pergunta=a1b2c3d4e5f6",
    );
  });

  it("o momento e o que não tem destino voltam ao Criar", () => {
    expect(enderecoParaMudarOPedido({ tipo: "momento", dados: { onde: "a", oQueEstaAcontecendo: "b", oQueDaParaMostrar: "c", objetivo: "alcance" } })).toBe("/criar");
    expect(enderecoParaMudarOPedido(null)).toBe("/criar");
  });
});
