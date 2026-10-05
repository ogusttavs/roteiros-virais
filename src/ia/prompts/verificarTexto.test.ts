import { describe, expect, it } from "vitest";

import { CRITERIO_FATOS, montarEntrada, montarSistemaEstavel, motivoDaConferencia, schema, versao } from "./verificarTexto";

/**
 * 29/09/2026, achado do Gustavo em produção: a recomendação de `avaliarTema`
 * (instrução de como gravar o tema ajustado) foi reprovada duas vezes pelo
 * verificador como "briefing de direção de gravação". O gênero "tema" diz ao
 * modelo barato que instrução de gravação é o formato certo desse texto.
 */
describe("verificarTexto, gênero tema", () => {
  it("o gênero tema explica que instrução de gravação é o formato esperado, e não confunde com briefing interno", () => {
    const sistema = montarSistemaEstavel("tema");
    expect(sistema).toContain("recomendação sobre um tema");
    expect(sistema).toContain("Instrução de gravação é o formato certo deste gênero");
    expect(sistema).toContain("não um briefing interno");
  });

  it("o gênero padrão continua sem essa explicação (só tom de pessoa falando com pessoa)", () => {
    const sistema = montarSistemaEstavel();
    expect(sistema).toContain("uma pessoa falando com outra pessoa");
    expect(sistema).not.toContain("recomendação sobre um tema");
  });
});

describe("verificarTexto com fontes (o roteiro não inventa fato, 1.7.0: a definição estreita)", () => {
  const sistema = montarSistemaEstavel("roteiro", true);

  it("sem fontes nada muda: nem o critério de fato, nem o bloco FONTES", () => {
    expect(montarSistemaEstavel("roteiro")).not.toContain("FONTES");
    expect(montarEntrada({ texto: "t", proibicoes: [] })).not.toContain("FONTES");
  });

  it("a versão subiu e fato é só o ESPECÍFICO sobre a pessoa, o negócio, o lugar, o momento ou um acontecimento", () => {
    expect(versao).toBe("1.7.3");
    expect(sistema).toContain("fato ESPECÍFICO");
    for (const exemplo of ["quem está junto", "onde está", "o que aconteceu", "quando", "quanto custa", "nome de produto, de cliente ou de cidade", "uma cena vivida"]) {
      expect(sistema).toContain(exemplo);
    }
  });

  it("o fato específico inclui como a pessoa trabalha (juiz independente sobre os 34 roteiros): prática do negócio e loja que a fonte não traz reprovam, e o conhecimento do ofício continua livre", () => {
    expect(sistema).toContain("COMO A PESSOA TRABALHA");
    for (const pratica of ["respondo no direct", "testo na mão antes", "anoto a pergunta de cada fornecedor", "tenho loja", "na nossa loja", "a gente responde uma por uma"]) {
      expect(sistema).toContain(pratica);
    }
    const reprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    expect(reprovam).toContain("testo antes de entrar no kit");
    expect(CRITERIO_FATOS).toContain("conhecimento geral do ramo");
  });

  it("o que está fora da regra e nunca é motivo de reprovação: ofício, opinião, frase de efeito, generalização, paráfrase, inferência e hashtag", () => {
    for (const fora of ["conhecimento geral do ramo", "opinião", "frase de efeito", "generalização", "paráfrase ou reformulação", "o mesmo número escrito de outro jeito", "inferência óbvia das fontes", "hashtags"]) {
      expect(sistema).toContain(fora);
    }
    expect(sistema).toContain("nunca é motivo de reprovação");
  });

  it("na dúvida, aprova; só reprova apontando o fato E afirmando que nada nas fontes o sustenta, listando o fato e a frase mais próxima (ou nenhuma)", () => {
    expect(sistema).toContain("NA DÚVIDA, APROVE");
    expect(sistema).toContain("apontar o fato específico E afirmar que nada nas fontes o sustenta");
    expect(sistema).toContain("fatoEspecifico");
    expect(sistema).toContain("fonteMaisProxima");
    expect(sistema).toContain('(ou "nenhuma")');
    expect(sistema).toContain("[diga aqui onde você está]");
  });

  it("os três casos que o 1.6.0 reprovava à toa aparecem como APROVADOS (paráfrase de preço, inferência de bairro, conhecimento do ofício)", () => {
    const aprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que APROVAM"), CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    expect(aprovam).toContain('"R$ 89" e o texto diz "89 reais"');
    expect(aprovam).toContain('"bairro Vila Sorriso, São Paulo" e o texto diz "a clínica fica na Vila Sorriso"');
    expect(aprovam).toContain("esfregar a mancha espalha a gordura");
  });

  it("os quatro fatos do achado do Bruno aparecem como REPROVADOS (Uli com a mochila, café frio no hotel, país cortado, dois dias pela fábrica)", () => {
    const reprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    expect(reprovam).toContain("o Uli está aqui do meu lado com a mochila nas costas");
    expect(reprovam).toContain("numa mesa de hotel com café já frio");
    expect(reprovam).toContain("um país quase caiu do roteiro porque a feira repetia o que vejo no Brasil");
    expect(reprovam).toContain("uma parada ganhou dois dias a mais por causa da fábrica");
  });

  it("os três falsos positivos do golden set com chave aparecem como APROVADOS: instrução de gravação, repetição ou paráfrase do tema e a frase que o cliente pediu para falar", () => {
    const aprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que APROVAM"), CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    expect(aprovam).toContain("no carro, parado no sinal");
    expect(aprovam).toContain("gravar parado no sinal ou estacionado");
    expect(aprovam).toContain("o sofá da cliente de ontem");
    expect(aprovam).toContain("você viu esse erro em vídeo atrás de vídeo");
    expect(aprovam).toContain("o erro que apareceu em todo vídeo da semana");
    expect(aprovam).toContain("a frase que ele pediu para falar");
    // E saem da regra, na parte que diz o que nunca é motivo de reprovação.
    expect(CRITERIO_FATOS).toContain("repetir ou reformular o TEMA ou o momento (eles são fonte)");
    expect(CRITERIO_FATOS).toContain("a frase ou o assunto que o cliente pediu para dizer");
    expect(CRITERIO_FATOS).toContain("instruções de gravação (sugerir como ou onde gravar");
  });

  it("os falsos positivos da revisão do #127 aparecem como APROVADOS: frase literal do perfil, espaço marcado entre colchetes e pergunta (não é afirmação)", () => {
    const aprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que APROVAM"), CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    expect(aprovam).toContain("nunca promete resultado que não pode cumprir");
    expect(aprovam).toContain("eu nunca prometo resultado");
    expect(aprovam).toContain("aqui a gente aplica igual fábrica, sem bolha");
    expect(aprovam).toContain("sempre faço [conte aqui como você faz isso]");
    expect(aprovam).toContain("qual dura mais, o produto A ou o B?");
    expect(CRITERIO_FATOS).toContain("perguntas (uma pergunta, mesmo comparando dois produtos, não afirma nada)");
    expect(CRITERIO_FATOS).toContain("frase que está literalmente nas fontes");
  });

  it("a entrada leva as fontes depois do texto e das proibições", () => {
    const entrada = montarEntrada({ texto: "o texto", proibicoes: ["x"], fontes: "o momento: na oficina" });
    expect(entrada.indexOf("o texto")).toBeLessThan(entrada.indexOf("FONTES"));
    expect(entrada).toContain("o momento: na oficina");
  });

  it("a saída aceita os campos do fato (e continua valendo sem eles, como o modelo de antes devolvia), e o motivo da reprovação por fato leva o fato e a fonte", () => {
    expect(schema.parse({ aprovado: true, motivo: null })).toMatchObject({ aprovado: true, fatoEspecifico: null, fonteMaisProxima: null });
    const reprovado = schema.parse({ aprovado: false, motivo: "inventou", fatoEspecifico: "o Uli está do meu lado", fonteMaisProxima: "nenhuma" });
    expect(motivoDaConferencia(reprovado)).toBe('o texto afirma "o Uli está do meu lado" e nada nas fontes o sustenta (fonte mais próxima: nenhuma)');
    expect(motivoDaConferencia(schema.parse({ aprovado: false, motivo: "tom exagerado", fatoEspecifico: null, fonteMaisProxima: null }))).toBe("tom exagerado");
  });
});
