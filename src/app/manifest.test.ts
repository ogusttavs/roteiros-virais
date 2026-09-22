/** O manifesto do aplicativo instalado (V7, item 5 do PROXIMO.md). */
import { describe, expect, it } from "vitest";

import { COR_FUNDO_CLARO } from "@/lib/cores-do-aparelho";

import manifest from "./manifest";

describe("manifesto", () => {
  const m = manifest();

  it("instala como aplicativo, abre no Hoje e cobre o site inteiro", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/hoje");
    expect(m.scope).toBe("/");
  });

  it("cores de fundo e de tema vem do tema claro dos tokens", () => {
    expect(m.background_color).toBe(COR_FUNDO_CLARO);
    expect(m.theme_color).toBe(COR_FUNDO_CLARO);
  });

  it("tem nome, idioma e os tres icones (comum, grande e maskable)", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.lang).toBe("pt-BR");
    expect(m.icons?.map((i) => i.src)).toEqual(["/icone-192.png", "/icone-512.png", "/icone-maskable-512.png"]);
    expect(m.icons?.find((i) => i.purpose === "maskable")?.src).toBe("/icone-maskable-512.png");
  });
});
