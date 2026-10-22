import { describe, expect, it } from "vitest";

import { OBJETIVOS_EM_ORDEM } from "@/ia/enums";
import { encontrarProblemas } from "@/lib/regras-de-texto";

import { construirSaidaMock } from "../mock";

import { REGRAS_YT_CAPITULOS, REGRAS_YT_VIDEO } from "./regras-formato";
import * as roteiroLongo from "./roteiroLongo";

const sistema = (extra: Partial<Parameters<typeof roteiroLongo.montarSistemaEstavel>[0]> = {}) =>
  roteiroLongo.montarSistemaEstavel({
    perfilCompilado: "PERFIL: kit tira-mancha",
    modeloNicho: "MODELO: vídeos curtos do ramo",
    camadaExclusiva: "CAMADA: Campinas",
    regrasCliente: [],
    tipo: "negocio",
    ...extra,
  });

const entrada = (extra: Partial<Parameters<typeof roteiroLongo.montarEntrada>[0]> = {}) =>
  roteiroLongo.montarEntrada({
    tema: "como tirar mancha de sofá",
    // OBJETIVOS_EM_ORDEM[0] (nao o literal, checar-texto varre este diretorio): o objetivo "mais gente te conheça".
    objetivo: OBJETIVOS_EM_ORDEM[0],
    duracaoAlvoS: 600,
    duracaoDoRamo: { p25: 480, mediana: 600, p75: 780, amostra: 12, forca: "indicio" },
    estruturaDoRamo: null,
    titulosDoRamo: [],
    referencias: [],
    roteirosRecentes: [],
    ...extra,
  });

describe("o prompt do roteiro longo", () => {
  it("é uma tarefa própria, no modelo forte, com versão", () => {
    expect(roteiroLongo.versao).toBe("1.3.0");
    expect(roteiroLongo.nivel).toBe("forte");
  });

  it("o sistema traz as regras do vídeo longo e as quatro dos capítulos, numeradas, e não as de ajuda ao cliente", () => {
    const texto = sistema();
    for (const r of REGRAS_YT_VIDEO) expect(texto).toContain(r.numero);
    for (const numero of ["R-YT-VIDEO-05", "R-YT-VIDEO-06", "R-YT-VIDEO-07", "R-YT-VIDEO-08", "R-YT-VIDEO-13"]) expect(texto).toContain(numero);
    // as de como desligar os capítulos automáticos e de acesso à opção não mudam o que se escreve
    for (const numero of ["R-YT-VIDEO-09", "R-YT-VIDEO-10", "R-YT-VIDEO-11", "R-YT-VIDEO-12", "R-YT-VIDEO-14", "R-YT-VIDEO-15"]) expect(texto).not.toContain(numero);
    expect(REGRAS_YT_CAPITULOS).toHaveLength(11);
  });

  it("diz o formato do capítulo: o gancho vem inteiro e o resto em pontos curtos, o último sem gancho", () => {
    const texto = sistema();
    expect(texto).toContain("UMA frase inteira");
    expect(texto).toContain("de 2 a 4 pontos curtos");
    expect(texto).toContain("de 4 a 40 palavras");
    // os limites que o verificador impõe estão ditos ao modelo, com os mesmos números
    expect(texto).toContain("O título do vídeo tem até 100 caracteres");
    expect(texto).toContain("não leva colchetes");
    expect(texto).toContain("no máximo 20 palavras cada");
    expect(texto).toContain("o último capítulo não tem gancho");
    expect(texto).toContain("Só o gancho do vídeo");
  });

  it("não deixa nenhuma regra de fato de lado: sem inventar, com espaço marcado", () => {
    expect(sistema()).toContain("[diga aqui onde você está]");
    expect(sistema()).toContain("nunca é fato deste roteiro");
  });

  it("entra o perfil, a camada exclusiva e o modelo do nicho", () => {
    const texto = sistema();
    expect(texto).toContain("PERFIL: kit tira-mancha");
    expect(texto).toContain("CAMADA: Campinas");
    expect(texto).toContain("MODELO: vídeos curtos do ramo");
  });

  it("a voz muda com o tipo e com quem aparece", () => {
    expect(sistema({ tipo: "pessoa" })).toContain("primeira pessoa do singular");
    expect(sistema({ tipo: "negocio", quemAparece: "equipe" })).toContain("a equipe, o dono não aparece");
    expect(sistema({ tipo: "negocio", quemAparece: "outra_pessoa" })).toContain("outra pessoa");
    expect(sistema({ persona: "conhecido" })).toContain("nunca é preço, comprar ou agendar");
    expect(sistema()).not.toContain("o dono não aparece");
  });

  it("regra do cliente reprovada entra como firme ou fraca", () => {
    const texto = sistema({ regrasCliente: [{ regra: "não abrir com pergunta", contagem: 3 }, { regra: "evitar gíria", contagem: 1 }] });
    expect(texto).toContain("não abrir com pergunta (firme)");
    expect(texto).toContain("evitar gíria (fraca)");
  });

  it("sem travessão, sem emoji e sem jargão no que o modelo lê (a mesma regra do checar-texto, na fonte única)", () => {
    const tudo = `${sistema({ regrasCliente: [{ regra: "x", contagem: 1 }] })}
${entrada()}`;
    expect(encontrarProblemas(tudo)).toEqual([]);
  });
});

describe("a entrada do roteiro longo", () => {
  it("diz a duração em segundos e em minutos, e de onde ela vem (a medida do ramo, com a força)", () => {
    const texto = entrada();
    expect(texto).toContain("Duração do vídeo: 600 segundos (10:00)");
    expect(texto).toContain("12 vídeos longos do ramo");
    expect(texto).toContain("de 8:00 a 13:00, com mediana de 10:00");
    expect(texto).toContain("indício, de poucos vídeos");
    expect(entrada({ duracaoDoRamo: { p25: 480, mediana: 600, p75: 780, amostra: 40, forca: "regra" } })).toContain("regra do ramo");
  });

  it("a estrutura típica entra quando medida, e quando não, a entrada diz que escolha a divisão do assunto", () => {
    const com = entrada({ estruturaDoRamo: { videosComLista: 8, quantidadeMediana: 6, tamanhoMedianoS: 100, forca: "indicio" } });
    expect(com).toContain("6 capítulos, de uns 1:40 cada");
    expect(com).toContain("8 vídeos com lista");
    expect(entrada()).toContain("A estrutura típica ainda não foi medida");
  });

  it("as referências entram com o id, a abertura, os capítulos e os tempos; sem referência, não cita id nem inventa vídeo", () => {
    const referencia = {
      id: 321,
      titulo: "Como tirar mancha de sofá em 5 passos",
      duracaoS: 640,
      abertura: { promessa: "mostra o antes e o depois", entregaAteS: 25 },
      capitulos: [
        { inicioS: 0, nome: "O antes e o depois", oQueFaz: "mostra o resultado", gancho: null },
        { inicioS: 95, nome: "O que usar", oQueFaz: "lista os produtos", gancho: "e o erro que estraga o sofá vem depois" },
      ],
      lacos: [{ oQue: "promete mostrar o erro mais comum" }],
      fechamento: { oQueFaz: "pede o comentário", apontaParaProximoVideo: true },
      tempos: "exatos" as const,
    };
    const com = entrada({ referencias: [referencia] });
    expect(com).toContain("id 321: Como tirar mancha de sofá em 5 passos (10:40)");
    expect(com).toContain("entrega até 0:25");
    expect(com).toContain("1:35 O que usar: lista os produtos (gancho: e o erro que estraga o sofá vem depois)");
    expect(com).toContain("tempos exatos");
    expect(com).toContain("aponta para o próximo vídeo");
    const sem = entrada();
    expect(sem).toContain("não cite nenhum id");
    expect(sem).not.toMatch(/\bid \d+:/);
  });

  it("o momento descrito troca o tema, e a versão reprovada pede outra divisão sem repetir o gancho", () => {
    const momento = entrada({ momento: { onde: "na sala", oQueEstaAcontecendo: "limpando o sofá", oQueDaParaMostrar: "a mancha saindo" } });
    expect(momento).toContain("O momento que a pessoa descreveu agora:");
    expect(momento).not.toContain("Tema escolhido:");

    const reprovado = entrada({ anguloParaEvitar: { gancho: "olha esta mancha", motivos: ["gancho fraco"], motivoTexto: "muito genérico" } });
    expect(reprovado).toContain("reprovou a versão anterior");
    expect(reprovado).toContain('A versão reprovada abre com: "olha esta mancha"');
    expect(reprovado).toContain("Não repita o gancho nem a divisão dela.");
  });
});

describe("o schema do roteiro longo", () => {
  it("aceita o que o simulador devolve e troca um tom fora da lista por 'direto'", () => {
    const saida = construirSaidaMock("roteiroLongo", entrada()) as { capitulos: { tom: string }[] };
    expect(roteiroLongo.schema.safeParse(saida).success).toBe(true);
    const comTomInventado = { ...saida, capitulos: saida.capitulos.map((c) => ({ ...c, tom: "empolgadíssimo" })) };
    const lido = roteiroLongo.schema.parse(comTomInventado);
    expect(lido.capitulos.every((c) => c.tom === "direto")).toBe(true);
  });
});
