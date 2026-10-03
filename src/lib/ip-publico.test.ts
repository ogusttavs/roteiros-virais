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

/**
 * Um teste dirigido pelos DADOS: cada faixa bloqueada, com o primeiro e o último endereço dela
 * (que não podem ser públicos) e o endereço imediatamente antes e imediatamente depois (que
 * precisam ser públicos, a não ser que sejam vizinhos de outra faixa bloqueada, caso em que a
 * tabela tem `null`). Os números estão escritos à mão, um por um, de propósito: se esta tabela
 * fosse calculada a partir das mesmas constantes do código, um erro de prefixo (10.0.0.0/8
 * escrito como /9, 192.168.0.0/16 como /17) passaria despercebido nos dois lados. A revisão
 * provou isso: com a tabela antiga, todas essas mutações sobreviviam.
 */
type Faixa = {
  rede: string;
  primeiro: string;
  ultimo: string;
  antes: string | null;
  depois: string | null;
};

const FAIXAS_V4_ESPERADAS: Faixa[] = [
  {
    rede: "0.0.0.0/8",
    primeiro: "0.0.0.0",
    ultimo: "0.255.255.255",
    antes: null,
    depois: "1.0.0.0",
  },
  {
    rede: "10.0.0.0/8",
    primeiro: "10.0.0.0",
    ultimo: "10.255.255.255",
    antes: "9.255.255.255",
    depois: "11.0.0.0",
  },
  {
    rede: "100.64.0.0/10",
    primeiro: "100.64.0.0",
    ultimo: "100.127.255.255",
    antes: "100.63.255.255",
    depois: "100.128.0.0",
  },
  {
    rede: "127.0.0.0/8",
    primeiro: "127.0.0.0",
    ultimo: "127.255.255.255",
    antes: "126.255.255.255",
    depois: "128.0.0.0",
  },
  {
    rede: "169.254.0.0/16",
    primeiro: "169.254.0.0",
    ultimo: "169.254.255.255",
    antes: "169.253.255.255",
    depois: "169.255.0.0",
  },
  {
    rede: "172.16.0.0/12",
    primeiro: "172.16.0.0",
    ultimo: "172.31.255.255",
    antes: "172.15.255.255",
    depois: "172.32.0.0",
  },
  {
    rede: "192.0.0.0/24",
    primeiro: "192.0.0.0",
    ultimo: "192.0.0.255",
    antes: "191.255.255.255",
    depois: "192.0.1.0",
  },
  {
    rede: "192.0.2.0/24",
    primeiro: "192.0.2.0",
    ultimo: "192.0.2.255",
    antes: "192.0.1.255",
    depois: "192.0.3.0",
  },
  {
    rede: "192.88.99.0/24",
    primeiro: "192.88.99.0",
    ultimo: "192.88.99.255",
    antes: "192.88.98.255",
    depois: "192.88.100.0",
  },
  {
    rede: "192.168.0.0/16",
    primeiro: "192.168.0.0",
    ultimo: "192.168.255.255",
    antes: "192.167.255.255",
    depois: "192.169.0.0",
  },
  {
    rede: "198.18.0.0/15",
    primeiro: "198.18.0.0",
    ultimo: "198.19.255.255",
    antes: "198.17.255.255",
    depois: "198.20.0.0",
  },
  {
    rede: "198.51.100.0/24",
    primeiro: "198.51.100.0",
    ultimo: "198.51.100.255",
    antes: "198.51.99.255",
    depois: "198.51.101.0",
  },
  {
    rede: "203.0.113.0/24",
    primeiro: "203.0.113.0",
    ultimo: "203.0.113.255",
    antes: "203.0.112.255",
    depois: "203.0.114.0",
  },
  {
    rede: "224.0.0.0/4",
    primeiro: "224.0.0.0",
    ultimo: "239.255.255.255",
    antes: "223.255.255.255",
    depois: null,
  },
  {
    rede: "240.0.0.0/4",
    primeiro: "240.0.0.0",
    ultimo: "255.255.255.255",
    antes: null,
    depois: null,
  },
];

const FAIXAS_V6_ESPERADAS: Faixa[] = [
  { rede: "::/96", primeiro: "::", ultimo: "::ffff:ffff", antes: null, depois: "::1:0:0" },
  {
    rede: "::ffff:0:0:0/96",
    primeiro: "::ffff:0:0:0",
    ultimo: "::ffff:0:ffff:ffff",
    antes: "::fffe:ffff:ffff:ffff",
    depois: "::ffff:1:0:0",
  },
  {
    rede: "64:ff9b::/96",
    primeiro: "64:ff9b::",
    ultimo: "64:ff9b::ffff:ffff",
    antes: "64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "64:ff9b::1:0:0",
  },
  {
    rede: "64:ff9b:1::/48",
    primeiro: "64:ff9b:1::",
    ultimo: "64:ff9b:1:ffff:ffff:ffff:ffff:ffff",
    antes: "64:ff9b:0:ffff:ffff:ffff:ffff:ffff",
    depois: "64:ff9b:2::",
  },
  {
    rede: "100::/64",
    primeiro: "100::",
    ultimo: "100::ffff:ffff:ffff:ffff",
    antes: "ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "100:0:0:1::",
  },
  {
    rede: "2001::/23",
    primeiro: "2001::",
    ultimo: "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: "2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "2001:200::",
  },
  {
    rede: "2001:db8::/32",
    primeiro: "2001:db8::",
    ultimo: "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: "2001:db7:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "2001:db9::",
  },
  {
    rede: "2002::/16",
    primeiro: "2002::",
    ultimo: "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: "2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "2003::",
  },
  {
    rede: "3fff::/20",
    primeiro: "3fff::",
    ultimo: "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: "3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "3fff:1000::",
  },
  {
    rede: "fc00::/7",
    primeiro: "fc00::",
    ultimo: "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: "fe00::",
  },
  {
    rede: "fe80::/10",
    primeiro: "fe80::",
    ultimo: "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: "fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    depois: null,
  },
  {
    rede: "fec0::/10",
    primeiro: "fec0::",
    ultimo: "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: null,
    depois: null,
  },
  {
    rede: "ff00::/8",
    primeiro: "ff00::",
    ultimo: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    antes: null,
    depois: null,
  },
];

describe("enderecoEhPublico, dirigido pelos dados: o tamanho exato de cada faixa", () => {
  it("a tabela tem 15 faixas IPv4 e 13 IPv6 (se o codigo ganhar uma faixa, a tabela precisa ganhar uma linha)", () => {
    expect(FAIXAS_V4_ESPERADAS).toHaveLength(15);
    expect(FAIXAS_V6_ESPERADAS).toHaveLength(13);
  });

  it.each(FAIXAS_V4_ESPERADAS)(
    "IPv4 $rede: primeiro e ultimo nao sao publicos; o vizinho de fora e publico",
    ({ primeiro, ultimo, antes, depois }) => {
      expect(enderecoEhPublico(primeiro), `primeiro ${primeiro}`).toBe(false);
      expect(enderecoEhPublico(ultimo), `ultimo ${ultimo}`).toBe(false);
      if (antes !== null) expect(enderecoEhPublico(antes), `antes ${antes}`).toBe(true);
      if (depois !== null) expect(enderecoEhPublico(depois), `depois ${depois}`).toBe(true);
    },
  );

  it.each(FAIXAS_V4_ESPERADAS)(
    "IPv4 $rede dentro de IPv6 (mapeado): vale o mesmo, nas duas bordas e nos vizinhos",
    ({ primeiro, ultimo, antes, depois }) => {
      expect(enderecoEhPublico(`::ffff:${primeiro}`), `primeiro ::ffff:${primeiro}`).toBe(false);
      expect(enderecoEhPublico(`::ffff:${ultimo}`), `ultimo ::ffff:${ultimo}`).toBe(false);
      if (antes !== null)
        expect(enderecoEhPublico(`::ffff:${antes}`), `antes ::ffff:${antes}`).toBe(true);
      if (depois !== null)
        expect(enderecoEhPublico(`::ffff:${depois}`), `depois ::ffff:${depois}`).toBe(true);
    },
  );

  it.each(FAIXAS_V6_ESPERADAS)(
    "IPv6 $rede: primeiro e ultimo nao sao publicos; o vizinho de fora e publico",
    ({ primeiro, ultimo, antes, depois }) => {
      expect(enderecoEhPublico(primeiro), `primeiro ${primeiro}`).toBe(false);
      expect(enderecoEhPublico(ultimo), `ultimo ${ultimo}`).toBe(false);
      if (antes !== null) expect(enderecoEhPublico(antes), `antes ${antes}`).toBe(true);
      if (depois !== null) expect(enderecoEhPublico(depois), `depois ${depois}`).toBe(true);
    },
  );

  it("os pontos do meio de cada faixa tambem sao recusados (nenhuma faixa tem buraco)", () => {
    for (const faixa of [
      "10.128.0.1",
      "10.200.200.200",
      "172.20.0.1",
      "192.168.128.1",
      "198.19.0.1",
      "100.100.0.1",
      "127.128.0.1",
      "169.254.128.1",
      "233.252.0.1",
      "fd12:3456:789a::1",
      "fe90::1",
      "fedd::1",
      "ff02::fb",
      "2002:c0a8:1::1",
      "2001:100::1",
      "3fff:800::1",
    ]) {
      expect(enderecoEhPublico(faixa), faixa).toBe(false);
    }
  });
});
