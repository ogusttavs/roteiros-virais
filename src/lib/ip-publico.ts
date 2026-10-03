/**
 * Decide se um endereço IP é público, ou seja, se vale a pena o worker conectar
 * nele ao ler o site de uma marca (E38, PR 2). É a peça central da defesa contra
 * SSRF (o servidor ser mandado a buscar algo na própria rede): o leitor de site
 * é o primeiro código do projeto que busca uma URL escolhida por um usuário, e o
 * worker enxerga o `roteiros-postgres`, o `roteiros-pot`, o `roteiros-app`, o
 * gateway da ponte Docker e o endereço de metadados de nuvem (169.254.169.254).
 * Todos esses ficam em faixas privadas, reservadas ou de loopback, que esta lista
 * recusa. Só servidor (usa `node:net`): nunca importar de componente de cliente.
 *
 * Tudo que não é um IP válido (nome de domínio, forma abreviada como "127.1",
 * texto com colchetes ou com zona "%eth0") devolve `false`: na dúvida, recusa.
 * Quem recebe a URL já passou pelo `new URL`, que normaliza "2130706433",
 * "0x7f000001" e "0177.0.0.1" para "127.0.0.1" antes de chegar aqui; os colchetes
 * do IPv6 literal ("[::1]") também são tirados por quem chama.
 *
 * Os mapeamentos de IPv4 dentro de IPv6 ("::ffff:127.0.0.1", "::ffff:a9fe:a9fe")
 * são entendidos pelo `net.BlockList` do Node contra as faixas IPv4; as formas
 * antigas (IPv4 compatível "::7f00:1", "::ffff:0:a.b.c.d") entram como faixas
 * IPv6 de propósito.
 */
import { BlockList, isIP } from "node:net";

/** Faixas IPv4 que nunca são um site público (RFC 6890 e correlatos). */
const FAIXAS_IPV4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * Faixas IPv6. Além das do relatório (`::/128`, `::1/128`, NAT64, `100::/64`,
 * Teredo, documentação, 6to4, ULA, link-local e multicast), entram o IPv4
 * compatível (`::/96`, que também cobre `::` e `::1`), o IPv4 traduzido
 * (`::ffff:0:0:0/96`), a faixa de protocolos da IETF inteira (`2001::/23`, onde
 * moram Teredo, benchmarking e ORCHID), o endereço de documentação novo
 * (`3fff::/20`) e o site-local antigo (`fec0::/10`): nenhuma delas é um site.
 */
const FAIXAS_IPV6: [string, number][] = [
  ["::", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

const listaBloqueio = new BlockList();
for (const [rede, bits] of FAIXAS_IPV4) listaBloqueio.addSubnet(rede, bits, "ipv4");
for (const [rede, bits] of FAIXAS_IPV6) listaBloqueio.addSubnet(rede, bits, "ipv6");

/**
 * `true` só para um IP válido (IPv4, IPv6 ou IPv4 mapeado em IPv6) fora de todas
 * as faixas bloqueadas. `false` para qualquer outra entrada.
 */
export function enderecoEhPublico(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const familia = isIP(ip);
  if (familia === 0) return false;
  if (ip.includes("%")) return false;
  return !listaBloqueio.check(ip, familia === 4 ? "ipv4" : "ipv6");
}
