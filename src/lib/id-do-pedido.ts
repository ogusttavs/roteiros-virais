/**
 * E74 PR 2a: o id do pedido de geração, gerado pelo navegador ao tocar em "Escrever" (R-a) e conferido pelo servidor. Sem nada de servidor aqui: a tela e o serviço usam o mesmo arquivo.
 */

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** O id quando é um uuid (em minúsculas); `null` para qualquer outra coisa que chegue do navegador. */
export function idDePedidoOuNulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const id = valor.trim().toLowerCase();
  return FORMATO_UUID.test(id) ? id : null;
}

/** Um id novo. `crypto.randomUUID` só existe em página segura (https ou localhost); fora dela, o mesmo formato montado com `getRandomValues`. */
export function novoIdDePedido(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
