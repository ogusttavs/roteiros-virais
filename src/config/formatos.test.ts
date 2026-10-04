import { describe, expect, it } from "vitest";

import { CHAVES_DE_FORMATO, EXEMPLO_DO_TIPO, seloDoTipo, CHAVES_LIGADAS_POR_PADRAO, FORMATOS_DO_CATALOGO, FORMATOS_DO_VIDEO, FORMATOS_FORA_DO_CATALOGO, formatoPorChave } from "./formatos";

describe("os formatos (E44, estudo-formatos.md, seção 4)", () => {
  it("são treze chaves do cliente, com frase, e as oito do padrão ligado são 1 a 7 e a 11", () => {
    expect(FORMATOS_DO_CATALOGO).toHaveLength(13);
    expect(new Set(CHAVES_DE_FORMATO).size).toBe(13);
    expect(CHAVES_LIGADAS_POR_PADRAO).toEqual([
      "passo_a_passo",
      "antes_e_depois",
      "produto_em_uso",
      "erro_comum",
      "lista",
      "bastidor",
      "minha_historia",
      "respondendo_pergunta",
    ]);
    for (const formato of FORMATOS_DO_CATALOGO) expect(formato.frase.length).toBeGreaterThan(10);
  });

  it("a análise do vídeo pode dar as treze mais os seis que nunca servem de modelo", () => {
    expect(FORMATOS_FORA_DO_CATALOGO.map((f) => f.chave)).toEqual(["sem_fala_processo", "sem_fala_resultado", "noticia_comentada", "recorte_de_outro", "ao_vivo_ou_podcast", "outro"]);
    expect(FORMATOS_DO_VIDEO).toHaveLength(19);
    expect(formatoPorChave("humor_e_meme")?.nome).toBe("Humor e meme");
    expect(formatoPorChave("recorte_de_outro")).toBeNull();
    expect(formatoPorChave(null)).toBeNull();
  });

  it("o exemplo de cada tipo é uma frase fixa por tipo (as treze do estudo) e o selo diz 'Tipo: ...' em minúscula", () => {
    expect(Object.keys(EXEMPLO_DO_TIPO)).toEqual(CHAVES_DE_FORMATO);
    expect(EXEMPLO_DO_TIPO.erro_comum).toBe("Você mostra o jeito errado que muita gente faz e o jeito certo.");
    expect(seloDoTipo("erro_comum")).toBe("Tipo: erro comum");
    expect(seloDoTipo("humor_e_meme")).toBe("Tipo: humor e meme");
    expect(seloDoTipo("recorte_de_outro")).toBeNull();
    expect(seloDoTipo(null)).toBeNull();
  });
});
