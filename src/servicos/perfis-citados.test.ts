import { describe, expect, it } from "vitest";

import { formatarPerfilComArroba } from "./perfis-citados";

describe("formatarPerfilComArroba (V12c, item 8, a E37b)", () => {
  it("instagram e tiktok ganham @ na frente (o handle guardado nunca tem)", () => {
    expect(formatarPerfilComArroba({ rede: "instagram", handle: "limpatudoexpress" })).toBe(
      "@limpatudoexpress (instagram)",
    );
    expect(formatarPerfilComArroba({ rede: "tiktok", handle: "arrumadeiraprofissional" })).toBe(
      "@arrumadeiraprofissional (tiktok)",
    );
  });

  it("youtube ja guarda com @, nao dobra", () => {
    expect(formatarPerfilComArroba({ rede: "youtube", handle: "@canalreferencia" })).toBe(
      "@canalreferencia (youtube)",
    );
  });
});
