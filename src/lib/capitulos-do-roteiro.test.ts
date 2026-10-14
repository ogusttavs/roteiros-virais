import { describe, expect, it } from "vitest";

import { lerCapitulosDaDescricao } from "./capitulos-da-descricao";
import {
  camposCorridosDosCapitulos,
  capitulosParaCopiar,
  minutosDoVideo,
  primeiroCapituloQueFalta,
  tempoNaTela,
  textoDoRoteiroLongo,
  nomeNaoVoltaDaLista,
  DURACAO_MINIMA_DO_CAPITULO_S,
  FOLGA_DA_DURACAO,
  iniciosDosCapitulos,
  MAXIMO_DE_CAPITULOS_DO_ROTEIRO,
  MINIMO_DE_CAPITULOS_DO_YOUTUBE,
  somaDosCapitulos,
  tempoParaADescricao,
  verificarCapitulos,
} from "./capitulos-do-roteiro";

const capitulos = (duracoes: number[]) => duracoes.map((duracaoS, i) => ({ nome: `Parte ${i + 1}`, duracaoS }));

describe("iniciosDosCapitulos e somaDosCapitulos", () => {
  it("o primeiro começa em zero e cada um começa onde o anterior termina", () => {
    expect(iniciosDosCapitulos(capitulos([60, 90, 150, 300]))).toEqual([0, 60, 150, 300]);
    expect(somaDosCapitulos(capitulos([60, 90, 150, 300]))).toBe(600);
  });

  it("lista vazia: nenhum início e soma zero", () => {
    expect(iniciosDosCapitulos([])).toEqual([]);
    expect(somaDosCapitulos([])).toBe(0);
  });
});

describe("verificarCapitulos (R-YT-VIDEO-05 a 08)", () => {
  it("cinco capítulos de dois minutos num vídeo de dez minutos: nenhum motivo", () => {
    expect(verificarCapitulos(capitulos([120, 120, 120, 120, 120]), 600)).toEqual([]);
  });

  it("menos de três capítulos reprova (R-YT-VIDEO-07)", () => {
    const motivos = verificarCapitulos(capitulos([300, 300]), 600);
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toContain("R-YT-VIDEO-07");
    expect(MINIMO_DE_CAPITULOS_DO_YOUTUBE).toBe(3);
  });

  it("exatamente três capítulos passa", () => {
    expect(verificarCapitulos(capitulos([200, 200, 200]), 600)).toEqual([]);
  });

  it("capítulo com menos de 10 segundos reprova e diz qual (R-YT-VIDEO-08); com exatamente 10 passa", () => {
    const curto = verificarCapitulos(capitulos([295, 9, 296]), 600);
    expect(curto).toHaveLength(1);
    expect(curto[0]).toContain("capitulo 2");
    expect(curto[0]).toContain("R-YT-VIDEO-08");
    expect(verificarCapitulos(capitulos([295, DURACAO_MINIMA_DO_CAPITULO_S, 295]), 600)).toEqual([]);
  });

  it("a soma tem de chegar perto da duração pedida: a folga é de 15% para cada lado, com as bordas dentro", () => {
    const alvo = 600;
    // 600 s com 15% de folga: de 510 s a 690 s (inteiros, para a borda não depender de ponto flutuante)
    expect(FOLGA_DA_DURACAO).toBe(0.15);
    expect(verificarCapitulos(capitulos([170, 170, 170]), alvo)).toEqual([]);
    expect(verificarCapitulos(capitulos([230, 230, 230]), alvo)).toEqual([]);
    expect(verificarCapitulos(capitulos([169, 170, 170]), alvo)).toHaveLength(1);
    expect(verificarCapitulos(capitulos([231, 230, 230]), alvo)).toHaveLength(1);
    expect(verificarCapitulos(capitulos([100, 100, 100]), alvo)[0]).toContain("somar a duracao do video");
  });

  it("a borda de 15% vale para qualquer duração-alvo, sem depender de ponto flutuante (de 3:30 a 40 minutos)", () => {
    for (let alvo = 220; alvo <= 2400; alvo += 20) {
      const embaixo = alvo * 0.85;
      const emcima = alvo * 1.15;
      if (!Number.isInteger(Math.round(embaixo * 100) / 100)) continue;
      // três capítulos com a soma exata na borda (o resto vai no último)
      const tres = (soma: number) => capitulos([Math.floor(soma / 3), Math.floor(soma / 3), soma - 2 * Math.floor(soma / 3)]);
      expect(verificarCapitulos(tres(Math.round(embaixo)), alvo), `borda de baixo, alvo ${alvo}`).toEqual([]);
      expect(verificarCapitulos(tres(Math.round(emcima)), alvo), `borda de cima, alvo ${alvo}`).toEqual([]);
      expect(verificarCapitulos(tres(Math.round(embaixo) - 1), alvo), `logo abaixo, alvo ${alvo}`).toHaveLength(1);
      expect(verificarCapitulos(tres(Math.round(emcima) + 1), alvo), `logo acima, alvo ${alvo}`).toHaveLength(1);
    }
  });

  it("mais capítulos que o teto do produto reprova, mesmo com tudo certo no resto", () => {
    const muitos = capitulos(Array.from({ length: MAXIMO_DE_CAPITULOS_DO_ROTEIRO + 1 }, () => 60));
    const motivos = verificarCapitulos(muitos, 60 * (MAXIMO_DE_CAPITULOS_DO_ROTEIRO + 1));
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toContain("no maximo");
    // o teto é do produto (uma pessoa grava, quem assiste acompanha): uma mudança nele é decisão, não ajuste
    expect(MAXIMO_DE_CAPITULOS_DO_ROTEIRO).toBe(12);
  });

  it("capítulo sem nome reprova (R-YT-VIDEO-05: cada marcação leva o seu título)", () => {
    const motivos = verificarCapitulos([{ nome: "  ", duracaoS: 200 }, ...capitulos([200, 200])], 600);
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toContain("R-YT-VIDEO-05");
  });

  it("duração que não é número reprova em vez de passar por conta da comparação com NaN", () => {
    const motivos = verificarCapitulos([{ nome: "Um", duracaoS: Number.NaN }, ...capitulos([300, 300])], 600);
    expect(motivos.some((m) => m.includes("R-YT-VIDEO-08"))).toBe(true);
  });

  it("junta os motivos: dois capítulos, um curto e a soma errada, tudo de uma vez", () => {
    const motivos = verificarCapitulos(capitulos([5, 30]), 600);
    expect(motivos.length).toBeGreaterThanOrEqual(3);
  });
});

describe("tempoParaADescricao", () => {
  it("o formato da lista da descrição: dois dígitos nos minutos, a hora só quando passa de uma hora", () => {
    expect(tempoParaADescricao(0)).toBe("00:00");
    expect(tempoParaADescricao(5)).toBe("00:05");
    expect(tempoParaADescricao(65)).toBe("01:05");
    expect(tempoParaADescricao(600)).toBe("10:00");
    expect(tempoParaADescricao(3599)).toBe("59:59");
    expect(tempoParaADescricao(3600)).toBe("1:00:00");
    expect(tempoParaADescricao(3725)).toBe("1:02:05");
  });

  it("arredonda ao segundo e nunca devolve tempo negativo", () => {
    expect(tempoParaADescricao(59.6)).toBe("01:00");
    expect(tempoParaADescricao(-4)).toBe("00:00");
  });
});

describe("capitulosParaCopiar", () => {
  it("uma marcação por linha, o tempo e o título, a primeira em 00:00 e em ordem crescente", () => {
    const texto = capitulosParaCopiar([
      { nome: "O problema", duracaoS: 75 },
      { nome: "O passo a passo", duracaoS: 150 },
      { nome: "O que fazer agora", duracaoS: 200 },
    ]);
    expect(texto).toBe("00:00 O problema\n01:15 O passo a passo\n03:45 O que fazer agora");
  });

  it("limpa os espaços do título para a linha nunca quebrar a lista", () => {
    const texto = capitulosParaCopiar([
      { nome: "  Duas\n  linhas  ", duracaoS: 60 },
      { nome: "B", duracaoS: 60 },
      { nome: "C", duracaoS: 60 },
    ]);
    expect(texto.split("\n")).toHaveLength(3);
    expect(texto.split("\n")[0]).toBe("00:00 Duas linhas");
  });

  it("o que sai é uma lista que a leitura dos vídeos dos outros aceita, com os mesmos tempos e títulos (ida e volta)", () => {
    const lista = capitulos([75, 150, 200, 45, 130]);
    const duracao = somaDosCapitulos(lista);
    const lidos = lerCapitulosDaDescricao(capitulosParaCopiar(lista), duracao);
    expect(lidos.map((c) => c.inicioS)).toEqual(iniciosDosCapitulos(lista));
    expect(lidos.map((c) => c.titulo)).toEqual(lista.map((c) => c.nome));
  });

  it("a ida e a volta vale também para um vídeo de mais de uma hora (a hora entra no tempo)", () => {
    const lista = capitulos([1500, 1500, 900, 600]);
    const lidos = lerCapitulosDaDescricao(capitulosParaCopiar(lista), somaDosCapitulos(lista));
    expect(lidos.map((c) => c.inicioS)).toEqual([0, 1500, 3000, 3900]);
  });

  it("toda lista que passa em verificarCapitulos sai na forma das quatro regras: começa em 0, tem três ou mais, cresce e cada uma dura 10 segundos ou mais", () => {
    // Uma varredura determinística no lugar de um gerador aleatório: tamanhos, quantidades e durações de 10 em 10 segundos.
    for (let quantidade = 3; quantidade <= MAXIMO_DE_CAPITULOS_DO_ROTEIRO; quantidade += 1) {
      for (let duracao = DURACAO_MINIMA_DO_CAPITULO_S; duracao <= 400; duracao += 30) {
        const lista = capitulos(Array.from({ length: quantidade }, (_, i) => duracao + i * 10));
        const soma = somaDosCapitulos(lista);
        expect(verificarCapitulos(lista, soma)).toEqual([]);
        const lidos = lerCapitulosDaDescricao(capitulosParaCopiar(lista), soma);
        expect(lidos.length).toBe(quantidade);
        expect(lidos[0].inicioS).toBe(0);
        lidos.forEach((c, i) => {
          if (i > 0) expect(c.inicioS).toBeGreaterThan(lidos[i - 1].inicioS);
          const fim = i + 1 < lidos.length ? lidos[i + 1].inicioS : soma;
          expect(fim - c.inicioS).toBeGreaterThanOrEqual(DURACAO_MINIMA_DO_CAPITULO_S);
        });
      }
    }
  });
});

describe("o nome do capítulo tem de voltar igual da lista da descrição", () => {
  it("um nome que começa com um tempo, só com número, com pontuação no começo ou longo demais não volta", () => {
    expect(nomeNaoVoltaDaLista("10:30 da manhã")).toBe(true);
    expect(nomeNaoVoltaDaLista("2026")).toBe(true);
    expect(nomeNaoVoltaDaLista("100%")).toBe(true);
    expect(nomeNaoVoltaDaLista("- e agora")).toBe(true);
    expect(nomeNaoVoltaDaLista(": começo")).toBe(true);
    expect(nomeNaoVoltaDaLista("3:15 minutos para secar")).toBe(true);
    expect(nomeNaoVoltaDaLista("a".repeat(101))).toBe(true);
  });

  it("um nome de gente volta igual, com número no meio, dois-pontos e acento", () => {
    for (const nome of ["O problema de verdade", "Passo 2: a mistura", "Por que 3 produtos bastam", "Erro número 1", "Cuidado com o pH", "a".repeat(100)]) {
      expect(nomeNaoVoltaDaLista(nome), nome).toBe(false);
    }
  });

  it("verificarCapitulos reprova o nome que não volta, dizendo qual capítulo é, e o nome com espaço marcado", () => {
    const lista = [
      { nome: "O problema", duracaoS: 200 },
      { nome: "10:30 da manhã", duracaoS: 200 },
      { nome: "O passo a [diga o número]", duracaoS: 200 },
    ];
    const motivos = verificarCapitulos(lista, 600);
    expect(motivos).toHaveLength(2);
    expect(motivos[0]).toContain("capitulo 2");
    expect(motivos[0]).toContain("nao volta igual");
    expect(motivos[1]).toContain("capitulo 3");
    expect(motivos[1]).toContain("colchetes");
  });
});

describe("verificarCapitulos com as opções da segunda tentativa", () => {
  const tres = (soma: number) => capitulos([Math.floor(soma / 3), Math.floor(soma / 3), soma - 2 * Math.floor(soma / 3)]);

  it("sem exigir a soma, qualquer soma serve, desde que continue sendo de um vídeo longo", () => {
    const limites = { exigirSoma: false, somaMaiorQueS: 180, somaAteS: 2400 };
    expect(verificarCapitulos(tres(900), 600, limites)).toEqual([]);
    expect(verificarCapitulos(tres(900), 600)).toHaveLength(1);
  });

  it("a soma nunca sai do que é um vídeo longo: acima do teto dos curtos e até o limite do longo, nas duas tentativas", () => {
    const limites = { somaMaiorQueS: 180, somaAteS: 2400 };
    // o alvo de 210 s aceita 178,5 s pela folga de 15%, que já é um vídeo curto
    expect(verificarCapitulos(tres(180), 210, limites)).toHaveLength(1);
    expect(verificarCapitulos(tres(181), 210, limites)).toEqual([]);
    // o alvo de 2400 s aceita 2760 s pela folga, que passa do limite do longo
    expect(verificarCapitulos(tres(2400), 2400, limites)).toEqual([]);
    expect(verificarCapitulos(tres(2401), 2400, limites)).toHaveLength(1);
    expect(verificarCapitulos(tres(2700), 2400, { ...limites, exigirSoma: false })[0]).toContain("maximo");
  });
});

describe("E52 PR 4b: o tempo na tela, o texto corrido e o texto para copiar", () => {
  const caps = [
    { nome: "A mancha que volta", inicioS: 0, duracaoS: 50, pontos: ["Mostre o sofá", "Conte o que fez"], naImagem: "o sofá com a mancha", ganchoParaOProximo: "Fica até o fim que eu te mostro" },
    { nome: "Erro 1: esfregar", inicioS: 50, duracaoS: 110, pontos: ["Aplique", "Espere"], naImagem: "o relógio", ganchoParaOProximo: "E o erro 2 é pior" },
    { nome: "O que fazer amanhã", inicioS: 160, duracaoS: 50, pontos: ["Resuma", "Peça a mensagem"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null },
  ];
  const Q = String.fromCharCode(10);

  it("o tempo da tela não leva zero à esquerda nos minutos e passa a mostrar a hora quando o vídeo passa de uma hora", () => {
    expect(tempoNaTela(0)).toBe("0:00");
    expect(tempoNaTela(50)).toBe("0:50");
    expect(tempoNaTela(160)).toBe("2:40");
    expect(tempoNaTela(3725)).toBe("1:02:05");
    expect(tempoNaTela(-5)).toBe("0:00");
  });

  it("os minutos do selo arredondam e nunca são menos de um", () => {
    expect(minutosDoVideo(570)).toBe(10);
    expect(minutosDoVideo(200)).toBe(3);
    expect(minutosDoVideo(10)).toBe(1);
  });

  it("o texto corrido sai dos capítulos: o corpo numerado, o fechamento é o último capítulo e há uma cena por capítulo no início dele", () => {
    const c = camposCorridosDosCapitulos(caps);
    expect(c.corpo.split(Q)).toEqual(["1. A mancha que volta: Mostre o sofá; Conte o que fez", "2. Erro 1: esfregar: Aplique; Espere", "3. O que fazer amanhã: Resuma; Peça a mensagem"]);
    expect(c.fechamento).toBe("Resuma; Peça a mensagem");
    expect(c.cenas).toEqual([
      { momento: "0 segundos", oQueFazer: "o sofá com a mancha" },
      { momento: "50 segundos", oQueFazer: "o relógio" },
      { momento: "160 segundos", oQueFazer: "você olhando para a câmera" },
    ]);
    expect(camposCorridosDosCapitulos([])).toEqual({ corpo: "", fechamento: "", cenas: [] });
  });

  it("o texto para copiar leva o título, o gancho do vídeo e, por capítulo, o tempo, o nome, o que segura até o próximo e os pontos; a chamada só no último", () => {
    const texto = textoDoRoteiroLongo({ titulo: "Os erros da mancha", gancho: "Se a mancha volta, o problema não é o produto.", chamadaFinal: "Manda a foto da sua mancha.", capitulos: caps });
    const partes = texto.split(Q + Q);
    expect(partes[0]).toBe("Os erros da mancha");
    expect(partes[1]).toBe("Se a mancha volta, o problema não é o produto.");
    expect(partes[2].split(Q)).toEqual(["0:00 A mancha que volta", "Fica até o fim que eu te mostro", "- Mostre o sofá", "- Conte o que fez"]);
    expect(partes[4].split(Q)).toEqual(["2:40 O que fazer amanhã", "- Resuma", "- Peça a mensagem", "Manda a foto da sua mancha."]);
    expect(texto.match(/Manda a foto/g)).toHaveLength(1);
  });
});

describe("E52 PR 5: o primeiro capítulo que falta gravar", () => {
  it("devolve o primeiro sem marca a partir do ponto pedido, dando a volta no fim da lista", () => {
    expect(primeiroCapituloQueFalta(new Set(), 4)).toBe(0);
    expect(primeiroCapituloQueFalta(new Set([0, 1]), 4)).toBe(2);
    expect(primeiroCapituloQueFalta(new Set([2]), 4, 2)).toBe(3);
    expect(primeiroCapituloQueFalta(new Set([2, 3]), 4, 2)).toBe(0);
    expect(primeiroCapituloQueFalta(new Set([0, 2, 3]), 4, 3)).toBe(1);
  });

  it("devolve nulo quando todos estão marcados, e aceita um ponto de partida fora da lista", () => {
    expect(primeiroCapituloQueFalta(new Set([0, 1, 2]), 3)).toBeNull();
    expect(primeiroCapituloQueFalta(new Set([0, 1, 2]), 3, 7)).toBeNull();
    expect(primeiroCapituloQueFalta(new Set([1]), 3, 5)).toBe(2);
    expect(primeiroCapituloQueFalta(new Set([1]), 3, -1)).toBe(2);
    expect(primeiroCapituloQueFalta(new Set(), 0)).toBeNull();
  });
});
