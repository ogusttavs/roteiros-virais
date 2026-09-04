import { describe, expect, it } from "vitest";

import type { Objetivo } from "@/db/schema";
import { encontrarProblemas } from "@/lib/regras-de-texto";

import { avisoLinhaEditorial, fraseAvisoLinhaEditorial } from "./linha-editorial";

function repetir(objetivo: Objetivo, vezes: number): Objetivo[] {
  return Array.from({ length: vezes }, () => objetivo);
}

describe("avisoLinhaEditorial", () => {
  it("com menos de 5 roteiros na janela, nao avisa nada", () => {
    const historico: Objetivo[] = [...repetir("alcance", 3), "conversao"];
    expect(avisoLinhaEditorial(historico, "negocio")).toBeNull();
  });

  it("conversao zerada nos ultimos 5 e bem abaixo da referencia: avisa e recomenda o objetivo em falta", () => {
    const historico: Objetivo[] = [...repetir("alcance", 12), ...repetir("engajamento", 2), "conversao"];

    const aviso = avisoLinhaEditorial(historico, "negocio");

    expect(aviso).toEqual({
      objetivoEmFalta: "conversao",
      contagemEmFalta: 1,
      maisComum: "alcance",
      contagemMaisComum: 12,
      totalNaJanela: 15,
    });
  });

  it("distribuicao proxima da referencia (negocio, 40/30/30) nao avisa", () => {
    const historico: Objetivo[] = [
      ...repetir("alcance", 2),
      ...repetir("engajamento", 2),
      ...repetir("conversao", 1),
      ...repetir("alcance", 2),
      ...repetir("engajamento", 1),
      ...repetir("conversao", 2),
      ...repetir("alcance", 2),
      ...repetir("engajamento", 2),
      ...repetir("conversao", 1),
    ];
    expect(historico).toHaveLength(15);

    expect(avisoLinhaEditorial(historico, "negocio")).toBeNull();
  });

  it("a mesma contagem pode avisar para negocio (referencia 30%) e nao avisar para criador (referencia 15%)", () => {
    // conversao aparece 2 de 15 (13,3%), presente nos ultimos 5 (nao "zerada"): so a
    // proporcao decide. Metade da referencia: 15% para negocio, 7,5% para criador.
    const historico: Objetivo[] = [
      "conversao",
      "alcance",
      "engajamento",
      "alcance",
      "conversao",
      "alcance",
      "engajamento",
      "alcance",
      "engajamento",
      "alcance",
      "engajamento",
      "alcance",
      "alcance",
      "alcance",
      "alcance",
    ];
    expect(historico).toHaveLength(15);

    expect(avisoLinhaEditorial(historico, "negocio")?.objetivoEmFalta).toBe("conversao");
    expect(avisoLinhaEditorial(historico, "criador")).toBeNull();
  });

  it("so 15 mais recentes contam: um 16 roteiro antigo com o objetivo em falta nao evita o aviso", () => {
    const recentes: Objetivo[] = [...repetir("alcance", 12), ...repetir("engajamento", 2), "conversao"];
    const historico: Objetivo[] = [...recentes, ...repetir("conversao", 20)];

    expect(avisoLinhaEditorial(historico, "negocio")?.totalNaJanela).toBe(15);
    expect(avisoLinhaEditorial(historico, "negocio")?.objetivoEmFalta).toBe("conversao");
  });

  it("com exatamente 5 roteiros (o limiar minimo), ja avisa se a distribuicao pedir", () => {
    // engajamento ausente dos 5 (zerado): zeradoRecente sozinho basta, sem precisar
    // estar abaixo da metade da referencia.
    const historico: Objetivo[] = [...repetir("alcance", 4), "conversao"];
    expect(historico).toHaveLength(5);

    const aviso = avisoLinhaEditorial(historico, "negocio");
    expect(aviso).toEqual({
      objetivoEmFalta: "engajamento",
      contagemEmFalta: 0,
      maisComum: "alcance",
      contagemMaisComum: 4,
      totalNaJanela: 5,
    });
  });

  it("zerado nos ultimos 5 mas com proporcao geral acima da metade da referencia ainda avisa (ramo isolado, sem abaixoDaMetade)", () => {
    // conversao some dos 5 mais recentes mas tem 5/15 (33%) no total, acima da
    // metade da referencia de negocio (15%): so o ramo "zeradoRecente" decide aqui.
    const historico: Objetivo[] = [
      ...repetir("alcance", 3),
      ...repetir("engajamento", 2),
      ...repetir("conversao", 5),
      ...repetir("alcance", 4),
      "engajamento",
    ];
    expect(historico).toHaveLength(15);

    const aviso = avisoLinhaEditorial(historico, "negocio");
    expect(aviso?.objetivoEmFalta).toBe("conversao");
    expect(aviso?.maisComum).toBe("alcance");
  });

  it("quando o objetivo em falta e tambem o mais comum da janela, nao avisa (guarda de auto-comparacao)", () => {
    // alcance some dos 5 mais recentes (zeradoRecente), mas e o mais frequente no
    // total (8 de 15): o objetivo "em falta" seria o proprio mais comum, o que nao
    // faz sentido recomendar, entao o aviso e descartado.
    const historico: Objetivo[] = [
      ...repetir("engajamento", 3),
      ...repetir("conversao", 2),
      ...repetir("alcance", 8),
      "engajamento",
      "conversao",
    ];
    expect(historico).toHaveLength(15);

    expect(avisoLinhaEditorial(historico, "negocio")).toBeNull();
  });
});

describe("fraseAvisoLinhaEditorial", () => {
  const historico: Objetivo[] = [...repetir("alcance", 12), ...repetir("engajamento", 2), "conversao"];
  const aviso = avisoLinhaEditorial(historico, "negocio")!;

  it("sem reordenar, para no fato do historico (regra 1, 2 e 6 do CLAUDE.md)", () => {
    const frase = fraseAvisoLinhaEditorial(aviso, false);
    expect(frase).toBe("dos seus últimos 15 vídeos, 12 foram para te conhecerem e só 1 para te chamarem para comprar");
    expect(encontrarProblemas(frase)).toEqual([]);
  });

  it("reordenando, acrescenta para onde o tema do dia puxa (regra 1, 2 e 6 do CLAUDE.md)", () => {
    const frase = fraseAvisoLinhaEditorial(aviso, true);
    expect(frase).toBe(
      "dos seus últimos 15 vídeos, 12 foram para te conhecerem e só 1 para te chamarem para comprar; hoje o tema puxa para o lado de fechar",
    );
    expect(encontrarProblemas(frase)).toEqual([]);
  });
});
