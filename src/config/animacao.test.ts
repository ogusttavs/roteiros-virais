/**
 * T114: o limite do render da animação cabe no servidor. A conta vem da medição de 26/11/2026 no `roteiros-render` (1 vCPU): a prévia anda uns 0,28 s de vídeo por segundo, então leva uns 3,6 vezes
 * a duração. O limite antigo (3 vezes) derrubava as duas tentativas de um vídeo de 57 s perto de 85%.
 */
import { describe, expect, it } from "vitest";

import { LIMITES_DA_ANIMACAO, limiteDaAnimacaoMs } from "./animacao";

/** O ritmo medido da prévia no servidor: segundos de render por segundo de vídeo. */
const PREVIA_NO_SERVIDOR = 1 / 0.28;
/** A estimativa do final (quatro vezes os pixels; a fase 0 mediu 2,3 vezes mais tempo na resolução cheia). */
const FINAL_NO_SERVIDOR = PREVIA_NO_SERVIDOR * 2.3;

describe("limiteDaAnimacaoMs", () => {
  it("o vídeo do ensaio (57,2 s) cabe com folga: a prévia leva uns 204 s e o limite passa de 1,5 vez isso", () => {
    const precisa = 57.2 * PREVIA_NO_SERVIDOR * 1000;
    expect(precisa).toBeGreaterThan(200_000);
    expect(limiteDaAnimacaoMs("previa", 57.2)).toBe(343_200);
    expect(limiteDaAnimacaoMs("previa", 57.2)).toBeGreaterThan(precisa * 1.5);
  });

  it("o vídeo curto (25 a 35 s) fica no piso de 3 minutos, com folga sobre o que a prévia leva", () => {
    for (const duracao of [10, 25, 30]) expect(limiteDaAnimacaoMs("previa", duracao)).toBe(180_000);
    expect(limiteDaAnimacaoMs("previa", 35)).toBe(210_000);
    for (const duracao of [25, 30, 35]) expect(limiteDaAnimacaoMs("previa", duracao)).toBeGreaterThan(duracao * PREVIA_NO_SERVIDOR * 1000 * 1.5);
  });

  it("o teto da prévia é de 8 minutos e nunca corta o vídeo mais longo que o app monta", () => {
    expect(limiteDaAnimacaoMs("previa", 600)).toBe(480_000);
    expect(limiteDaAnimacaoMs("previa", LIMITES_DA_ANIMACAO.duracaoMaximaTotalS)).toBe(360_000);
  });

  it("o final também cabe: 12 vezes a duração, piso de 3 minutos e teto de 15", () => {
    expect(limiteDaAnimacaoMs("final", 57.2)).toBe(686_400);
    expect(limiteDaAnimacaoMs("final", 57.2)).toBeGreaterThan(57.2 * FINAL_NO_SERVIDOR * 1000 * 1.4);
    expect(limiteDaAnimacaoMs("final", 10)).toBe(180_000);
    expect(limiteDaAnimacaoMs("final", 600)).toBe(900_000);
  });
});
