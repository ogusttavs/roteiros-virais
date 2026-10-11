import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { avaliarRoteirosLongos } from "./avaliar-roteiros-longos";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o golden set do roteiro longo (E52, PR 3)", () => {
  it("o exemplo tem seis casos válidos e, sob o simulador, todos passam no verificador na primeira tentativa, sem custo nem falha", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarRoteirosLongos();
    expect(resultado.ehExemplo).toBe(true);
    expect(resultado.casos).toBe(6);
    expect(resultado.casosFalhos).toBe(0);
    expect(resultado.reprovadosNoVerificador).toBe(0);
    expect(resultado.reprovadosNa1aTentativa).toBe(0);
    expect(resultado.custoTotalUsd).toBe(0);
    const impresso = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(impresso).toContain("IA: simulada");
    expect(impresso).toContain("ganchos inteiros:");
  });

  it("prova o formato do capítulo: o gancho de cada capítulo vem inteiro e o resto em pontos curtos", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarRoteirosLongos();
    // seis casos, de 3 a 6 capítulos cada: todo capítulo que não é o último traz o gancho inteiro
    expect(resultado.capitulosComGancho).toBeGreaterThanOrEqual(6 * 2);
    expect(resultado.ganchosInteiros).toBe(resultado.capitulosComGancho);
    // e o resto vem em pontos: nenhum passa de 20 palavras
    expect(resultado.pontos).toBeGreaterThanOrEqual(resultado.capitulosComGancho * 2);
    expect(resultado.pontosAcimaDoLimite).toBe(0);
  });

  it("o 'Copiar os capítulos' de cada caso volta como os mesmos capítulos", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resultado = await avaliarRoteirosLongos();
    expect(resultado.copiaQueNaoVolta).toBe(0);
  });
});

describe("os contadores do golden set se mexem quando o modelo erra (o simulador é forçado por marcador)", () => {
  /** Roda o golden set com um caso do exemplo trocado: o tema leva os marcadores do simulador, que valem nas duas tentativas. */
  async function rodarComMarcador(marcador: string) {
    const exemplo = JSON.parse(readFileSync(path.resolve(process.cwd(), "avaliacoes/roteiros-longos.exemplo.json"), "utf8")) as { tema?: string }[];
    const caso = { ...exemplo[0], tema: `${exemplo[0].tema} ${marcador}` };
    const dir = mkdtempSync(path.join(tmpdir(), "golden-longo-"));
    writeFileSync(path.join(dir, "roteiros-longos.json"), JSON.stringify([caso]));
    const antes = process.env.GOLDEN_SET_DIR;
    process.env.GOLDEN_SET_DIR = dir;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      return await avaliarRoteirosLongos();
    } finally {
      if (antes === undefined) delete process.env.GOLDEN_SET_DIR;
      else process.env.GOLDEN_SET_DIR = antes;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("um ponto de mais de 20 palavras em toda tentativa: o contador de pontos acima do limite sobe e o caso reprova nas duas", async () => {
    const r = await rodarComMarcador("[mock:ponto-longo-sempre]");
    expect(r.pontosAcimaDoLimite).toBe(1);
    expect(r.reprovadosNoVerificador).toBe(1);
    expect(r.reprovadosNa1aTentativa).toBe(1);
  });

  it("um gancho de capítulo que vem como rótulo: o contador de ganchos inteiros fica abaixo do total", async () => {
    const r = await rodarComMarcador("[mock:gancho-curto-sempre]");
    expect(r.ganchosInteiros).toBe(r.capitulosComGancho - 1);
    expect(r.reprovadosNoVerificador).toBe(1);
  });

  it("um nome de capítulo que a lista da descrição lê errado: a cópia dos capítulos não volta e o caso reprova", async () => {
    const r = await rodarComMarcador("[mock:nome-com-tempo-sempre]");
    expect(r.copiaQueNaoVolta).toBe(1);
    expect(r.reprovadosNoVerificador).toBe(1);
  });

  it("sem marcador o mesmo caso passa em tudo (o controle dos três testes acima)", async () => {
    const r = await rodarComMarcador("");
    expect(r.pontosAcimaDoLimite).toBe(0);
    expect(r.ganchosInteiros).toBe(r.capitulosComGancho);
    expect(r.copiaQueNaoVolta).toBe(0);
    expect(r.reprovadosNoVerificador).toBe(0);
  });
});
