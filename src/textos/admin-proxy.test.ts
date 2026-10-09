/**
 * Os textos do proxy do YouTube no admin (hotfix do proxy): cada motivo diz a causa certa e o que fazer, e os dois lugares (o Inicio e o cartao da rotina) dizem o mesmo motivo.
 * O erro de senha nao pode mandar comprar gigabyte, e o proxy fora do ar nao pode dizer que acabou o pacote.
 */
import { describe, expect, it } from "vitest";

import { textosInicioAdmin } from "./admin-contas";
import { textosCustosAdmin, textosRotinasAdmin } from "./admin-custos";

const MOTIVOS = ["proxy sem trafego", "proxy recusou o acesso", "proxy fora do ar"] as const;

describe("os textos do proxy parado no admin", () => {
  it("o Inicio diz a causa de cada motivo, o dia desde quando, e o que fazer", () => {
    const sem = textosInicioAdmin.atencao.proxyParado("proxy sem trafego", "3 de outubro");
    expect(sem.titulo).toBe("O proxy do YouTube está sem tráfego");
    expect(sem.detalhe).toContain("desde 3 de outubro");
    expect(sem.detalhe).toContain("recarregue o pacote no DataImpulse");

    const recusou = textosInicioAdmin.atencao.proxyParado("proxy recusou o acesso", "3 de outubro");
    expect(recusou.titulo).toBe("O proxy do YouTube recusou o acesso");
    expect(recusou.detalhe).toContain("confira a senha");
    expect(recusou.detalhe).not.toContain("recarregue");

    const fora = textosInicioAdmin.atencao.proxyParado("proxy fora do ar", "3 de outubro");
    expect(fora.titulo).toBe("O proxy do YouTube não está respondendo");
    expect(fora.detalhe).not.toContain("recarregue");
  });

  it("o cartao da rotina abre com o mesmo titulo do Inicio, para cada motivo", () => {
    for (const motivo of MOTIVOS) {
      const frase = textosRotinasAdmin.rotinas.proxyParado(motivo, "3 de outubro");
      expect(frase.startsWith(textosInicioAdmin.atencao.proxyParado(motivo, "3 de outubro").titulo)).toBe(true);
      expect(frase).toContain("desde 3 de outubro");
      expect(frase).toContain("esperaram a noite seguinte");
    }
  });

  it("sem travessao nem emoji em nenhum deles", () => {
    const tudo = MOTIVOS.flatMap((motivo) => [
      JSON.stringify(textosInicioAdmin.atencao.proxyParado(motivo, "3 de outubro")),
      textosRotinasAdmin.rotinas.proxyParado(motivo, "3 de outubro"),
    ]).join("\n");
    expect(tudo).not.toMatch(/[\u2012-\u2015\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("os megabytes e o preco do proxy em Custos", () => {
  const mb = textosCustosAdmin.foraDaIA.megabytes;

  it("menos de 10 MB tem uma casa (0,4 MB nao vira 0 MB), ate 999 MB e inteiro, e de 1.000 MB para cima e GB", () => {
    expect(mb(0.4)).toBe("0,4 MB baixados");
    expect(mb(7.5)).toBe("7,5 MB baixados");
    expect(mb(250)).toBe("250 MB baixados");
    expect(mb(999.6)).toBe("1 GB baixados");
    expect(mb(1500)).toBe("1,5 GB baixados");
  });

  it("a nota diz o preco por gigabyte que vem da configuracao (nao um numero escrito a mao) e que a conta e um piso", () => {
    expect(textosCustosAdmin.foraDaIA.nota("02/09/2026", "09/10/2026", 1)).toContain("US$ 1 por gigabyte (pacote do DataImpulse, preço de 09/10/2026)");
    expect(textosCustosAdmin.foraDaIA.nota("02/09/2026", "09/10/2026", 2.5)).toContain("US$ 2,5 por gigabyte");
    expect(textosCustosAdmin.foraDaIA.nota("02/09/2026", "09/10/2026", 1)).toContain("é um piso");
  });
});
