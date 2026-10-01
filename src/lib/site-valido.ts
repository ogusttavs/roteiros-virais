/**
 * O site da marca precisa ser um endereço público de verdade (V12c, item 6, a
 * E37b): https, com domínio, nunca localhost nem endereço de rede interna.
 * Entrada maliciosa (SSRF) é a razão de recusar rede interna, não só "parece
 * feio": quem ler o site (E38) não pode ser mandado para a própria rede da
 * VPS. Usado no cliente (validação na hora) e no servidor (`dadosFixosSchema`).
 */
const HOST_BLOQUEADO = /^(localhost|127\.|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[?::1\]?)/i;

export function siteValido(valor: string): boolean {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!url.hostname.includes(".")) return false;
  if (HOST_BLOQUEADO.test(url.hostname)) return false;
  return true;
}
