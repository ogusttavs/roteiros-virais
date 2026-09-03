/**
 * Cliente fino do Apify (etapa 6, parte 2): dois achados rodando com chave
 * real travados aqui. `maxItems` da chamada ao ator so limita quanto e
 * cobrado, nao quanto o dataset devolve (pediu 20, o dataset trouxe mais),
 * por isso `rodarAtor` corta o resultado. E hashtag com espaco (um termo
 * composto, "lente de contato dental") nao existe de verdade em nenhuma das
 * duas plataformas.
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

import { buscarInstagram, buscarTiktok, rodarAtor } from "./apify-api";

beforeEach(() => {
  actorCall.mockReset().mockResolvedValue({ defaultDatasetId: "ds1" });
  datasetListItems.mockReset().mockResolvedValue({ items: [] });
});

describe("rodarAtor", () => {
  it("corta o dataset em maxItems, mesmo se o ator devolver mais", async () => {
    datasetListItems.mockResolvedValue({ items: [1, 2, 3, 4, 5] });
    const itens = await rodarAtor("algum/ator", {}, 3);
    expect(itens).toEqual([1, 2, 3]);
  });
});

describe("buscarTiktok", () => {
  it("tira espaco dos termos antes de mandar como hashtag", async () => {
    await buscarTiktok(["lente de contato dental", "dentista"], [], 10);
    expect(actorCall).toHaveBeenCalledWith(
      expect.objectContaining({ hashtags: ["lentedecontatodental", "dentista"] }),
      { maxItems: 10 },
    );
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
    const itens = await buscarInstagram([], [], 10);
    expect(itens).toEqual([]);
    expect(actorCall).not.toHaveBeenCalled();
  });
});
