import { describe, expect, it } from "vitest";

import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import {
  escaparTexto,
  limparTexto,
  MARCA_PADRAO,
  montarLinhaDoTempo,
  resolverMarca,
} from "./montador";
import { ErroDaAnimacao } from "./tipos";

describe("escaparTexto", () => {
  it("troca tudo o que abre ou fecha marcação, atributo ou template", () => {
    expect(escaparTexto(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escaparTexto("a & b")).toBe("a &amp; b");
    expect(escaparTexto("l'a `b`")).toBe("l&#39;a &#96;b&#96;");
  });
  it("não escapa duas vezes o que já foi trocado na ordem certa (o & primeiro)", () => {
    expect(escaparTexto("<")).toBe("&lt;");
  });
});

describe("limparTexto", () => {
  it("junta espaços e quebras e apara", () => {
    expect(limparTexto("  oi \n\n  mundo\t!  ")).toBe("oi mundo !");
  });
  it("troca controle e invisível por espaço", () => {
    expect(limparTexto("a" + String.fromCharCode(0, 0x200b, 0x202e) + "b")).toBe("a b");
  });
});

describe("montarLinhaDoTempo", () => {
  it("põe as cenas em sequência, sem buraco, com o tempo de leitura", () => {
    const linha = montarLinhaDoTempo([
      { texto: "Você sabia disso?" },
      { texto: "Três erros que custam clientes todo mês" },
    ]);
    expect(linha.cenas).toHaveLength(2);
    expect(linha.cenas[0].inicioS).toBe(0);
    expect(linha.cenas[1].inicioS).toBe(linha.cenas[0].fimS);
    expect(linha.duracaoS).toBe(linha.cenas[1].fimS);
    expect(linha.cenas[1].palavras).toEqual([
      "Três",
      "erros",
      "que",
      "custam",
      "clientes",
      "todo",
      "mês",
    ]);
  });
  it("respeita o piso e o teto da duração de cada cena", () => {
    const linha = montarLinhaDoTempo([
      { texto: "oi", duracaoS: 0.1 },
      { texto: "oi", duracaoS: 99 },
    ]);
    expect(linha.cenas[0].fimS - linha.cenas[0].inicioS).toBe(
      LIMITES_DA_ANIMACAO.duracaoMinimaDaCenaS,
    );
    expect(linha.cenas[1].fimS - linha.cenas[1].inicioS).toBe(
      LIMITES_DA_ANIMACAO.duracaoMaximaDaCenaS,
    );
  });
  it("descarta cena vazia e recusa a lista sem texto", () => {
    expect(montarLinhaDoTempo([{ texto: "  " }, { texto: "ok" }]).cenas).toHaveLength(1);
    expect(() => montarLinhaDoTempo([{ texto: " " }])).toThrow(ErroDaAnimacao);
    expect(() => montarLinhaDoTempo([])).toThrow(/sem cenas/);
  });
  it("recusa bloco comprido, cena demais e vídeo acima do teto", () => {
    expect(() =>
      montarLinhaDoTempo([{ texto: "a".repeat(LIMITES_DA_ANIMACAO.maxCaracteresPorCena + 1) }]),
    ).toThrow(/bloco curto/);
    expect(() =>
      montarLinhaDoTempo(
        Array.from({ length: LIMITES_DA_ANIMACAO.maxCenas + 1 }, () => ({ texto: "oi" })),
      ),
    ).toThrow(/demais/);
    expect(() =>
      montarLinhaDoTempo(Array.from({ length: 10 }, () => ({ texto: "oi", duracaoS: 8 }))),
    ).toThrow(/tempo máximo/);
  });
});

describe("resolverMarca", () => {
  it("sem marca vale o padrão do projeto", () => {
    expect(resolverMarca()).toEqual(MARCA_PADRAO);
  });
  it("aceita só cor #rrggbb e cai no padrão com qualquer outra coisa (nada vai para o CSS)", () => {
    const m = resolverMarca({
      corFundo: "#ABCDEF",
      corTexto: "red;} body{display:none",
      corDestaque: "url(http://x)",
    });
    expect(m.corFundo).toBe("#abcdef");
    expect(m.corTexto).toBe(MARCA_PADRAO.corTexto);
    expect(m.corDestaque).toBe(MARCA_PADRAO.corDestaque);
  });
  it("a letra embutida só passa se for base64", () => {
    expect(resolverMarca({ fonteBase64: "QUJD" }).fonteBase64).toBe("QUJD");
    expect(resolverMarca({ fonteBase64: ")};alert(1)//" }).fonteBase64).toBeNull();
  });
});
