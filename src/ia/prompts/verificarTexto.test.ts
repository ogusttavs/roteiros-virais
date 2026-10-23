import { describe, expect, it } from "vitest";

import {
  CRITERIO_FATOS,
  CRITERIO_PROIBICAO,
  CRITERIO_PROIBICAO_COMO_AVISO,
  fontesSemProibicoes,
  MARCADOR_DE_ESPACO,
  ehCampoDeInstrucao,
  montarEntrada,
  montarSistemaEstavel,
  montarTextoParaConferir,
  motivoDaConferencia,
  neutralizarColchetes,
  schema,
  TITULO_DAS_INSTRUCOES,
  versao,
} from "./verificarTexto";

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

  it("com o tema da própria pessoa, a proibição vira aviso e nunca reprova (22/10/2026); a conformidade continua barrando; sem isso o critério é o de sempre", () => {
    const aviso = montarSistemaEstavel("tema", false, true);
    expect(aviso).toContain(CRITERIO_PROIBICAO_COMO_AVISO);
    expect(aviso).toContain("nunca fere a proibição");
    expect(aviso).toContain("atacar ou ofender uma pessoa, um candidato, um partido");
    expect(aviso).not.toContain(CRITERIO_PROIBICAO);
    for (const genero of ["padrao", "analise", "roteiro", "regra", "tema"] as const) {
      const sistema = montarSistemaEstavel(genero);
      expect(sistema).toContain(CRITERIO_PROIBICAO);
      expect(sistema).not.toContain("nunca fere a proibição");
    }
    // O roteiro do tema livre usa o mesmo critério de aviso, com o gênero do roteiro.
    expect(montarSistemaEstavel("roteiro", true, true)).toContain(CRITERIO_PROIBICAO_COMO_AVISO);
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
    expect(versao).toBe("1.9.0");
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

describe("verificarTexto 1.8.1: tema da própria pessoa sem a proibição nas fontes", () => {
  it("tira só a linha das proibições do perfil e deixa o resto das fontes igual", () => {
    const fontes = [
      "Perfil do cliente:",
      "Lavagem de sofá.",
      "Nunca diria ou faria: política; palavrão",
      "Cenas que dá para filmar: o sofá antes",
      "",
      "Tema: a eleição do sofá",
    ].join(String.fromCharCode(10));
    const limpas = fontesSemProibicoes(fontes);
    expect(limpas).not.toContain("Nunca diria ou faria");
    expect(limpas).not.toContain("política");
    expect(limpas).toContain("Lavagem de sofá.");
    expect(limpas).toContain("Cenas que dá para filmar: o sofá antes");
    expect(limpas).toContain("Tema: a eleição do sofá");
  });

  it("sem proibição na lista, a entrada diz que não há proibição registrada", () => {
    expect(montarEntrada({ texto: "um texto", proibicoes: [] })).toContain("Proibicoes do cliente: nenhuma proibicao registrada");
  });
});

describe("verificarTexto 1.8.2: o colchete não é fato e o medo do perfil dito ao público não é caso vivido", () => {
  it("neutralizarColchetes troca cada espaço marcado pelo marcador e deixa o resto do texto inteiro", () => {
    expect(neutralizarColchetes("então [conte aqui como você faz para a mancha não voltar] e grave")).toBe(`então ${MARCADOR_DE_ESPACO} e grave`);
    expect(neutralizarColchetes("[diga onde está] e [diga quem está junto]")).toBe(`${MARCADOR_DE_ESPACO} e ${MARCADOR_DE_ESPACO}`);
    expect(neutralizarColchetes("sem colchete nenhum")).toBe("sem colchete nenhum");
    expect(neutralizarColchetes("o Uli está aqui do meu lado [diga o resto]")).toContain("o Uli está aqui do meu lado");
  });

  it("um colchete longo demais (mais de 200 caracteres) não esconde nada: fica à vista, para não virar jeito de passar um parágrafo de fato inventado", () => {
    const longo = "[" + "um cliente meu, na semana passada, ".repeat(10) + "]";
    expect(longo.length).toBeGreaterThan(200);
    expect(neutralizarColchetes(longo)).toBe(longo);
  });

  it("colchete desbalanceado ou aninhado não quebra: só o par mais interno fechado é trocado", () => {
    expect(neutralizarColchetes("abre [e nunca fecha")).toBe("abre [e nunca fecha");
    expect(neutralizarColchetes("[fora [dentro] fim]")).toBe(`[fora ${MARCADOR_DE_ESPACO} fim]`);
  });

  it("o critério separa falar com o público sobre o medo do perfil (aprova) de contar um caso específico como acontecido (reprova)", () => {
    const aprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que APROVAM"), CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    const reprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
    expect(aprovam).toContain("Medos do cliente: já mandou fazer em outro lugar e o sofá ficou manchado");
    expect(aprovam).toContain("você já mandou lavar uma vez e o sofá voltou manchado?");
    expect(aprovam).toContain("então [espaço para a pessoa completar]");
    expect(reprovam).toContain("um cliente meu, na semana passada, mandou lavar em outro lugar e o sofá voltou manchado");
    expect(CRITERIO_FATOS).toContain("FALAR COM O PÚBLICO sobre um medo, uma dor ou uma situação que o perfil lista");
    expect(CRITERIO_FATOS).toContain("CASO ESPECÍFICO como acontecido");
    expect(CRITERIO_FATOS).toContain("[espaço para a pessoa completar]");
  });
});

/**
 * 1.9.0 (rodada 3, prova com chave de 23/10/2026 sobre o 1.8.2): cada falso positivo que a prova mostrou vira um caso que APROVA, e os casos que têm de continuar REPROVANDO seguem no critério.
 * O modelo de verdade só se prova com a chave (a Central faz); aqui ficam o código (o que vai ao verificador) e o texto do critério (o que ele lê).
 */
describe("verificarTexto 1.9.0: instrução não é fato (por código)", () => {
  const fala = { titulo: "A mancha que volta", gancho: "Olha esse sofá", corpo: "O sofá custa cento e oitenta reais [diga a condição: à vista ou parcelado]", textoNaTela0: "Orçamento sem compromisso" };
  const instrucoes = {
    ondeGravar: "Na sala, com a janela aberta",
    ritmoDeCorte: "Um corte a cada três segundos",
    recurso0: "Coloque a foto de duas figuras eleitorais muito conhecidas na tela",
    audio: "Use o áudio da semana",
    referenciaOQueOlhar: "Olhe como ele abre com a mão no tecido",
    cena0: "Mostre a foto das duas figuras e grave o sofá",
    cartao1Mostrar: "O antes e depois do sofá",
    capitulo0NaImagem: "A foto do sofá manchado",
    capitulo0ComoEditar: "Corte rápido no início",
  };
  const quebra = String.fromCharCode(10);

  it("reconhece como instrução os campos de gravação e de edição, e só eles", () => {
    for (const nome of Object.keys(instrucoes)) expect(ehCampoDeInstrucao(nome), nome).toBe(true);
    for (const nome of ["titulo", "gancho", "corpo", "fechamento", "chamadaFinal", "cartao0Falar", "cartao0TextoNaTela", "textoNaTela0", "legenda", "miniatura", "temaCurto", "porQueAssim0", "capitulo0Nome", "capitulo0Ponto0", "recursos", "cenario"]) {
      expect(ehCampoDeInstrucao(nome), nome).toBe(false);
    }
  });

  it("com fontes, a fala e o que o público lê vêm primeiro e as instruções vêm depois, sob o título que o critério conhece", () => {
    const texto = montarTextoParaConferir({ ...fala, ...instrucoes }, true);
    const [antes, depois] = texto.split(TITULO_DAS_INSTRUCOES);
    expect(depois).toBeDefined();
    for (const valor of Object.values(fala)) expect(antes).toContain(valor);
    for (const valor of Object.values(instrucoes)) {
      expect(depois).toContain(valor);
      expect(antes).not.toContain(valor);
    }
    expect(TITULO_DAS_INSTRUCOES.startsWith("INSTRUÇÕES PARA A PESSOA")).toBe(true);
    // O que o critério manda: depois dessa linha, nunca conferir como fato.
    expect(CRITERIO_FATOS).toContain('a linha "INSTRUÇÕES PARA A PESSOA"');
  });

  it("sem fontes o texto é o de sempre (um campo por linha, sem bloco nem título); com fontes e sem nenhuma instrução, também não aparece título", () => {
    const campos = { ...fala, ...instrucoes };
    expect(montarTextoParaConferir(campos, false)).toBe(Object.values(campos).join(quebra));
    expect(montarTextoParaConferir(fala, true)).toBe(Object.values(fala).join(quebra));
    expect(montarTextoParaConferir(fala, true)).not.toContain("INSTRUÇÕES");
  });

  it("o fato inventado numa fala que o público ouve ou lê continua à vista do verificador (a instrução não esconde a fala)", () => {
    const texto = montarTextoParaConferir({ gancho: "O Uli está do meu lado", textoNaTela0: "Mais de 500 sofás lavados", ondeGravar: "Na sala" }, true);
    const [antes] = texto.split(TITULO_DAS_INSTRUCOES);
    expect(antes).toContain("O Uli está do meu lado");
    expect(antes).toContain("Mais de 500 sofás lavados");
  });

  it("na entrada do verificador, o colchete ao lado do número vira o marcador e o bloco das instruções chega depois da fala e antes das fontes", () => {
    const texto = montarTextoParaConferir({ ...fala, ...instrucoes }, true);
    const entrada = montarEntrada({ texto, proibicoes: [], fontes: "Perfil: sofá de 3 lugares por R$ 180" });
    expect(entrada).toContain(`cento e oitenta reais ${MARCADOR_DE_ESPACO}`);
    expect(entrada).not.toContain("à vista ou parcelado");
    expect(entrada.indexOf("Olha esse sofá")).toBeLessThan(entrada.indexOf(TITULO_DAS_INSTRUCOES));
    expect(entrada.indexOf(TITULO_DAS_INSTRUCOES)).toBeLessThan(entrada.indexOf("FONTES"));
  });
});

describe("verificarTexto 1.9.0: o que a prova mostrou como falso positivo aparece como APROVADO no critério", () => {
  const aprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que APROVAM"), CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
  const reprovam = CRITERIO_FATOS.slice(CRITERIO_FATOS.indexOf("Exemplos que REPROVAM"));
  const regra = CRITERIO_FATOS.slice(0, CRITERIO_FATOS.indexOf("Exemplos que APROVAM"));

  it("(1) instrução para a pessoa: o bloco depois da linha das instruções e o imperativo (mostre, coloque, grave) nunca são fato, mesmo se o objeto não está nas fontes", () => {
    expect(regra).toContain("INSTRUÇÃO PARA A PESSOA nunca é afirmação sobre o negócio");
    for (const palavra of ["mostre", "coloque na tela", "grave", "filme", "aponte"]) expect(regra).toContain(palavra);
    expect(regra).toContain("nunca reprova por fato por causa dela");
    expect(regra).toContain("é a pessoa quem decide se tem e se grava");
    expect(aprovam).toContain("mostre na tela a foto de duas figuras conhecidas");
    expect(aprovam).toContain("ordem à pessoa, não afirmação sobre o negócio");
  });

  it("(2) número que está nas fontes, por extenso ou com R$, repetido com um espaço em colchete ao lado: o número é o da fonte e o espaço é de quem grava", () => {
    expect(regra).toContain("cento e oitenta reais");
    expect(regra).toContain('não reprove por "condição não dita"');
    expect(aprovam).toContain("sofá de 3 lugares por R$ 180");
    expect(aprovam).toContain(`o sofá de três lugares custa cento e oitenta reais ${MARCADOR_DE_ESPACO}`);
    expect(aprovam).toContain("o número é o da fonte, o espaço é de quem grava");
  });

  it("(3) o 'você já...' dirigido a quem assiste é o público, em pergunta ou em afirmação, e nunca um caso da pessoa", () => {
    expect(regra).toContain("vale como pergunta");
    expect(regra).toContain("também como afirmação dirigida a quem assiste");
    expect(regra).toContain("falam do PÚBLICO, nunca da pessoa que grava");
    expect(aprovam).toContain("você já mandou lavar o sofá uma vez e ele voltou manchado");
    expect(aprovam).toContain("fala com quem assiste, não é caso da pessoa");
  });

  it("(4) a consequência direta de um fato do perfil e o funcionamento geral do produto ou serviço não são fato inventado", () => {
    expect(regra).toContain("DEDUÇÃO DIRETA e CONHECIMENTO GERAL DO PRODUTO OU DO SERVIÇO");
    expect(aprovam).toContain("Cliente ideal: mora em apartamento, sem quintal");
    expect(aprovam).toContain("quem mora em apartamento sem quintal precisa resolver a mancha ali mesmo");
    expect(aprovam).toContain("consequência direta do perfil");
    expect(aprovam).toContain("o produto precisa de um tempo agindo no tecido");
    expect(aprovam).toContain("funcionamento geral do produto");
  });

  it("não abre brecha: o caso inventado, o número ou resultado fora das fontes, o cliente, o ingrediente e a prática do negócio continuam fato e reprovam", () => {
    expect(reprovam).toContain("um cliente meu, na semana passada, mandou lavar em outro lugar e o sofá voltou manchado");
    expect(reprovam).toContain("ontem uma cliente me contou");
    expect(reprovam).toContain("eu já mandei lavar o sofá e ele voltou manchado, por isso criei o meu método");
    expect(reprovam).toContain("o produto tira 100% da mancha em dez minutos");
    expect(reprovam).toContain("damos 30 dias de garantia");
    expect(reprovam).toContain("testo antes de entrar no kit");
    expect(regra).toContain("Continuam sendo fato, e reprovam: número, prazo ou resultado prometido ou medido que as fontes não trazem");
    expect(regra).toContain("cliente ou caso, nome de produto, de marca ou de ingrediente, e prática ou diferencial do negócio");
    expect(regra).toContain("na primeira pessoa ou com alguém identificado");
    expect(regra).toContain("NA DÚVIDA, APROVE");
  });
});

describe("verificarTexto 1.9.0: no gênero tema, recomendar a chamada para comprar e falar em segunda pessoa de direção não é tom errado", () => {
  it("o critério de tom do tema e o contexto do gênero dizem as duas coisas, e só reprovam o texto que tenta vender ao dono", () => {
    const sistema = montarSistemaEstavel("tema");
    expect(sistema).toContain("segunda pessoa de direção (grave, abra com, mostre, termine com)");
    expect(sistema).toContain("recomendar que o vídeo feche com uma chamada para comprar, citando o preço ou a oferta");
    expect(sistema).toContain("é o trabalho desta recomendação, não é direção para uma equipe nem propaganda, e nunca reprova");
    expect(sistema).toContain("reprove apenas se o próprio texto tentar vender algo ao dono (exclamação, urgência, promessa)");
    expect(sistema).toContain("isso é recomendar o roteiro, não é soar como briefing interno nem como propaganda de venda");
    // O briefing interno continua descartado como erro de gênero, como desde 29/09.
    expect(sistema).toContain("não um briefing interno nem direção para uma equipe");
  });

  it("os outros gêneros não ganham essa licença", () => {
    for (const genero of ["padrao", "analise", "roteiro", "regra"] as const) {
      expect(montarSistemaEstavel(genero)).not.toContain("recomendar que o vídeo feche com uma chamada para comprar");
    }
  });
});
