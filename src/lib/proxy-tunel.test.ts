import { describe, expect, it } from "vitest";

import { proxyEhTunel } from "./proxy-tunel";

describe("proxyEhTunel", () => {
  it("só o endereço SOCKS5 do computador visto de dentro do Docker é o túnel", () => {
    expect(proxyEhTunel("socks5://172.19.0.1:1080")).toBe(true);
    expect(proxyEhTunel("  SOCKS5://172.17.0.1:1080")).toBe(true);
  });

  it("um proxy de fornecedor, vazio ou ausente não é o túnel", () => {
    expect(proxyEhTunel("http://usuario:senha@proxy.exemplo.teste:823")).toBe(false);
    expect(proxyEhTunel("socks5://proxy.exemplo.teste:1080")).toBe(false);
    expect(proxyEhTunel("")).toBe(false);
    expect(proxyEhTunel(undefined as unknown as string)).toBe(false);
  });
});
