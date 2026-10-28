import { describe, expect, it } from "vitest";

import { calcularEnergia, calcularEnergiaDeS16le } from "./energia";

const TAXA = 16000;

/** 500 Hz: ciclo inteiro dentro de cada janela de 10 ms, para o RMS bater com a teoria. */
function seno(segundos: number, amplitude: number): Int16Array {
  const n = Math.round(segundos * TAXA);
  const saida = new Int16Array(n);
  for (let i = 0; i < n; i++)
    saida[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 500 * i) / TAXA));
  return saida;
}

describe("calcularEnergia", () => {
  it("uma janela a cada 10 ms e duracao real", () => {
    const e = calcularEnergia(new Int16Array(TAXA * 2 + 50), TAXA);
    expect(e.db.length).toBe(200); // os 50 do fim nao completam uma janela
    expect(e.duracao).toBeCloseTo(2 + 50 / TAXA, 9);
  });

  it("silencio digital fica muito abaixo de qualquer fala", () => {
    const e = calcularEnergia(new Int16Array(TAXA), TAXA);
    expect(Math.max(...e.db)).toBeLessThan(-150);
    expect(Number.isFinite(e.db[0])).toBe(true);
  });

  it("seno de amplitude A tem RMS A/raiz(2): 20 log10(A / 32768 / raiz 2)", () => {
    const e = calcularEnergia(seno(1, 16384), TAXA);
    const esperado = 20 * Math.log10(16384 / 32768 / Math.SQRT2); // cerca de -9 dB
    for (const v of e.db) expect(v).toBeCloseTo(esperado, 1);
  });

  it("acompanha o que muda: silencio, fala, silencio", () => {
    const fala = seno(1, 8000);
    const pcm = new Int16Array(TAXA * 3);
    pcm.set(fala, TAXA);
    const e = calcularEnergia(pcm, TAXA);
    expect(e.db[50]).toBeLessThan(-100);
    expect(e.db[150]).toBeGreaterThan(-20);
    expect(e.db[250]).toBeLessThan(-100);
  });

  it("calcularEnergiaDeS16le le little endian com sinal, igual ao Int16Array", () => {
    const pcm = seno(0.5, 20000);
    const bytes = new Uint8Array(pcm.length * 2);
    pcm.forEach((v, i) => {
      bytes[2 * i] = v & 0xff;
      bytes[2 * i + 1] = (v >> 8) & 0xff;
    });
    const a = calcularEnergia(pcm, TAXA);
    const b = calcularEnergiaDeS16le(bytes, TAXA);
    expect(Array.from(b.db)).toEqual(Array.from(a.db));
    expect(b.duracao).toBe(a.duracao);
  });

  it("recusa taxa invalida", () => {
    expect(() => calcularEnergia(new Int16Array(10), 0)).toThrow(RangeError);
  });
});
