import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/versao", () => {
  it("devolve so a versao do servidor e nunca fica em cache", async () => {
    const resposta = GET();
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    const corpo = await resposta.json();
    expect(Object.keys(corpo)).toEqual(["versao"]);
    expect(typeof corpo.versao).toBe("string");
  });
});
