/**
 * Os avisos do alarme do disco (29/10/2026): dizem o nível, quanto sobra e o que fazer, e nada do que o projeto proíbe (travessão, emoji, marca).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return { ...original, config: { ...original.config, appUrl: "https://painel.exemplo.teste", appName: "Painel" } };
});

import { type NumerosDoAviso, tamanhoEmTexto, textosAvisoDeDisco, type TipoDoAviso } from "./aviso-disco";

const numeros: NumerosDoAviso = {
  usadoPercentual: 91.4,
  livreBytes: 8_600_000_000,
  totalBytes: 100_000_000_000,
  edicaoBytes: 4_200_000_000,
  publicarBytes: 230_000_000,
  limiteAtencao: 80,
  limiteCritico: 90,
};
const TIPOS: TipoDoAviso[] = ["atencao", "critico", "voltou"];
const TRAVESSOES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

describe("tamanhoEmTexto", () => {
  it("usa GB com vírgula e MB para o que é pequeno", () => {
    expect(tamanhoEmTexto(8_600_000_000)).toBe("8,6 GB");
    expect(tamanhoEmTexto(100_000_000_000)).toBe("100 GB");
    expect(tamanhoEmTexto(230_000_000)).toBe("230 MB");
    expect(tamanhoEmTexto(0)).toBe("0 MB");
  });
});

describe("textosAvisoDeDisco", () => {
  it("a atenção diz o uso, o que sobra e que nada foi pausado", () => {
    expect(textosAvisoDeDisco.assunto("atencao", numeros)).toBe("O disco do servidor chegou a 91,4%");
    const detalhe = textosAvisoDeDisco.detalhe("atencao", numeros);
    expect(detalhe).toContain("Restam 8,6 GB livres de 100 GB");
    expect(detalhe).toContain("4,2 GB");
    expect(detalhe).toContain("230 MB");
    expect(detalhe).toContain("Nada foi pausado");
  });

  it("o crítico diz que o envio de vídeos foi pausado, que publicar continua e que a limpeza foi pedida", () => {
    expect(textosAvisoDeDisco.assunto("critico", numeros)).toBe("O disco do servidor passou de 90%: o envio de vídeos foi pausado");
    const detalhe = textosAvisoDeDisco.detalhe("critico", numeros);
    expect(detalhe).toContain("pausado");
    expect(detalhe).toContain("Publicar no Instagram continua funcionando");
    expect(detalhe).toContain("limpeza");
  });

  it("o 'voltou' diz que o envio está liberado", () => {
    expect(textosAvisoDeDisco.assunto("voltou", { ...numeros, usadoPercentual: 74 })).toBe("O disco do servidor voltou ao normal (74%)");
    expect(textosAvisoDeDisco.detalhe("voltou", numeros)).toContain("liberado");
  });

  it("o e-mail leva o endereço do admin e nenhum texto leva travessão, emoji ou marca", () => {
    for (const tipo of TIPOS) {
      const html = textosAvisoDeDisco.corpo(tipo, numeros, "https://painel.exemplo.teste/admin");
      expect(html).toContain("https://painel.exemplo.teste/admin");
      const tudo = [textosAvisoDeDisco.assunto(tipo, numeros), textosAvisoDeDisco.titulo(tipo, numeros), textosAvisoDeDisco.detalhe(tipo, numeros), html.replace(/<[^>]+>/g, " ")].join(" ");
      for (const travessao of TRAVESSOES) expect(tudo).not.toContain(travessao);
      expect(tudo).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(tudo.toLowerCase()).not.toContain(["orb", "ita"].join(""));
    }
  });
});
