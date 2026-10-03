import { describe, expect, it } from "vitest";

import { enderecoEhPublico } from "./ip-publico";

/** Forma que o WHATWG URL entrega em `hostname` para um IP escrito de outro jeito, já sem colchetes. */
function hostnameDeIp(escrito: string): string {
  const host = new URL(`https://${escrito}/`).hostname;
  return host.replace(/^\[|\]$/g, "");
}

describe("enderecoEhPublico", () => {
  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["172.32.0.1"],
    ["172.15.255.255"],
    ["100.63.255.255"],
    ["100.128.0.1"],
    ["169.253.0.1"],
    ["179.199.142.54"],
    ["2606:4700:4700::1111"],
    ["2001:4860:4860::8888"],
    ["2a00:1450:4001:81b::200e"],
    ["::ffff:8.8.8.8"],
    ["::ffff:808:808"],
  ])("%s e publico", (ip) => {
    expect(enderecoEhPublico(ip)).toBe(true);
  });

  it.each([
    ["127.0.0.1"],
    ["127.255.255.254"],
    ["0.0.0.0"],
    ["0.1.2.3"],
    ["10.1.2.3"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.0.10"],
    ["169.254.169.254"],
    ["169.254.0.1"],
    ["100.64.0.1"],
    ["100.100.100.200"],
    ["192.0.0.192"],
    ["192.0.2.1"],
    ["198.18.0.1"],
    ["198.51.100.7"],
    ["203.0.113.9"],
    ["224.0.0.1"],
    ["239.255.255.250"],
    ["240.0.0.1"],
    ["255.255.255.255"],
    ["::1"],
    ["::"],
    ["fe80::1"],
    ["febf::1"],
    ["fd00::1"],
    ["fc00::1"],
    ["ff02::1"],
    ["::ffff:127.0.0.1"],
    ["::ffff:7f00:1"],
    ["::ffff:a9fe:a9fe"],
    ["::ffff:10.0.0.1"],
    ["::ffff:192.168.1.1"],
    ["64:ff9b::7f00:1"],
    ["64:ff9b::808:808"],
    ["64:ff9b:1::1"],
    ["100::1"],
    ["2001::1"],
    ["2001:db8::1"],
    ["2002:7f00:1::"],
    ["::127.0.0.1"],
    ["::7f00:1"],
    ["::ffff:0:127.0.0.1"],
    ["3fff::1"],
    ["fec0::1"],
  ])("%s nao e publico", (ip) => {
    expect(enderecoEhPublico(ip)).toBe(false);
  });

  it("recusa o que nao e um IP valido", () => {
    for (const entrada of [
      "",
      " ",
      "exemplo.com.br",
      "localhost",
      "127.1",
      "127.0.0",
      "0x7f.0.0.1",
      "0177.0.0.1",
      "2130706433",
      "999.1.1.1",
      "1.2.3.4.5",
      "[::1]",
      "::1%lo",
      "fe80::1%eth0",
      " 8.8.8.8",
      "8.8.8.8 ",
      "8.8.8.8/32",
      "8.8.8.8:443",
    ]) {
      expect(enderecoEhPublico(entrada), `entrada: "${entrada}"`).toBe(false);
    }
  });

  it("recusa entrada que nao e texto", () => {
    expect(enderecoEhPublico(undefined as unknown as string)).toBe(false);
    expect(enderecoEhPublico(null as unknown as string)).toBe(false);
    expect(enderecoEhPublico(127 as unknown as string)).toBe(false);
  });

  it("formas decimal, hexadecimal e octal, depois de normalizadas pelo URL, caem no loopback", () => {
    for (const escrito of [
      "2130706433",
      "0x7f000001",
      "0177.0.0.1",
      "127.1",
      "0x7f.1",
      "017700000001",
    ]) {
      const normalizado = hostnameDeIp(escrito);
      expect(normalizado, escrito).toBe("127.0.0.1");
      expect(enderecoEhPublico(normalizado), escrito).toBe(false);
    }
  });

  it("a forma decimal ou hexadecimal do endereco de metadados de nuvem tambem cai", () => {
    for (const escrito of ["2852039166", "0xa9fea9fe", "0251.0376.0251.0376"]) {
      const normalizado = hostnameDeIp(escrito);
      expect(normalizado, escrito).toBe("169.254.169.254");
      expect(enderecoEhPublico(normalizado), escrito).toBe(false);
    }
  });

  it("IPv6 mapeado escrito com ponto, depois do URL, continua recusado", () => {
    const normalizado = hostnameDeIp("[::ffff:127.0.0.1]");
    expect(normalizado).toBe("::ffff:7f00:1");
    expect(enderecoEhPublico(normalizado)).toBe(false);
    expect(enderecoEhPublico(hostnameDeIp("[::ffff:169.254.169.254]"))).toBe(false);
    expect(enderecoEhPublico(hostnameDeIp("[::ffff:8.8.8.8]"))).toBe(true);
  });

  it("as bordas das faixas de 172.16.0.0/12 e 100.64.0.0/10", () => {
    expect(enderecoEhPublico("172.15.255.255")).toBe(true);
    expect(enderecoEhPublico("172.16.0.0")).toBe(false);
    expect(enderecoEhPublico("172.31.255.255")).toBe(false);
    expect(enderecoEhPublico("172.32.0.0")).toBe(true);
    expect(enderecoEhPublico("100.63.255.255")).toBe(true);
    expect(enderecoEhPublico("100.64.0.0")).toBe(false);
    expect(enderecoEhPublico("100.127.255.255")).toBe(false);
    expect(enderecoEhPublico("100.128.0.0")).toBe(true);
  });
});
