/**
 * Cliente fino do Apify (etapa 6, parte 2): achados travados aqui.
 * `maxItems` da chamada ao ator so limita quanto e cobrado, nao quanto o
 * dataset devolve (pediu 20, o dataset trouxe mais), por isso `rodarAtor`
 * corta o resultado mas devolve `devolvidos` (o bruto) ao lado. Hashtag com
 * espaco (um termo composto, "lente de contato dental") nao existe de
 * verdade em nenhuma das duas plataformas. `limitePorAlvo` (E6 parte 2)
 * dividia o teto pelo numero de alvos; a busca por hashtag do TikTok (E6
 * parte 3, terceira rodada, item 1) nao usa mais essa divisao, passou a
 * `RESULTADOS_POR_TERMO_HASHTAG` fixo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const actorCall = vi.fn();
const datasetListItems = vi.fn();

vi.mock("apify-client", () => ({
  // `new ApifyClient(...)` precisa de uma funcao construtora de verdade;
  // uma arrow function nao pode ser instanciada com `new` (mesmo achado do
  // mock do rss-parser na etapa 6, parte 1).
  ApifyClient: vi.fn().mockImplementation(function ApifyClientFalso(this: {
    actor: () => { call: typeof actorCall };
    dataset: () => { listItems: typeof datasetListItems };
  }) {
    this.actor = () => ({ call: actorCall });
    this.dataset = () => ({ listItems: datasetListItems });
  }),
}));

import {
  buscarInstagram,
  buscarTiktokPorHashtag,
  buscarTiktokVigilancia,
  limitePorAlvo,
  rodarAtor,
} from "./apify-api";

beforeEach(() => {
  actorCall.mockReset().mockResolvedValue({ defaultDatasetId: "ds1" });
  datasetListItems.mockReset().mockResolvedValue({ items: [] });
});

describe("limitePorAlvo", () => {
  it("divide o teto pelo numero de alvos, arredondando para cima (8 termos, teto 400, 50 por termo)", () => {
    expect(limitePorAlvo(400, 8)).toBe(50);
  });

  it("arredonda para cima quando a divisao nao e exata (3 termos, teto 100, 34 por termo)", () => {
    expect(limitePorAlvo(100, 3)).toBe(34);
  });

  it("sem alvo, devolve o teto inteiro (nada para dividir)", () => {
    expect(limitePorAlvo(400, 0)).toBe(400);
  });
});

describe("rodarAtor", () => {
  it("corta o dataset em maxItems, mesmo se o ator devolver mais, e devolve o bruto em devolvidos", async () => {
    datasetListItems.mockResolvedValue({ items: [1, 2, 3, 4, 5] });
    const { itens, devolvidos } = await rodarAtor("algum/ator", {}, 3);
    expect(itens).toEqual([1, 2, 3]);
    expect(devolvidos).toBe(5);
  });
});

describe("buscarTiktokPorHashtag", () => {
  it("tira espaco dos termos antes de mandar como hashtag", async () => {
    await buscarTiktokPorHashtag(["lente de contato dental", "dentista"], 60);
    expect(actorCall).toHaveBeenCalledWith(
      expect.objectContaining({ hashtags: ["lentedecontatodental", "dentista"] }),
      { maxItems: 60 },
    );
  });

  it("resultsPerPage e fixo em 30 por termo, nao dividido pelo numero de termos (item 1)", async () => {
    await buscarTiktokPorHashtag(["dentista", "odontologia", "implante"], 90);
    expect(actorCall).toHaveBeenCalledWith(expect.objectContaining({ resultsPerPage: 30 }), { maxItems: 90 });
  });

  it("filtra so a semana (oldestPostDateUnified relativo, item 1)", async () => {
    await buscarTiktokPorHashtag(["dentista"], 30);
    expect(actorCall).toHaveBeenCalledWith(expect.objectContaining({ oldestPostDateUnified: "7 days" }), {
      maxItems: 30,
    });
  });

  it("sem termo, nao chama o ator", async () => {
    const { itens, devolvidos } = await buscarTiktokPorHashtag([], 30);
    expect(itens).toEqual([]);
    expect(devolvidos).toBe(0);
    expect(actorCall).not.toHaveBeenCalled();
  });
});

describe("buscarTiktokVigilancia", () => {
  it("resultsPerPage e o videosPorPerfil pedido, mais recentes primeiro (item 3)", async () => {
    await buscarTiktokVigilancia(["conta_a", "conta_b"], 5, 10);
    expect(actorCall).toHaveBeenCalledWith(
      expect.objectContaining({ profiles: ["conta_a", "conta_b"], resultsPerPage: 5, profileSorting: "latest" }),
      { maxItems: 10 },
    );
  });

  it("catch-up de conta nova pede mais videos por perfil que a vigilancia diaria (contas-base.ts, VIDEOS_POR_CONTA)", async () => {
    await buscarTiktokVigilancia(["conta_nova"], 10, 10);
    expect(actorCall).toHaveBeenCalledWith(expect.objectContaining({ resultsPerPage: 10 }), { maxItems: 10 });
  });

  it("sem perfil vigiado, nao chama o ator", async () => {
    const { itens, devolvidos } = await buscarTiktokVigilancia([], 5, 10);
    expect(itens).toEqual([]);
    expect(devolvidos).toBe(0);
    expect(actorCall).not.toHaveBeenCalled();
  });
});

describe("buscarInstagram", () => {
  it("tira espaco do termo na url da hashtag", async () => {
    await buscarInstagram(["dor de dente"], [], 10);
    expect(actorCall).toHaveBeenCalledWith(
      expect.objectContaining({ directUrls: ["https://www.instagram.com/explore/tags/dordedente/"] }),
      { maxItems: 10 },
    );
  });

  it("sem hashtag nem perfil, nao chama o ator", async () => {
    const { itens, devolvidos } = await buscarInstagram([], [], 10);
    expect(itens).toEqual([]);
    expect(devolvidos).toBe(0);
    expect(actorCall).not.toHaveBeenCalled();
  });
});
