import { describe, expect, it } from "vitest";

import { contraste } from "@/carrossel/modelos";
import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import { MARCA_PADRAO, montarLinhaDoTempo, resolverMarca } from "../montador";
import { montarHtmlDaAnimacao } from "../render";
import { ErroDaAnimacao } from "../tipos";

import { AREA_SEGURA, coresDoBilingue, ESCALA_DA_FRASE, FECHO_S, gruposDePalavras, LARGURA_DA_COLUNA, moldeBilingue1, tamanhoDaFrase, tamanhoDaTraducao } from "./bilingue-1";

import { MOLDE_PADRAO, MOLDES } from "./index";

const MALICIOSO = `</p><script>window.hackeado=1</script><img src=x onerror="window.hackeado=2"> "'\``;
// Um PNG de 1 por 1 transparente (inventado aqui, sem marca de ninguém).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Uma marca inventada que posta em dois idiomas.
const CENAS = [
  { texto: "OUR BAKERY", traducao: "Nossa padaria", duracaoS: 2.5 },
  { texto: "Fresh bread every morning.", traducao: "Pão fresco toda manhã.", duracaoS: 2.5 },
  { texto: "Brazil → Portugal", traducao: "Brasil → Portugal", duracaoS: 3 },
];
const MARCA = { corFundo: "#1a2230", corTexto: "#f5f4f1", logoPngBase64: PNG, simboloPngBase64: PNG, site: "padaria.exemplo.com", rotuloDaTraducao: "PT" };

describe("molde bilingue-1 (sem navegador)", () => {
  it("existe pelo nome e não é o padrão", () => {
    expect(MOLDES["bilingue-1"]).toBe(moldeBilingue1);
    expect(MOLDE_PADRAO).toBe("tipografico-2");
  });

  it("área segura que serve ao Story e ao Reels", () => {
    expect(AREA_SEGURA).toEqual({ topo: 250, base: 380, direita: 140, esquerda: 96 });
    expect(LARGURA_DA_COLUNA).toBe(844);
  });

  it("o texto e a tradução do cliente nunca viram marcação", () => {
    const linha = montarLinhaDoTempo([{ texto: MALICIOSO, traducao: MALICIOSO }, { texto: "fim" }]);
    const html = moldeBilingue1.html({ linha, marca: resolverMarca({ ...MARCA, site: `x"><b>.com` }), largura: 1080, altura: 1920 });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("img-src data:");
  });

  it("a tradução sai menor que a frase, com o selo só quando a marca tem a sigla", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS, molde: "bilingue-1", marca: MARCA });
    expect(html.match(/class="traducao"/g)).toHaveLength(3);
    expect(html.match(/class="selo">PT</g)).toHaveLength(3);
    const sem = montarHtmlDaAnimacao({ cenas: CENAS, molde: "bilingue-1", marca: { ...MARCA, rotuloDaTraducao: "pt" } }).html;
    expect(sem).not.toContain('class="selo"');
    for (const tamanho of ESCALA_DA_FRASE) expect(tamanhoDaTraducao(tamanho)).toBeLessThan(tamanho * 0.7);
  });

  it("cena sem tradução não desenha a linha", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: [{ texto: "Só uma língua." }], molde: "bilingue-1" });
    expect(html).not.toContain('class="traducao"');
  });

  it("o fecho só existe com logo ou site, e o montador segura a última cena pelo tempo dele", () => {
    const com = montarHtmlDaAnimacao({ cenas: CENAS, molde: "bilingue-1", marca: MARCA });
    expect(com.html).toContain('id="fecho"');
    expect(com.html).toContain('class="site">padaria.exemplo.com<');
    expect(com.duracaoS).toBeCloseTo(2.5 + 2.5 + 3 + FECHO_S, 3);
    const sem = montarHtmlDaAnimacao({ cenas: CENAS, molde: "bilingue-1", marca: { corFundo: "#1a2230" } });
    expect(sem.html).not.toContain('id="fecho"');
    expect(sem.html).not.toContain('id="simbolo"');
  });

  it("logo, símbolo, site e sigla fora do formato caem fora", () => {
    const m = resolverMarca({ logoPngBase64: "R0lGODlhAQABAAAAACw=", simboloPngBase64: ")};alert(1)//", site: "https://x.com/caminho", rotuloDaTraducao: "PTBR", fonteRotuloBase64: "a b" });
    expect(m.logoPngBase64).toBeNull();
    expect(m.simboloPngBase64).toBeNull();
    expect(m.site).toBeNull();
    expect(m.rotuloDaTraducao).toBeNull();
    expect(m.fonteRotuloBase64).toBeNull();
    expect(resolverMarca({ site: " Clinica.COM.br " }).site).toBe("clinica.com.br");
    expect(resolverMarca({ logoPngBase64: PNG }).logoPngBase64).toBe(PNG);
  });

  it("a seta vira desenho e vai junto da palavra seguinte", () => {
    expect(gruposDePalavras(["Brazil", "→", "Portugal"])).toEqual([["Brazil"], ["→", "Portugal"]]);
    expect(gruposDePalavras(["a", "->"])).toEqual([["a"], ["->"]]);
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS, molde: "bilingue-1", marca: MARCA });
    expect(html).toContain('<span class="p"><svg class="seta"');
    expect(html).not.toMatch(/>→</);
  });

  it("as cores da marca valem quando o texto passa de 7 para 1; senão, o par do produto", () => {
    const boa = coresDoBilingue(resolverMarca(MARCA));
    expect([boa.fundo, boa.texto]).toEqual(["#1a2230", "#f5f4f1"]);
    expect(contraste(boa.secundario, boa.fundo)).toBeGreaterThanOrEqual(4.5);
    const fraca = coresDoBilingue(resolverMarca({ corFundo: "#777777", corTexto: "#888888" }));
    expect([fraca.fundo, fraca.texto]).toEqual([MARCA_PADRAO.corFundo, MARCA_PADRAO.corTexto]);
  });

  it("a frase desce a escala pelo tamanho e pela palavra mais larga", () => {
    expect(tamanhoDaFrase(["We", "import."])).toBe(120);
    expect(tamanhoDaFrase("International import and distribution.".split(" "))).toBe(96);
    expect(tamanhoDaFrase(["Pneumoultramicroscopicossilicovulcanoconiotico"])).toBeLessThan(60);
  });
});

describe("montarLinhaDoTempo com tradução", () => {
  it("leva a tradução limpa, ou null sem ela", () => {
    const linha = montarLinhaDoTempo([{ texto: "Hello", traducao: "  Olá\n mundo " }, { texto: "Sem" }]);
    expect(linha.cenas[0].traducao).toBe("Olá mundo");
    expect(linha.cenas[1].traducao).toBeNull();
  });

  it("a tradução soma metade do tempo de leitura dela", () => {
    const L = LIMITES_DA_ANIMACAO;
    const sem = montarLinhaDoTempo([{ texto: "um dois três quatro cinco" }]);
    const com = montarLinhaDoTempo([{ texto: "um dois três quatro cinco", traducao: "one two three four" }]);
    expect(com.duracaoS - sem.duracaoS).toBeCloseTo(4 * L.segundosPorPalavra * 0.5, 3);
  });

  it("tradução longa demais recusa a cena", () => {
    expect(() => montarLinhaDoTempo([{ texto: "ok", traducao: "a".repeat(LIMITES_DA_ANIMACAO.maxCaracteresPorCena + 1) }])).toThrow(ErroDaAnimacao);
  });
});
