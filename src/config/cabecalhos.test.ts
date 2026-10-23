import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("cabeçalhos do app (next.config.ts)", () => {
  it("a página do código de redefinição de senha sai com Referrer-Policy: no-referrer", async () => {
    const regras = (await nextConfig.headers?.()) ?? [];
    const regra = regras.find((r) => r.source.startsWith("/redefinir-senha"));
    expect(regra?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
  });

  it("o service worker continua sem cache por tempo", async () => {
    const regras = (await nextConfig.headers?.()) ?? [];
    expect(regras.find((r) => r.source === "/sw.js")?.headers).toContainEqual({ key: "Cache-Control", value: "no-cache" });
  });
});
