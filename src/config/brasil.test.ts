import { describe, expect, it } from "vitest";

import { temIndicioDeBrasil } from "./brasil";

describe("temIndicioDeBrasil", () => {
  it("dez legendas, cinco com indicio de Brasil", () => {
    expect(temIndicioDeBrasil("Dica de limpeza para quem mora em São Paulo #brasil")).toBe(true);
    expect(temIndicioDeBrasil("Produto por 29,90 reais, com nota fiscal e CNPJ direitinho")).toBe(true);
    expect(temIndicioDeBrasil("Ficou muito bom, recomendo demais esse produto, pago no pix")).toBe(true);
    expect(temIndicioDeBrasil("Moro no Rio de Janeiro e recomendo muito esse produto")).toBe(true);
    expect(temIndicioDeBrasil("Dica rápida de organização, adorei", ["organização"])).toBe(true);
  });

  it("dez legendas, cinco sem indicio de Brasil", () => {
    // Ingles, sem nenhuma palavra em portugues.
    expect(temIndicioDeBrasil("Cleaning tips for your home, so satisfying to watch")).toBe(false);
    // Espanhol.
    expect(temIndicioDeBrasil("Consejos de limpieza para tu casa, muy facil de hacer")).toBe(false);
    // Portugues, mas de Portugal (sem nenhum indicio de Brasil).
    expect(temIndicioDeBrasil("Dica de limpeza para quem mora em Lisboa, muito bom")).toBe(false);
    // Portugues generico, nenhuma cidade nem palavra brasileira, nenhum termo do nicho.
    expect(temIndicioDeBrasil("Um vídeo qualquer sobre organização de casa, com dicas")).toBe(false);
    // Sem legenda nenhuma.
    expect(temIndicioDeBrasil("")).toBe(false);
  });

  it("termos do nicho contam como indicio extra (grafia brasileira de termos do nicho)", () => {
    expect(temIndicioDeBrasil("Um vídeo qualquer sobre tira manchas, com dicas", ["tira manchas"])).toBe(true);
    expect(temIndicioDeBrasil("Um vídeo qualquer sobre organização, com dicas", ["tira manchas"])).toBe(false);
  });
});
