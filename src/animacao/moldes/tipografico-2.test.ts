import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import { montarLinhaDoTempo, resolverMarca } from "../montador";
import { montarHtmlDaAnimacao } from "../render";

import { AREA_SEGURA, ESCALA_DA_LETRA, LARGURA_DA_COLUNA, moldeTipografico2, passoEntrePalavras, TEMPOS, tamanhoDaLetra, tamanhoDoArroba } from "./tipografico-2";

import { MOLDE_PADRAO, MOLDES } from "./index";

const MALICIOSO = `</p><script>window.hackeado=1</script><img src=x onerror="window.hackeado=2"> "'\``;

// Um roteiro de dentista inventado (sem cliente real), na ordem gancho, corpo, chamada.
const CENAS = [
  { texto: "Sangrar a gengiva quando você escova não é normal." },
  { texto: "Se ficar mais de 2 semanas, a inflamação vira gengivite." },
  { texto: "E a gengivite tratada cedo some em poucos dias, com limpeza e o jeito certo de passar o fio." },
  { texto: "Pneumoultramicroscopicossilicovulcanoconiótico" },
  { texto: "Agende a sua avaliação pelo link da bio." },
];

describe("molde tipografico-2 (sem navegador)", () => {
  it("é o padrão, e o provisório continua para os pedidos antigos", () => {
    expect(MOLDE_PADRAO).toBe("tipografico-2");
    expect(MOLDES["tipografico-1"]).toBeDefined();
  });

  it("a área segura do Reels: 220 no alto, 380 embaixo, 140 à direita", () => {
    expect(AREA_SEGURA).toEqual({ topo: 220, base: 380, direita: 140, esquerda: 96 });
    expect(LARGURA_DA_COLUNA).toBe(844);
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS });
    expect(html).toContain(".cena{position:absolute;left:96px;right:140px;top:300px;bottom:380px;");
    expect(html).toContain("#andamento{position:absolute;left:96px;top:220px;");
  });

  it("o texto do cliente nunca vira marcação, nem o @", () => {
    const linha = montarLinhaDoTempo([{ texto: MALICIOSO }, { texto: "fim" }]);
    const html = moldeTipografico2.html({ linha, marca: { ...resolverMarca(), arroba: `@a"<b>` }, largura: 1080, altura: 1920 });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("@a&quot;&lt;b&gt;");
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("default-src 'none'");
  });

  it("o @ só entra no formato do Instagram, e só na última cena", () => {
    expect(resolverMarca({ arroba: "@clinica.sorriso_1" }).arroba).toBe("@clinica.sorriso_1");
    expect(resolverMarca({ arroba: "@a b" }).arroba).toBeNull();
    expect(resolverMarca({ arroba: "clinica" }).arroba).toBeNull();
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS, marca: { arroba: "@clinica.exemplo" } });
    expect(html.match(/class="arroba"/g)).toHaveLength(1);
    expect(html.indexOf('class="arroba"')).toBeGreaterThan(html.lastIndexOf('class="cena"'));
    const sem = montarHtmlDaAnimacao({ cenas: CENAS }).html;
    expect(sem).not.toContain('class="arroba"');
  });

  it("uma palavra (ou duas seguidas) no destaque em cada cena, pela regra fixa", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS });
    expect(html).toContain('<span class="p"><span class="d">gengiva</span></span>');
    expect(html).toContain('<span class="p"><span class="d">avaliação</span></span>');
    const cenas = html.split('<section class="cena"').slice(1);
    for (const cena of cenas) expect(cena.match(/class="d"/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("a pontuação colada fica fora do destaque, na cor do texto", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS });
    // "2 semanas," destaca só "2 semanas": a vírgula fica fora do trecho que acende.
    expect(html).toContain('<span class="p"><span class="d">2</span></span> <span class="p"><span class="d">semanas</span>,</span>');
    // "avaliação." destaca só "avaliação".
    const fim = montarHtmlDaAnimacao({ cenas: [{ texto: "Agende hoje a sua avaliação." }] }).html;
    expect(fim).toContain('<span class="p"><span class="d">avaliação</span>.</span>');
    expect(fim).not.toMatch(/class="d">[^<]*[.,;:!?…"”]/);
  });

  it("a cor da marca é o único acento: o destaque e a pílula do @ usam a mesma cor", () => {
    const { html } = montarHtmlDaAnimacao({ cenas: CENAS, marca: { corDestaque: "#0e5a6a", arroba: "@clinica.exemplo" } });
    const pilula = /\.arroba span\{[^}]*background:(#[0-9a-f]{6})/.exec(html)?.[1];
    expect(pilula).toBeDefined();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(pilula!.slice(i, i + 2), 16));
    expect(html).toContain(`CD=[${r},${g},${b}]`);
  });

  it("tempo de cena: o de leitura, e a última fica 2 s a mais", () => {
    const leitura = montarLinhaDoTempo(CENAS);
    const { duracaoS } = montarHtmlDaAnimacao({ cenas: CENAS });
    expect(TEMPOS.seguraDoFinal).toBe(2);
    expect(duracaoS).toBeCloseTo(leitura.duracaoS + 2, 3);
    // Cena longa, letra menor; palavra comprida desce a escala até caber.
    expect(tamanhoDaLetra("Agende já".split(" "))).toBe(ESCALA_DA_LETRA[0]);
    expect(tamanhoDaLetra(CENAS[2].texto.split(" "))).toBe(ESCALA_DA_LETRA[2]);
    expect(tamanhoDaLetra(["Otorrinolaringologista"])).toBe(60);
    expect(tamanhoDaLetra(["Pneumoultramicroscopicossilicovulcanoconiótico"])).toBe(44);
    expect(tamanhoDoArroba("@clinica")).toBe(48);
    expect(tamanhoDoArroba(`@${"a".repeat(30)}`)).toBeLessThan(48);
    // A escada das palavras nunca passa de 0,9 s, mesmo numa cena comprida.
    expect(passoEntrePalavras(30) * 29).toBeLessThanOrEqual(TEMPOS.escadaMaxima + 1e-9);
    expect(passoEntrePalavras(1)).toBe(0);
  });

  it("a espera do final nunca faz o vídeo passar do teto (nem ser recusado por isso)", () => {
    const cenas = Array.from({ length: 8 }, () => ({ texto: "oi", duracaoS: 7.5 }));
    const { duracaoS } = montarHtmlDaAnimacao({ cenas });
    expect(duracaoS).toBe(LIMITES_DA_ANIMACAO.duracaoMaximaTotalS);
    const curto = montarHtmlDaAnimacao({ cenas: Array.from({ length: 8 }, () => ({ texto: "oi", duracaoS: 7 })) });
    expect(curto.duracaoS).toBe(58);
  });

  it("o provisório não muda de tempo (sem a espera do final)", () => {
    const leitura = montarLinhaDoTempo(CENAS);
    expect(montarHtmlDaAnimacao({ cenas: CENAS, molde: "tipografico-1" }).duracaoS).toBe(leitura.duracaoS);
  });
});

describe("molde tipografico-2 no Chromium (área segura medida no quadro)", () => {
  let navegador: Browser;
  beforeAll(async () => {
    navegador = await chromium.launch({ args: ["--font-render-hinting=none"] });
  }, 60_000);
  afterAll(async () => {
    await navegador?.close();
  });

  it("em qualquer instante, tudo o que aparece fica dentro da área segura e da coluna", async () => {
    const { html, duracaoS } = montarHtmlDaAnimacao({ cenas: CENAS, marca: { corDestaque: "#0e5a6a", arroba: `@${"a".repeat(30)}` } });
    const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 } });
    await pagina.setContent(html, { waitUntil: "load" });
    await pagina.evaluate("document.fonts.ready.then(() => true)");
    const linha = montarLinhaDoTempo(CENAS, { seguraDoFinalS: 2 });
    // O meio de cada cena e o último quadro.
    const instantes = [...linha.cenas.map((c) => (c.inicioS + c.fimS) / 2), duracaoS - 1 / 30];
    for (const t of instantes) {
      const caixas = (await pagina.evaluate(`(() => {
        window.irPara(${t});
        const vistas = [...document.querySelectorAll(".cena .p, .cena .arroba span, #andamento i")].filter((e) => {
          let n = e; while (n) { const s = getComputedStyle(n); if (s.visibility === "hidden" || Number(s.opacity) < 0.05) return false; n = n.parentElement; }
          return true;
        });
        return vistas.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
      })()`)) as [number, number, number, number][];
      expect(caixas.length).toBeGreaterThan(0);
      for (const [esquerda, topo, direita, base] of caixas) {
        expect(esquerda).toBeGreaterThanOrEqual(AREA_SEGURA.esquerda - 1);
        expect(topo).toBeGreaterThanOrEqual(AREA_SEGURA.topo - 1);
        expect(direita).toBeLessThanOrEqual(1080 - AREA_SEGURA.direita + 1);
        expect(base).toBeLessThanOrEqual(1920 - AREA_SEGURA.base + 1);
      }
    }
    await pagina.close();
  }, 60_000);

  it("a primeira cena já está inteira no primeiro quadro (o gancho e a capa), e a última não sai", async () => {
    const { html, duracaoS } = montarHtmlDaAnimacao({ cenas: CENAS, marca: { arroba: "@clinica.exemplo" } });
    const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 } });
    await pagina.setContent(html, { waitUntil: "load" });
    await pagina.evaluate("document.fonts.ready.then(() => true)");
    const opacidades = (t: number) =>
      pagina.evaluate(`(() => { window.irPara(${t}); const c = [...document.querySelectorAll(".cena")].find((e) => e.style.visibility === "visible"); return [...c.querySelectorAll(".p, .arroba")].map((e) => Number(e.style.opacity) * Number(c.querySelector(".bloco").style.opacity)); })()`) as Promise<number[]>;
    const primeiro = await opacidades(0);
    expect(primeiro.length).toBeGreaterThan(0);
    expect(primeiro.every((o) => o === 1)).toBe(true);
    // O último quadro: a chamada inteira e o @ à vista.
    expect((await opacidades(duracaoS - 1 / 30)).every((o) => o > 0.99)).toBe(true);
    await pagina.close();
  }, 60_000);
});
