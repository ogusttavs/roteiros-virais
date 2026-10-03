import { describe, expect, it } from "vitest";

import { regraDaCapsula } from "./useRolagem";

const MAX = 2000;

function rolar(regra: ReturnType<typeof regraDaCapsula>, posicoes: number[], max = MAX) {
  let estado = regra(posicoes[0]!, max);
  for (const y of posicoes.slice(1)) estado = regra(y, max);
  return estado;
}

describe("regraDaCapsula (passo 16)", () => {
  it("começa cheia e continua cheia perto do topo", () => {
    const regra = regraDaCapsula();
    expect(rolar(regra, [0, 10, 30, 55, 60])).toBe("cheia");
  });

  it("encolhe ao descer de propósito além de 60 px", () => {
    const regra = regraDaCapsula();
    expect(rolar(regra, [0, 30, 60, 70, 90])).toBe("encolhida");
  });

  it("o dedo que treme (2 px para baixo, 2 para cima) não encolhe", () => {
    const regra = regraDaCapsula("cheia", 100);
    expect(rolar(regra, [100, 102, 100, 102, 100, 102, 100])).toBe("cheia");
  });

  it("fica encolhida ao soltar o dedo (rolagem parada) e na inércia que perde velocidade", () => {
    const regra = regraDaCapsula();
    rolar(regra, [0, 50, 100, 150]);
    expect(rolar(regra, [150, 150, 150, 151, 151])).toBe("encolhida");
  });

  it("o quique além do fim ou do topo não conta", () => {
    const regra = regraDaCapsula();
    rolar(regra, [0, 100, 300]);
    expect(rolar(regra, [MAX + 40, MAX + 10])).toBe("encolhida");
    expect(regra(-30, MAX)).toBe("encolhida");
  });

  it("abre com 40 px de subida no mesmo gesto, não antes", () => {
    const regra = regraDaCapsula();
    rolar(regra, [0, 100, 300, 500]);
    expect(rolar(regra, [490, 480, 470, 461])).toBe("encolhida");
    expect(rolar(regra, [455, 459, 440, 420])).toBe("cheia");
  });

  it("trocar de sentido zera a soma da subida", () => {
    const regra = regraDaCapsula();
    rolar(regra, [0, 100, 300, 500]);
    // sobe 30, desce 5, sobe 30: nenhuma subida chega a 40 sozinha
    expect(rolar(regra, [470, 475, 445])).toBe("encolhida");
  });

  it("no fim da página (a menos de 2 px do fim) subir pouco não abre, e subir 40 px de propósito abre", () => {
    const regra = regraDaCapsula();
    rolar(regra, [0, 100, 1000, MAX]);
    expect(regra(MAX - 1, MAX)).toBe("encolhida");
    expect(rolar(regra, [MAX - 20, MAX - 30])).toBe("encolhida");
    expect(rolar(regra, [MAX - 60, MAX - 80])).toBe("cheia");
  });

  it("abre sempre a menos de 20 px do topo", () => {
    const regra = regraDaCapsula();
    rolar(regra, [0, 100, 300]);
    expect(regra(10, MAX)).toBe("cheia");
  });

  it("estado e posição iniciais: abrir() recomeça sem encolher pelo salto", () => {
    const regra = regraDaCapsula("cheia", 800);
    expect(regra(800, MAX)).toBe("cheia");
    expect(regra(805, MAX)).toBe("cheia");
    expect(regra(830, MAX)).toBe("encolhida");
  });
});
