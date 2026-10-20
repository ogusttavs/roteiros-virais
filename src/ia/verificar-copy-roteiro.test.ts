/**
 * E50 parte 2, PR 2: o verificador por código da seção 11. Cada regra tem um caso que reprova e um
 * que passa; as fronteiras (indício nunca reprova, R-CONF reprova na segunda tentativa, as outras
 * viram aviso) e a ligação com a tabela gerada têm teste próprio.
 */
import { describe, expect, it } from "vitest";

import { REGRAS_COPY_ROTEIRO } from "./prompts/regras-copy-roteiro";
import {
  type EntradaCopyRoteiro,
  REGRAS_QUE_REPROVAM,
  TETO_PALAVRAS_FECHAMENTO,
  montarEntradaCopyRoteiro,
  verificarRegrasCopyRoteiro,
} from "./verificar-copy-roteiro";

/** Um Reels que passa em tudo: o ponto de partida de cada caso. */
const BOM = {
  gancho: "Em 5 minutos tiro a mancha do box da Neusa sem esfregar.",
  corpo:
    "Primeiro eu molho o vidro com vinagre. Depois deixo agir por dez minutos. Aí passo o rodo e a mancha sai. Gravei isso na casa dela, em Campinas, com o produto que tenho aqui.",
  fechamento: "O box ficou transparente de novo, sem esforço nenhum.",
  chamadaFinal: "Me chama no WhatsApp que eu te mostro como faz no seu box.",
};

function entrada(mudancas: Partial<EntradaCopyRoteiro> = {}): EntradaCopyRoteiro {
  const base = { ...BOM, ...mudancas };
  return {
    estrutura: "reels_falado",
    textoTodo: [base.gancho, base.corpo, base.fechamento, base.chamadaFinal].join(". "),
    frasesNaTela: [],
    fontes: "perfil: limpeza de vidros em Campinas",
    ramoSaude: false,
    tentativa: 1,
    tipoAbertura: "numero",
    ...base,
    ...mudancas,
  };
}
const reprovam = (m: Partial<EntradaCopyRoteiro>) => verificarRegrasCopyRoteiro(entrada(m)).reprovam;
const avisos = (m: Partial<EntradaCopyRoteiro>) => verificarRegrasCopyRoteiro(entrada(m)).avisos;
const com = (lista: string[], regra: string) => lista.some((m) => m.startsWith(`${regra}:`));

describe("o roteiro bom passa limpo", () => {
  it("sem reprovação e sem aviso", () => {
    expect(verificarRegrasCopyRoteiro(entrada())).toEqual({ reprovam: [], avisos: [] });
  });
});

describe("ligação com a tabela gerada", () => {
  it("toda regra que reprova é 'sim' na tabela e de força forte ou média (indício nunca reprova)", () => {
    const porNumero = new Map(REGRAS_COPY_ROTEIRO.map((r) => [r.numero, r]));
    for (const numero of REGRAS_QUE_REPROVAM) {
      const regra = porNumero.get(numero);
      expect(regra, numero).toBeDefined();
      expect(regra?.conferePorCodigo, numero).toBe("sim");
      expect(regra?.forca, numero).not.toBe("indicio");
    }
  });

  it("toda regra 'sim' de força forte ou média da tabela está implementada", () => {
    const esperadas = REGRAS_COPY_ROTEIRO.filter((r) => r.conferePorCodigo === "sim" && r.forca !== "indicio").map((r) => r.numero).sort();
    expect([...REGRAS_QUE_REPROVAM].sort()).toEqual(esperadas);
  });
});

describe("R-CONF-03: grátis só se a ficha diz", () => {
  it("reprova 'grátis' no gancho sem a ficha dizer", () => {
    expect(com(reprovam({ gancho: "Orçamento grátis para o seu box de vidro." }), "R-CONF-03")).toBe(true);
  });
  it("reprova 'sem custo' na chamada", () => {
    expect(com(reprovam({ chamadaFinal: "Me chama no WhatsApp, é sem custo." }), "R-CONF-03")).toBe(true);
  });
  it("passa quando a ficha diz que não há custo", () => {
    expect(com(reprovam({ gancho: "Orçamento grátis para o seu box de vidro.", fontes: "ficha: o orçamento é gratuito" }), "R-CONF-03")).toBe(false);
  });
  it("'grátis' no corpo não conta (a regra é do gancho e da chamada)", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " O vinagre é grátis, tem em casa." }), "R-CONF-03")).toBe(false);
  });
});

describe("R-CONF-04: pesquisa e percentual sem fonte", () => {
  it("reprova percentual sem fonte", () => {
    expect(com(reprovam({ corpo: "Oito em cada dez casas têm esse problema, 80% delas." }), "R-CONF-04")).toBe(true);
  });
  it("reprova 'estudo' com número e sem fonte dita", () => {
    expect(com(reprovam({ corpo: "Um estudo mostra que 3 de 4 pessoas limpam errado." }), "R-CONF-04")).toBe(true);
  });
  it("100% natural, 50% de desconto e 'estudo 3 horas por dia' são da oferta ou da pessoa, não pesquisa", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " O produto é 100% natural. Hoje tem 50% de desconto. Eu estudo 3 horas por dia para isso." }), "R-CONF-04")).toBe(false);
    expect(com(reprovam({ corpo: BOM.corpo + " Fiz uma pesquisa de preço em 5 lojas." }), "R-CONF-04")).toBe(false);
  });
  it("'3 segundos' não é atribuição", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Em 3 segundos, 80% das pessoas já desistem." }), "R-CONF-04")).toBe(true);
  });
  it("na segunda tentativa o R-CONF-04 e a R-CONF-03 seguem reprovando (conformidade não afrouxa)", () => {
    const r = verificarRegrasCopyRoteiro(entrada({ tentativa: 2, corpo: "Um estudo mostra que 3 de 4 pessoas limpam errado.", gancho: "Orçamento grátis do box de 5 mil." }));
    expect(com(r.reprovam, "R-CONF-04")).toBe(true);
    expect(com(r.avisos, "R-CONF-04")).toBe(false);
    expect(com(r.reprovam, "R-CONF-03")).toBe(true);
  });
  it("passa com a fonte dita na fala", () => {
    expect(com(reprovam({ corpo: "Segundo o IBGE, em 2025, 80% das casas têm box de vidro." }), "R-CONF-04")).toBe(false);
  });
  it("passa quando o percentual está nas fontes da entrada", () => {
    expect(com(reprovam({ corpo: "Mais de 80% dos clientes voltam.", fontes: "ficha: 80% dos clientes voltam" }), "R-CONF-04")).toBe(false);
  });
  it("passa com 'na minha experiência'", () => {
    expect(com(reprovam({ corpo: "Na minha experiência, 8 de cada 10 box têm essa mancha." }), "R-CONF-04")).toBe(false);
  });
});

describe("R-CONF-07: ramo de saúde", () => {
  it("reprova 'garantido' em ramo de saúde", () => {
    expect(com(reprovam({ ramoSaude: true, chamadaFinal: "Resultado garantido, me chama no WhatsApp." }), "R-CONF-07")).toBe(true);
  });
  it("reprova 'cura' e '100%' no gancho", () => {
    expect(com(reprovam({ ramoSaude: true, gancho: "Cura garantida da dor de dente em 5 minutos." }), "R-CONF-07")).toBe(true);
    expect(com(reprovam({ ramoSaude: true, gancho: "Clareamento 100% seguro em 5 sessões." }), "R-CONF-07")).toBe(true);
  });
  it("fora da saúde a mesma frase não reprova", () => {
    expect(com(reprovam({ ramoSaude: false, chamadaFinal: "Resultado garantido, me chama no WhatsApp." }), "R-CONF-07")).toBe(false);
  });
  it("conversa honesta de clínica não reprova: 'tem cura?', 'o diagnóstico precoce', 'faço o diagnóstico na avaliação'", () => {
    const corpo = BOM.corpo + " Gengivite tem cura? Tem, se pegar cedo. O diagnóstico precoce muda tudo e eu faço o diagnóstico na avaliação.";
    expect(com(reprovam({ ramoSaude: true, corpo }), "R-CONF-07")).toBe(false);
  });
  it("diagnóstico à distância reprova", () => {
    expect(com(reprovam({ ramoSaude: true, chamadaFinal: "Manda a foto no WhatsApp que eu faço o diagnóstico por foto." }), "R-CONF-07")).toBe(true);
  });
  it("'curar' não pega 'curado' nem 'procura'", () => {
    expect(com(reprovam({ ramoSaude: true, corpo: BOM.corpo + " Quem procura um dentista de confiança já chega melhor." }), "R-CONF-07")).toBe(false);
  });
});

describe("R-CONF-09: palavrão", () => {
  it("reprova palavrão no corpo", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Que porra de mancha difícil." }), "R-CONF-09")).toBe(true);
  });
  it("não pega palavra parecida (computador, putaria só em palavra inteira)", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Uso uma caneta computadorizada." }), "R-CONF-09")).toBe(false);
  });
});

describe("as R-CONF vêm antes e valem na segunda tentativa; as outras viram aviso", () => {
  const ruim = {
    gancho: "Pessoal, orçamento grátis para o seu box!",
    fechamento: "Então é isso.",
  };
  it("na primeira tentativa, R-CONF-03 aparece antes das demais", () => {
    const r = reprovam(ruim);
    expect(r.length).toBeGreaterThan(1);
    expect(r[0].startsWith("R-CONF-")).toBe(true);
  });
  it("na segunda tentativa só a R-CONF reprova; as outras passam para os avisos", () => {
    const r = verificarRegrasCopyRoteiro(entrada({ ...ruim, tentativa: 2 }));
    expect(r.reprovam.every((m) => m.startsWith("R-CONF-"))).toBe(true);
    expect(r.reprovam.length).toBe(1);
    expect(com(r.avisos, "R-COPY-01")).toBe(true);
  });
});

describe("R-COPY-01: vocativo coletivo", () => {
  it("reprova 'pessoal,' e 'galera!'", () => {
    expect(com(reprovam({ gancho: "Pessoal, olha esse truque do box de vidro." }), "R-COPY-01")).toBe(true);
    expect(com(reprovam({ gancho: "Fala galera, olha esse truque do box de vidro." }), "R-COPY-01")).toBe(true);
  });
  it("só o vocativo no começo da frase reprova", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Muita gente, quando vê a mancha, esfrega. Eu tenho 10 mil seguidores, e nenhum erra." }), "R-COPY-01")).toBe(false);
  });
  it("'você' no gancho nunca reprova", () => {
    expect(com(reprovam({ gancho: "Você sabe tirar a mancha do box de vidro em 5 minutos?" }), "R-COPY-01")).toBe(false);
  });
  it("'a gente' (nós) não é vocativo, nem 'o pessoal da loja'", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " A gente, aqui na loja, faz assim. O pessoal da loja aprendeu comigo." }), "R-COPY-01")).toBe(false);
  });
});

describe("R-COPY-02: propaganda e adjetivo empilhado", () => {
  it("reprova palavra de propaganda", () => {
    expect(com(reprovam({ gancho: "Uma oportunidade única de limpar o box em 5 minutos." }), "R-COPY-02")).toBe(true);
    expect(com(reprovam({ corpo: BOM.corpo + " É um produto revolucionário." }), "R-COPY-02")).toBe(true);
  });
  it("reprova três adjetivos vagos na mesma frase", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " O resultado fica lindo, perfeito e maravilhoso." }), "R-COPY-02")).toBe(true);
  });
  it("'não perca tempo' é pedido legítimo, 'não perca' a oferta é propaganda", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Não perca tempo esfregando." }), "R-COPY-02")).toBe(false);
    expect(com(reprovam({ corpo: BOM.corpo + " Não perca essa oferta." }), "R-COPY-02")).toBe(true);
  });
  it("dois adjetivos soltos em frases diferentes não reprovam", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " O vidro fica lindo. O trabalho é perfeito." }), "R-COPY-02")).toBe(false);
  });
});

describe("R-COPY-08: fato específico no lugar de superlativo", () => {
  it("reprova superlativo", () => {
    expect(com(reprovam({ gancho: "O melhor produto para tirar mancha do box em 5 minutos." }), "R-COPY-08")).toBe(true);
    expect(com(reprovam({ corpo: BOM.corpo + " Somos o mais barato da região." }), "R-COPY-08")).toBe(true);
  });
  it("reprova quando não há nenhum número nem nome próprio", () => {
    const r = reprovam({
      gancho: "Tire a mancha do vidro sem esfregar nada.",
      corpo: "Molhe o vidro com vinagre. Deixe agir um pouco. Passe o rodo e pronto.",
    });
    expect(com(r, "R-COPY-08")).toBe(true);
  });
  it("em Story e sem fala a exigência de número ou nome não roda (o texto na tela é curto), mas o superlativo continua reprovando", () => {
    const so = { estrutura: "cartoes" as const, gancho: "tire a mancha do vidro", corpo: "molhe e passe o rodo" };
    expect(com(reprovam(so), "R-COPY-08")).toBe(false);
    expect(com(reprovam({ ...so, corpo: "o melhor produto do mercado" }), "R-COPY-08")).toBe(true);
  });
  it("passa com um nome próprio no meio da frase", () => {
    const r = reprovam({
      gancho: "Tire a mancha do vidro sem esfregar nada.",
      corpo: "Molhe o vidro com vinagre. Foi assim na casa da Neusa. Passe o rodo e pronto.",
    });
    expect(com(r, "R-COPY-08")).toBe(false);
  });
  it("'erro número 1' e 'o melhor de tudo' não são superlativo comercial", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Esse é o erro número 1. O melhor de tudo é que dura." }), "R-COPY-08")).toBe(false);
    expect(com(reprovam({ corpo: BOM.corpo + " Somos o número 1 do Brasil." }), "R-COPY-08")).toBe(true);
  });
  it("'o melhor jeito' (sem a lista) não reprova", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " O melhor jeito de começar é molhar o vidro." }), "R-COPY-08")).toBe(false);
  });
});

describe("R-COPY-23: autoelogio e ataque", () => {
  it("reprova autoelogio e ataque a concorrente e a cliente", () => {
    expect(com(reprovam({ corpo: BOM.corpo + " Somos os melhores da cidade." }), "R-COPY-23")).toBe(true);
    expect(com(reprovam({ corpo: BOM.corpo + " Os concorrentes são picaretas." }), "R-COPY-23")).toBe(true);
    expect(com(reprovam({ corpo: BOM.corpo + " Tem cliente burro que não lê a bula." }), "R-COPY-23")).toBe(true);
  });
});

describe("R-COPY-25: uma só ação", () => {
  it("reprova dois canais na chamada", () => {
    expect(com(reprovam({ chamadaFinal: "Me chama no WhatsApp ou liga no telefone da loja." }), "R-COPY-25")).toBe(true);
  });
  it("'Comente QUERO que eu te mando no Direct' é uma ação só", () => {
    expect(com(reprovam({ chamadaFinal: "Comente QUERO que eu te mando no Direct." }), "R-COPY-25")).toBe(false);
  });
  it("reprova quando só manda comprar", () => {
    expect(com(reprovam({ chamadaFinal: "Compre já o seu." }), "R-COPY-25")).toBe(true);
  });
  it("passa com um canal e 'compre' junto de outro verbo", () => {
    expect(com(reprovam({ chamadaFinal: "Me chama no WhatsApp antes de comprar, que eu tiro sua dúvida." }), "R-COPY-25")).toBe(false);
  });
  it("não roda em Story e sem fala", () => {
    expect(com(reprovam({ estrutura: "cartoes", chamadaFinal: "Chama no WhatsApp ou liga." }), "R-COPY-25")).toBe(false);
  });
});

describe("R-ROTEIRO-01, 14 e 15 (só no Reels falado)", () => {
  it("R-ROTEIRO-01 reprova fechamento vazio, corpo vazio, gancho vazio", () => {
    expect(com(reprovam({ fechamento: "" }), "R-ROTEIRO-01")).toBe(true);
    expect(com(reprovam({ corpo: " " }), "R-ROTEIRO-01")).toBe(true);
  });
  it("R-ROTEIRO-14 reprova encerramento vazio no último bloco", () => {
    expect(com(reprovam({ chamadaFinal: "Então é isso, gente, obrigado por assistir." }), "R-ROTEIRO-14")).toBe(true);
    expect(com(reprovam({ chamadaFinal: "Obrigado por assistir." }), "R-ROTEIRO-14")).toBe(true);
  });
  it("R-ROTEIRO-14 reprova o encerramento vazio mesmo quando o resto da frase traz um verbo de ação", () => {
    expect(com(reprovam({ chamadaFinal: "Então é isso, me chama no WhatsApp." }), "R-ROTEIRO-14")).toBe(true);
    expect(com(reprovam({ chamadaFinal: "Valeu, me chama no WhatsApp." }), "R-ROTEIRO-14")).toBe(true);
  });
  it("R-ROTEIRO-14 aceita pedidos comuns: 'Faça seu orçamento', 'Garanta o seu', 'Link na bio'", () => {
    for (const c of ["Faça seu orçamento no WhatsApp.", "Garanta o seu antes que acabe.", "Link na bio."]) {
      expect(com(reprovam({ chamadaFinal: c }), "R-ROTEIRO-14"), c).toBe(false);
    }
  });
  it("R-ROTEIRO-14 não confunde 'conteúdo' com 'conte' nem 'É isso que eu faço' com encerramento", () => {
    expect(com(reprovam({ chamadaFinal: "O conteúdo fica claro." }), "R-ROTEIRO-14")).toBe(true);
    expect(com(reprovam({ chamadaFinal: "É isso que eu faço: me chama no WhatsApp." }), "R-ROTEIRO-14")).toBe(false);
  });
  it("R-ROTEIRO-14 reprova último bloco sem ação nem pergunta", () => {
    expect(com(reprovam({ chamadaFinal: "O box fica transparente." }), "R-ROTEIRO-14")).toBe(true);
  });
  it("R-ROTEIRO-14 aceita pergunta ao espectador", () => {
    expect(com(reprovam({ chamadaFinal: "Qual box você quer ver limpo?" }), "R-ROTEIRO-14")).toBe(false);
  });
  it("R-ROTEIRO-14 usa o fechamento quando não há chamada", () => {
    expect(com(reprovam({ chamadaFinal: "", fechamento: "Obrigado por assistir." }), "R-ROTEIRO-14")).toBe(true);
  });
  it("R-ROTEIRO-15 reprova fechamento longo ou com mais de duas frases", () => {
    const longo = Array.from({ length: 50 }, () => "palavra").join(" ");
    expect(TETO_PALAVRAS_FECHAMENTO).toBe(45);
    expect(com(reprovam({ fechamento: longo }), "R-ROTEIRO-15")).toBe(true);
    expect(com(reprovam({ fechamento: "Ficou limpo. Ficou claro. Ficou novo." }), "R-ROTEIRO-15")).toBe(true);
    expect(com(reprovam({ fechamento: "Ficou limpo. Ficou claro." }), "R-ROTEIRO-15")).toBe(false);
    // ponto dentro de número não divide a frase
    expect(com(reprovam({ fechamento: "Saiu por R$ 1.500 e ficou novo. Ficou claro." }), "R-ROTEIRO-15")).toBe(false);
  });
  it("em Story e sem fala nenhuma das três roda", () => {
    const r = reprovam({ estrutura: "cartoes", fechamento: "", chamadaFinal: "Obrigado por assistir." });
    expect(com(r, "R-ROTEIRO-01")).toBe(false);
    expect(com(r, "R-ROTEIRO-14")).toBe(false);
    expect(com(r, "R-ROTEIRO-15")).toBe(false);
  });
});

describe("os avisos (nunca reprovam)", () => {
  it("R-COPY-03: frase com mais de 20 palavras", () => {
    const frase = Array.from({ length: 24 }, (_, i) => `palavra${i}`).join(" ");
    const r = verificarRegrasCopyRoteiro(entrada({ corpo: `${BOM.corpo} ${frase}.` }));
    expect(com(r.avisos, "R-COPY-03")).toBe(true);
    expect(com(r.reprovam, "R-COPY-03")).toBe(false);
  });
  it("R-COPY-10: nome da marca ausente, só quando a marca tem nome", () => {
    expect(com(avisos({ nomeDaMarca: "Vidraçaria Cristal" }), "R-COPY-10")).toBe(true);
    expect(com(avisos({ nomeDaMarca: "Neusa" }), "R-COPY-10")).toBe(false);
    expect(com(avisos({ nomeDaMarca: undefined }), "R-COPY-10")).toBe(false);
  });
  it("R-COPY-21: prova genérica é aviso, nunca reprovação (depois da decisão de 20/10/2026)", () => {
    const r = verificarRegrasCopyRoteiro(entrada({ corpo: BOM.corpo + " Todo mundo faz assim, a maioria prefere." }));
    expect(com(r.avisos, "R-COPY-21")).toBe(true);
    expect(com(r.reprovam, "R-COPY-21")).toBe(false);
  });
  it("R-ROTEIRO-04: primeira frase longa e tema fora do começo do gancho", () => {
    const longo = "Hoje eu vou mostrar para vocês um jeito simples que ninguém conta de deixar o vidro limpo.";
    const r = verificarRegrasCopyRoteiro(entrada({ gancho: longo, palavrasDoTema: ["mancha"] }));
    expect(r.avisos.filter((m) => m.startsWith("R-ROTEIRO-04")).length).toBe(2);
  });
  it("R-ROTEIRO-06: tipo de abertura não registrado", () => {
    expect(com(avisos({ tipoAbertura: null }), "R-ROTEIRO-06")).toBe(true);
  });
  it("R-ROTEIRO-16: abertura pesada demais, só com texto suficiente", () => {
    const abertura = Array.from({ length: 70 }, (_, i) => `a${i}`).join(" ");
    const r = avisos({ gancho: abertura, corpo: "corpo curto aqui", fechamento: "fim curto", chamadaFinal: "chama aqui" });
    expect(com(r, "R-ROTEIRO-16")).toBe(true);
    expect(com(avisos({ gancho: "a b", corpo: "c d", fechamento: "e", chamadaFinal: "f" }), "R-ROTEIRO-16")).toBe(false);
  });
});

describe("montarEntradaCopyRoteiro", () => {
  const contexto = { fontes: "f", ramoSaude: false, tentativa: 1 as const };
  it("Reels falado usa os quatro blocos e junta o texto da tela", () => {
    const e = montarEntradaCopyRoteiro(
      { ...BOM, cartoes: null, edicao: { textoNaTela: [{ oQue: "5 minutos" }] }, tipoAbertura: "numero" },
      contexto,
    );
    expect(e.estrutura).toBe("reels_falado");
    expect(e.textoTodo).toContain("5 minutos");
    expect(e.frasesNaTela).toEqual(["5 minutos"]);
  });
  it("cartões: primeiro vira gancho, o do meio corpo, o último chamada; sem fala usa o texto na tela", () => {
    const e = montarEntradaCopyRoteiro(
      {
        gancho: null,
        corpo: null,
        fechamento: null,
        chamadaFinal: null,
        cartoes: [
          { oQueFalar: "Primeiro", textoNaTela: "um" },
          { oQueFalar: "", textoNaTela: "meio na tela" },
          { oQueFalar: "Último", textoNaTela: "fim" },
        ],
        edicao: { textoNaTela: [] },
        tipoAbertura: null,
      },
      contexto,
    );
    expect(e.estrutura).toBe("cartoes");
    expect(e.gancho).toBe("Primeiro um");
    expect(e.corpo).toBe("meio na tela");
    expect(e.chamadaFinal).toBe("Último fim");
  });
  it("um cartão só é o gancho e não tem chamada separada", () => {
    const e = montarEntradaCopyRoteiro(
      { gancho: null, corpo: null, fechamento: null, chamadaFinal: null, cartoes: [{ oQueFalar: "Só um", textoNaTela: "" }], edicao: { textoNaTela: [] }, tipoAbertura: null },
      contexto,
    );
    expect(e.gancho).toBe("Só um");
    expect(e.corpo).toBe("");
    expect(e.chamadaFinal).toBe("");
  });
});
