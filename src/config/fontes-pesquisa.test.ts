/** A lista curada da pesquisa na hora (E54): quem é da lista, quem parece e não é, e o que vai para a ferramenta. */
import { describe, expect, it } from "vitest";

import { dominiosPermitidos, fonteDoEndereco, FONTES_DE_PESQUISA, hostDoEndereco } from "./fontes-pesquisa";

describe("hostDoEndereco", () => {
  it("tira o www, põe em minúsculas e só aceita http e https", () => {
    expect(hostDoEndereco("https://WWW.IBGE.gov.br/explica/x.php?a=1")).toBe("ibge.gov.br");
    expect(hostDoEndereco("http://g1.globo.com/a")).toBe("g1.globo.com");
    expect(hostDoEndereco("javascript:alert(1)")).toBeNull();
    expect(hostDoEndereco("ftp://ibge.gov.br/x")).toBeNull();
    expect(hostDoEndereco("isto não é endereço")).toBeNull();
  });
});

describe("fonteDoEndereco", () => {
  it("acha a fonte pelo domínio ou por um subdomínio, e a mais específica vence", () => {
    expect(fonteDoEndereco("https://www.ibge.gov.br/a")?.nome).toBe("IBGE");
    expect(fonteDoEndereco("https://agenciadenoticias.ibge.gov.br/a")?.nome).toBe("IBGE");
    expect(fonteDoEndereco("https://www1.folha.uol.com.br/a")?.nome).toBe("Folha de S.Paulo");
    expect(fonteDoEndereco("https://noticias.uol.com.br/a")?.nome).toBe("UOL");
    expect(fonteDoEndereco("https://g1.globo.com/economia/a")).toMatchObject({ nome: "G1", tipo: "imprensa" });
  });

  it("o domínio parecido não vale: nem o que tem a fonte no começo, nem o que a tem no meio", () => {
    for (const url of [
      "https://ibge.gov.br.evil.com/a",
      "https://notg1.globo.com/a",
      "https://ibge-gov.br/a",
      "https://g1.globo.com.evil.invalido/a",
      "https://exemplo.invalido/g1.globo.com",
      "https://globo.com/a",
      "https://uol.com.br.exemplo.invalido/a",
    ]) {
      expect(fonteDoEndereco(url), url).toBeNull();
    }
  });

  it("um órgão público que não está na lista com nome entra como gov.br, chamado pelo próprio endereço", () => {
    expect(fonteDoEndereco("https://www.gov.br/consumidor/pt-br")).toMatchObject({ nome: "Governo federal", tipo: "oficial" });
    expect(fonteDoEndereco("https://www.procon.sp.gov.br/x")).toMatchObject({ nome: "procon.sp.gov.br", tipo: "oficial" });
  });
});

describe("dominiosPermitidos", () => {
  it("manda à ferramenta só os domínios que um irmão mais amplo não cobre", () => {
    const dominios = dominiosPermitidos();
    expect(dominios).toContain("gov.br");
    expect(dominios).not.toContain("ibge.gov.br");
    expect(dominios).toContain("g1.globo.com");
    expect(dominios).toContain("uol.com.br");
    expect(dominios).not.toContain("folha.uol.com.br");
    expect(new Set(dominios).size).toBe(dominios.length);
  });

  it("o que a ferramenta recebe e o que o código aceita dizem o mesmo: todo domínio da lista é aceito pelo código", () => {
    const aceitos = dominiosPermitidos();
    for (const fonte of FONTES_DE_PESQUISA) {
      expect(fonteDoEndereco(`https://${fonte.dominio}/x`), fonte.dominio).not.toBeNull();
      expect(aceitos.some((d) => fonte.dominio === d || fonte.dominio.endsWith(`.${d}`)), fonte.dominio).toBe(true);
    }
  });

  it("sem fonte repetida e sem esquema nem caminho (o formato do allowed_domains)", () => {
    for (const fonte of FONTES_DE_PESQUISA) expect(fonte.dominio).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    expect(new Set(FONTES_DE_PESQUISA.map((f) => f.dominio)).size).toBe(FONTES_DE_PESQUISA.length);
  });
});
