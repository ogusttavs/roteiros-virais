/**
 * Os pedaços do aviso por push que não dependem do navegador (E48 PR 2): a chave pública VAPID vira os bytes que o `pushManager.subscribe` pede.
 */
import { describe, expect, it } from "vitest";

import { chaveParaBytes } from "./push";

describe("chaveParaBytes", () => {
  it("decodifica a chave pública no formato de URL (base64 com - e _, sem preenchimento) nos 65 bytes de uma chave P-256", () => {
    const bytes = chaveParaBytes("BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U");

    expect(bytes.length).toBe(65);
    // Uma chave pública P-256 sem compressão começa com 0x04.
    expect(bytes[0]).toBe(0x04);
  });

  it("aceita preenchimento ausente e troca - e _ pelos caracteres do base64 comum", () => {
    expect(Array.from(chaveParaBytes("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(chaveParaBytes("AQID"))).toEqual([1, 2, 3]);
  });
});
