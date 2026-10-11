import { describe, expect, it } from "vitest";

import { construirSaidaMock } from "@/ia/mock";
import * as roteiroLongoIA from "@/ia/prompts/roteiroLongo";
import { verificarLocalmente } from "@/ia/verificador";
import { config } from "@/lib/config";

import { cenasDoBloco } from "./roteiro";
import { camposDoRoteiroLongo, conteudoDoRoteiroLongo, duracaoAlvoDaMedida, motivosDoRoteiroLongo } from "./roteiro-longo";
import type { MedidaDosLongos } from "./videos-longos";

const medida = (mediana: number, forca: MedidaDosLongos["forca"] = "indicio"): MedidaDosLongos => ({
  amostra: forca === "regra" ? 30 : forca === "indicio" ? 5 : 1,
  brasileiros: 0,
  forca,
  duracaoS: forca === "nenhuma" ? null : { p25: mediana - 60, mediana, p75: mediana + 60 },
  capitulos: null,
  titulos: [],
});

describe("duracaoAlvoDaMedida", () => {
  it("sem medida (amostra abaixo do mínimo) não há duração: o roteiro longo não sai", () => {
    expect(duracaoAlvoDaMedida(medida(600, "nenhuma"))).toBeNull();
    // mesmo que alguém preencha a duração por engano, a força manda
    expect(duracaoAlvoDaMedida({ ...medida(600, "nenhuma"), duracaoS: { p25: 500, mediana: 600, p75: 700 } })).toBeNull();
  });

  it("é a mediana do ramo, de 30 em 30 segundos", () => {
    expect(duracaoAlvoDaMedida(medida(600))).toBe(600);
    expect(duracaoAlvoDaMedida(medida(612))).toBe(600);
    expect(duracaoAlvoDaMedida(medida(615))).toBe(630);
    expect(duracaoAlvoDaMedida(medida(743))).toBe(750);
    expect(duracaoAlvoDaMedida(medida(900, "regra"))).toBe(900);
  });

  it("nunca vira um vídeo curto: o piso é o primeiro passo acima do teto dos curtos", () => {
    expect(duracaoAlvoDaMedida(medida(181))).toBe(config.regras.tetoDuracaoReferenciaS + 30);
    expect(duracaoAlvoDaMedida(medida(190))).toBe(config.regras.tetoDuracaoReferenciaS + 30);
  });

  it("nunca passa do limite do vídeo longo", () => {
    expect(duracaoAlvoDaMedida(medida(config.regras.videoLongoMaxS + 900))).toBe(config.regras.videoLongoMaxS);
  });
});

function entradaDeTeste(duracaoAlvoS: number, tema = "como tirar mancha de sofá"): string {
  return roteiroLongoIA.montarEntrada({
    tema,
    objetivo: "alcance",
    duracaoAlvoS,
    duracaoDoRamo: { p25: duracaoAlvoS - 60, mediana: duracaoAlvoS, p75: duracaoAlvoS + 60, amostra: 5, forca: "indicio" },
    estruturaDoRamo: null,
    titulosDoRamo: [],
    referencias: [],
    roteirosRecentes: [],
  });
}

function saidaBase(duracaoAlvoS = 600) {
  return roteiroLongoIA.schema.parse(construirSaidaMock("roteiroLongo", entradaDeTeste(duracaoAlvoS)));
}

describe("motivosDoRoteiroLongo", () => {
  it("a saída do simulador passa em tudo para qualquer duração-alvo de 3:30 a 40 minutos", () => {
    for (const alvo of [210, 240, 360, 600, 900, 1500, 2400]) {
      expect(motivosDoRoteiroLongo(saidaBase(alvo), alvo), `alvo ${alvo}`).toEqual([]);
    }
  });

  it("título vazio ou com mais de 100 caracteres reprova", () => {
    expect(motivosDoRoteiroLongo({ ...saidaBase(), titulo: "  " }, 600)).toEqual(["titulo: vazio"]);
    const motivos = motivosDoRoteiroLongo({ ...saidaBase(), titulo: "a".repeat(101) }, 600);
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toContain("101 caracteres");
  });

  it("gancho do vídeo e chamada final vazios reprovam", () => {
    expect(motivosDoRoteiroLongo({ ...saidaBase(), gancho: "" }, 600)[0]).toContain("gancho: vazio");
    expect(motivosDoRoteiroLongo({ ...saidaBase(), chamadaFinal: " " }, 600)[0]).toContain("chamadaFinal: vazia");
  });

  it("os capítulos entram na conferência: menos de três, um com menos de 10 segundos e a soma errada", () => {
    const base = saidaBase();
    expect(motivosDoRoteiroLongo({ ...base, capitulos: base.capitulos.slice(0, 2) }, 600).some((m) => m.includes("R-YT-VIDEO-07"))).toBe(true);
    const curto = base.capitulos.map((c, i) => (i === 1 ? { ...c, duracaoS: 4 } : c));
    expect(motivosDoRoteiroLongo({ ...base, capitulos: curto }, 600).some((m) => m.includes("R-YT-VIDEO-08"))).toBe(true);
    const somaErrada = base.capitulos.map((c) => ({ ...c, duracaoS: c.duracaoS * 2 }));
    expect(motivosDoRoteiroLongo({ ...base, capitulos: somaErrada }, 600).some((m) => m.includes("somar a duracao do video"))).toBe(true);
  });

  it("na segunda tentativa a soma não é exigida, mas a regra do YouTube e a faixa do vídeo longo continuam duras", () => {
    const base = saidaBase(600);
    const dobrada = { ...base, capitulos: base.capitulos.map((c) => ({ ...c, duracaoS: c.duracaoS * 1.4 })) };
    expect(motivosDoRoteiroLongo(dobrada, 600, 1).some((m) => m.includes("somar a duracao do video"))).toBe(true);
    expect(motivosDoRoteiroLongo(dobrada, 600, 2)).toEqual([]);
    // o que é regra segue duro na segunda: um capítulo de 4 segundos
    const curto = { ...dobrada, capitulos: dobrada.capitulos.map((c, i) => (i === 1 ? { ...c, duracaoS: 4 } : c)) };
    expect(motivosDoRoteiroLongo(curto, 600, 2).some((m) => m.includes("R-YT-VIDEO-08"))).toBe(true);
    // e a soma de um vídeo curto ou maior que o limite do longo reprova também na segunda
    const tudoPouco = { ...base, capitulos: base.capitulos.map((c) => ({ ...c, duracaoS: 20 })) };
    expect(motivosDoRoteiroLongo(tudoPouco, 600, 2).some((m) => m.includes("video curto"))).toBe(true);
    const demais = { ...base, capitulos: base.capitulos.map((c) => ({ ...c, duracaoS: 600 })) };
    expect(motivosDoRoteiroLongo(demais, 600, 2).some((m) => m.includes("maximo"))).toBe(true);
  });

  it("título com espaço marcado, miniatura vazia e onde gravar vazio reprovam", () => {
    const base = saidaBase();
    expect(motivosDoRoteiroLongo({ ...base, titulo: "Como fazer em [diga o lugar]" }, 600)[0]).toContain("colchetes");
    expect(motivosDoRoteiroLongo({ ...base, miniatura: " " }, 600)[0]).toContain("miniatura: vazia");
    expect(motivosDoRoteiroLongo({ ...base, ondeGravar: "" }, 600)[0]).toContain("ondeGravar: vazio");
  });

  it("o gancho de cada capítulo vem inteiro: vazio, só um rótulo ou longo demais reprova; o último capítulo não precisa de gancho", () => {
    const base = saidaBase();
    const comGancho = (i: number, gancho: string | null) => base.capitulos.map((c, j) => (j === i ? { ...c, ganchoParaOProximo: gancho } : c));
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comGancho(0, null) }, 600)[0]).toContain("capitulo 1: sem o gancho");
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comGancho(1, "o preço real") }, 600)[0]).toContain("capitulo 2: o gancho tem 3 palavras");
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comGancho(1, "mas e se der errado na sua casa") }, 600)).toEqual([]);
    const longo = Array.from({ length: 41 }, () => "palavra").join(" ");
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comGancho(1, longo) }, 600)[0]).toContain("41 palavras");
    const ultimo = base.capitulos.length - 1;
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comGancho(ultimo, null) }, 600)).toEqual([]);
  });

  it("o resto do capítulo vem em pontos curtos: de dois a quatro, de até 20 palavras cada", () => {
    const base = saidaBase();
    const comPontos = (i: number, pontos: string[]) => base.capitulos.map((c, j) => (j === i ? { ...c, pontos } : c));
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comPontos(0, ["um só"]) }, 600)[0]).toContain("capitulo 1: 1 pontos");
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comPontos(0, ["a", "b", "c", "d", "e"]) }, 600)[0]).toContain("capitulo 1: 5 pontos");
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comPontos(0, ["a", "b", "c", "d"]) }, 600)).toEqual([]);
    const com20 = Array.from({ length: 20 }, () => "palavra").join(" ");
    const com21 = `${com20} palavra`;
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comPontos(0, [com20, "b"]) }, 600)).toEqual([]);
    expect(motivosDoRoteiroLongo({ ...base, capitulos: comPontos(0, [com21, "b"]) }, 600)[0]).toContain("capitulo 1, ponto 1: 21 palavras");
  });

  it("capítulo sem o que mostrar ou sem como editar reprova", () => {
    const base = saidaBase();
    const mudar = (campo: "naImagem" | "comoEditar") => base.capitulos.map((c, j) => (j === 2 ? { ...c, [campo]: " " } : c));
    expect(motivosDoRoteiroLongo({ ...base, capitulos: mudar("naImagem") }, 600)[0]).toContain("capitulo 3: sem o que a camera mostra");
    expect(motivosDoRoteiroLongo({ ...base, capitulos: mudar("comoEditar") }, 600)[0]).toContain("capitulo 3: sem como editar");
  });

  it("os marcadores de teste do simulador reprovam cada um pelo seu motivo, e só na primeira tentativa", () => {
    const motivosCom = (marcador: string, retentativa = false) => {
      const entrada = `${entradaDeTeste(600, `tema ${marcador}`)}${retentativa ? "\n\nA tentativa anterior foi reprovada. Motivo: x. Corrija isso." : ""}`;
      return motivosDoRoteiroLongo(roteiroLongoIA.schema.parse(construirSaidaMock("roteiroLongo", entrada)), 600);
    };
    expect(motivosCom("[mock:capitulo-curto]").some((m) => m.includes("R-YT-VIDEO-08"))).toBe(true);
    expect(motivosCom("[mock:capitulo-curto]", true)).toEqual([]);
    expect(motivosCom("[mock:capitulo-curto-sempre]", true).some((m) => m.includes("R-YT-VIDEO-08"))).toBe(true);
    expect(motivosCom("[mock:soma-errada]").some((m) => m.includes("somar a duracao do video"))).toBe(true);
    expect(motivosCom("[mock:dois-capitulos]").some((m) => m.includes("R-YT-VIDEO-07"))).toBe(true);
    expect(motivosCom("[mock:sem-gancho]")[0]).toContain("capitulo 1: sem o gancho");
    expect(motivosCom("[mock:ponto-longo]")[0]).toContain("ponto 1");
  });
});

describe("camposDoRoteiroLongo", () => {
  it("devolve todo texto que a pessoa lê, para o verificador local pegar travessão, emoji e jargão em qualquer capítulo", () => {
    const base = saidaBase();
    const campos = camposDoRoteiroLongo(base);
    expect(campos.titulo).toBe(base.titulo);
    expect(campos.gancho).toBe(base.gancho);
    expect(campos.capitulo0Nome).toBe(base.capitulos[0].nome);
    expect(campos.capitulo1Ponto0).toBe(base.capitulos[1].pontos[0]);
    expect(campos.capitulo0Gancho).toBe(base.capitulos[0].ganchoParaOProximo);
    // o último capítulo não tem gancho
    expect(Object.keys(campos).some((k) => k === `capitulo${base.capitulos.length - 1}Gancho`)).toBe(false);

    expect(verificarLocalmente(campos, {}).aprovado).toBe(true);
    const sujo = camposDoRoteiroLongo({
      ...base,
      capitulos: base.capitulos.map((c, i) => (i === 3 ? { ...c, pontos: ["isso aumenta o alcance \u2014 de verdade", "b"] } : c)),
    });
    expect(verificarLocalmente(sujo, {}).aprovado).toBe(false);
  });
});

describe("conteudoDoRoteiroLongo", () => {
  it("o início de cada capítulo é a soma das durações antes dele, e a duração do roteiro é a soma dos capítulos", () => {
    const base = saidaBase(570);
    const { conteudo } = conteudoDoRoteiroLongo(base, []);
    const capitulos = conteudo.capitulos!;
    let esperado = 0;
    capitulos.forEach((c, i) => {
      expect(c.inicioS, `capitulo ${i + 1}`).toBe(esperado);
      esperado += Math.round(base.capitulos[i].duracaoS);
    });
    expect(conteudo.duracaoS).toBe(esperado);
    // o momento em segundos, a forma que os leitores do roteiro (página, modo gravação, PDF, imagem) leem: nenhuma cena se perde e a primeira abre o vídeo
    expect(conteudo.cenas.map((c) => c.momento)).toEqual(capitulos.map((c) => `${c.inicioS} segundos`));
    const blocos = (["abertura", "meio", "fechamento", "chamada"] as const).map((bloco) => cenasDoBloco(conteudo.cenas, conteudo.duracaoS, bloco));
    expect(blocos.flat()).toHaveLength(capitulos.length);
    expect(blocos[0].map((c) => c.momento)).toEqual(["0 segundos"]);
  });

  it("o último capítulo nunca guarda gancho, mesmo que o modelo escreva um", () => {
    const base = saidaBase();
    const ultimo = base.capitulos.length - 1;
    const comGanchoNoUltimo = { ...base, capitulos: base.capitulos.map((c, i) => (i === ultimo ? { ...c, ganchoParaOProximo: "e no próximo vídeo eu mostro mais" } : c)) };
    const { conteudo } = conteudoDoRoteiroLongo(comGanchoNoUltimo, []);
    expect(conteudo.capitulos![ultimo].ganchoParaOProximo).toBeNull();
    expect(conteudo.capitulos![0].ganchoParaOProximo).toBeTruthy();
  });

  it("os textos saem aparados e o nome do capítulo sem espaço repetido nem quebra de linha", () => {
    const base = saidaBase();
    const sujo = {
      ...base,
      titulo: "  Um título com espaços  ",
      gancho: "\n  abre direto  ",
      capitulos: base.capitulos.map((c, i) => (i === 0 ? { ...c, nome: "  Duas   palavras\n  e três  ", pontos: ["  ponto um  ", "   ", "ponto dois"] } : c)),
    };
    const { conteudo } = conteudoDoRoteiroLongo(sujo, []);
    expect(conteudo.titulo).toBe("Um título com espaços");
    expect(conteudo.gancho).toBe("abre direto");
    expect(conteudo.capitulos![0].nome).toBe("Duas palavras e três");
    expect(conteudo.capitulos![0].pontos).toEqual(["ponto um", "ponto dois"]);
  });

  it("as regras citadas são só as que existem na lista do roteiro longo", () => {
    const base = saidaBase();
    const comInventada = {
      ...base,
      porQueAssim: [...base.porQueAssim, { regra: "R-YT-VIDEO-99", motivo: "uma regra que não existe" }, { regra: "R-IG-REEL-01", motivo: "de outro formato" }],
    };
    const { conteudo } = conteudoDoRoteiroLongo(comInventada, []);
    expect(conteudo.porQueAssim.map((r) => r.regra).sort()).toEqual(["R-YT-VIDEO-01", "R-YT-VIDEO-13"]);
  });

  it("evidência e referência de edição são só as da entrada: um id fora da lista é descartado, nunca trocado por outro", () => {
    const base = saidaBase();
    const modelo = {
      ...base,
      evidencias: [11, 22, 999],
      edicao: { ...base.edicao, referencia: { videoId: 999, segundo: 4, oQueOlhar: "o inicio" } },
    };
    const { conteudo, referenciaVideoId } = conteudoDoRoteiroLongo(modelo, [11, 22]);
    expect(conteudo.evidencias).toEqual([11, 22]);
    expect(conteudo.edicao.referencia).toBeNull();
    expect(referenciaVideoId).toBeNull();
    expect(conteudo.semEvidencia).toBe(false);
    expect(conteudo.forcaEvidencia).toBe("media");

    const certa = conteudoDoRoteiroLongo({ ...modelo, edicao: { ...base.edicao, referencia: { videoId: 22, segundo: 275, oQueOlhar: "o inicio" } } }, [11, 22]);
    expect(certa.referenciaVideoId).toBe(22);
    // o modelo escolhe QUAL vídeo, nunca o segundo: o longo não tem momento-chave medido, e o segundo dele seria inventado (o mesmo cuidado do curto, PR #88)
    expect(certa.conteudo.edicao.referencia?.segundo).toBe(0);
  });

  it("sem referências no ramo: sem evidência, sem força e nada citado, mesmo que o modelo cite", () => {
    const base = saidaBase();
    const { conteudo, referenciaVideoId } = conteudoDoRoteiroLongo({ ...base, evidencias: [5, 6], edicao: { ...base.edicao, referencia: { videoId: 5, segundo: 0, oQueOlhar: "x" } } }, []);
    expect(conteudo.semEvidencia).toBe(true);
    expect(conteudo.evidencias).toEqual([]);
    expect(conteudo.forcaEvidencia).toBeNull();
    expect(referenciaVideoId).toBeNull();
  });

  it("o texto corrido que o resto do produto lê traz os capítulos numerados, e a chamada final fica no campo dela", () => {
    const base = saidaBase();
    const { conteudo } = conteudoDoRoteiroLongo(base, []);
    expect(conteudo.corpo.split("\n")).toHaveLength(base.capitulos.length);
    expect(conteudo.corpo.startsWith(`1. ${base.capitulos[0].nome}: `)).toBe(true);
    expect(conteudo.chamadaFinal).toBe(base.chamadaFinal);
    expect(conteudo.fechamento).toBe(base.capitulos[base.capitulos.length - 1].pontos.join("; "));
  });
});
