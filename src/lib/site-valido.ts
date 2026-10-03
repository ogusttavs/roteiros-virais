/**
 * O site da marca precisa ser um endereço público de verdade (V12c, item 6, a
 * E37b): https, com domínio, nunca localhost nem endereço de rede interna.
 * Entrada maliciosa (SSRF) é a razão de recusar rede interna, não só "parece
 * feio": quem ler o site (E38) não pode ser mandado para a própria rede da
 * VPS. Usado no cliente (validação na hora) e no servidor (`dadosFixosSchema`).
 *
 * A defesa de verdade mora no leitor (`jobs/site-api.ts`: guarda de IP na conexão, porta 443, sem
 * credencial); isto só recusa cedo, com a frase na tela, o que o leitor recusaria de qualquer jeito, e
 * limita o tamanho do que se grava em `clientes.site`.
 */
export const TAMANHO_MAXIMO_DO_SITE = 2048;

const HOST_BLOQUEADO = /^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[)/i;
/** Endereço numérico (a pessoa tem um site com nome, não um IP). */
const ENDERECO_NUMERICO = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Nomes que só existem dentro de uma rede. */
const SUFIXO_DE_REDE_INTERNA = /\.(localhost|local|localdomain|internal|lan|home\.arpa)$/i;

/**
 * O que quase todo mundo digita é "minhaloja.com.br", sem o https://: o endereço sem esquema vira https.
 * Quem escreveu um esquema (http://, javascript:) fica como escreveu, e `siteValido` o recusa.
 */
export function normalizarSite(valor: string): string {
  const aparado = valor.trim();
  if (aparado === "") return "";
  if (aparado.includes("://")) return aparado;
  if (aparado.startsWith("//")) return `https:${aparado}`;
  return `https://${aparado}`;
}

export function siteValido(valor: string): boolean {
  if (valor.length > TAMANHO_MAXIMO_DO_SITE) return false;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Porta e credencial: o leitor só fala https na 443 e nunca com usuário e senha no endereço.
  if (url.port !== "" || url.username !== "" || url.password !== "") return false;
  if (url.hostname.length > 253) return false;
  if (!url.hostname.includes(".")) return false;
  if (HOST_BLOQUEADO.test(url.hostname) || ENDERECO_NUMERICO.test(url.hostname)) return false;
  if (SUFIXO_DE_REDE_INTERNA.test(url.hostname.replace(/\.$/, ""))) return false;
  return true;
}
