import { describe, expect, it } from "vitest";

import { comLimiteDeChromium, conferirPaginaDeImpressao, ErroFilaCheia, escaparHtml, rodapeDoPdf } from "./chromium-de-impressao";

/** Uma tarefa que só termina quando se manda: para segurar as vagas do Chromium. */
function tarefaManual() {
  let liberar!: () => void;
  const espera = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  let rodando = false;
  const promessa = comLimiteDeChromium(async () => {
    rodando = true;
    await espera;
    return "feito";
  });
  return { promessa, liberar, estaRodando: () => rodando };
}

describe("comLimiteDeChromium: duas vagas, uma fila com teto", () => {
  it("só duas tarefas rodam ao mesmo tempo, as outras esperam a vez e rodam quando uma sai", async () => {
    const [a, b, c] = [tarefaManual(), tarefaManual(), tarefaManual()];
    await Promise.resolve();
    expect([a.estaRodando(), b.estaRodando(), c.estaRodando()]).toEqual([true, true, false]);
    a.liberar();
    expect(await a.promessa).toBe("feito");
    await Promise.resolve();
    expect(c.estaRodando()).toBe(true);
    b.liberar();
    c.liberar();
    await Promise.all([b.promessa, c.promessa]);
  });

  it("com a fila cheia o pedido novo recusa na hora (ErroFilaCheia), em vez de a fila crescer sem limite", async () => {
    const tarefas = Array.from({ length: 8 }, () => tarefaManual());
    await Promise.resolve();
    // Duas rodando e seis esperando: a nona recusa.
    await expect(comLimiteDeChromium(async () => "nunca")).rejects.toBeInstanceOf(ErroFilaCheia);
    for (const tarefa of tarefas) tarefa.liberar();
    await Promise.all(tarefas.map((t) => t.promessa));
    // Esvaziada a fila, volta a aceitar.
    await expect(comLimiteDeChromium(async () => "de novo")).resolves.toBe("de novo");
  });
});

describe("conferirPaginaDeImpressao: a página de erro nunca vira PDF", () => {
  it("aceita a resposta 2xx e recusa a 404 (o token vencido) e a ausência de resposta", () => {
    expect(() => conferirPaginaDeImpressao({ ok: () => true, status: () => 200 })).not.toThrow();
    expect(() => conferirPaginaDeImpressao({ ok: () => false, status: () => 404 })).toThrow("404");
    expect(() => conferirPaginaDeImpressao(null)).toThrow("nada");
  });
});

describe("rodapeDoPdf: o pé de cada página", () => {
  it("leva a marca e a data à esquerda e o número da página e o total, que o Chromium preenche, à direita", () => {
    const pe = rodapeDoPdf("Casa em Ordem", "7 de setembro de 2026");
    expect(pe).toContain("Roteiro de Casa em Ordem, 7 de setembro de 2026");
    expect(pe).toContain('página <span class="pageNumber"></span> de <span class="totalPages"></span>');
  });

  it("com as marcas de fala, uma linha de legenda em cima, com as seis marcas; sem elas, o pé de sempre", () => {
    const sem = rodapeDoPdf("Casa em Ordem", "7 de setembro de 2026");
    const com = rodapeDoPdf("Casa em Ordem", "7 de setembro de 2026", true);
    expect(sem).not.toContain("tom desce");
    for (const palavra of ["peso", "pausa longa", "devagar", "tom desce", "tom sobe"]) expect(com).toContain(palavra);
    // O pé de sempre continua dentro, com a página que o Chromium preenche.
    expect(com).toContain("Roteiro de Casa em Ordem, 7 de setembro de 2026");
    expect(com).toContain('<span class="pageNumber"></span>');
  });

  it("o nome da marca, que é texto da pessoa, não abre marcação no HTML do pé", () => {
    const pe = rodapeDoPdf('<img src=x onerror="alert(1)"> & Cia', "7 de setembro de 2026");
    expect(pe).not.toContain("<img");
    expect(pe).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Cia");
    expect(escaparHtml('a<b>&"c')).toBe("a&lt;b&gt;&amp;&quot;c");
  });
});
