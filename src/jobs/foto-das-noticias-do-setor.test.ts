import { describe, expect, it } from "vitest";

import { fotosPorTitulo } from "./foto-das-noticias-do-setor";

const linha = (id: number, titulo: string) => ({ id, nichoId: 1, titulo, url: "https://news.google.com/rss/articles/abc" });

describe("fotosPorTitulo: a foto do feed do portal para a notícia do setor de mesmo título", () => {
  const feed = [
    { titulo: "Preço da limpeza profissional sobe em outubro", veiculo: "G1", imagemUrl: "https://s2-g1.glbimg.com/limpeza.jpg" },
    { titulo: "Brasil", veiculo: "UOL", imagemUrl: "https://imagens.uol.com.br/brasil.jpg" },
    { titulo: "Dentista ensina o clareamento seguro", veiculo: "Exame", imagemUrl: null },
    { titulo: "Estudo mostra queda no consumo de produtos de limpeza", veiculo: "Folha de S.Paulo", imagemUrl: "http://folha.exemplo/inseguro.jpg" },
  ];

  it("casa sem diferença de acento, de maiúscula e de pontuação, e guarda o veículo do feed (que dá o crédito)", () => {
    const achadas = fotosPorTitulo([linha(1, "PREÇO da limpeza profissional sobe em outubro!")], feed);
    expect(achadas.get(1)).toEqual({ veiculo: "G1", imagemUrl: "https://s2-g1.glbimg.com/limpeza.jpg" });
  });

  it("título curto demais não casa com nada (uma palavra solta bateria com qualquer manchete)", () => {
    expect(fotosPorTitulo([linha(2, "Brasil")], feed).size).toBe(0);
  });

  it("item do feed sem foto, ou com foto que não é https, não dá foto", () => {
    expect(fotosPorTitulo([linha(3, "Dentista ensina o clareamento seguro"), linha(4, "Estudo mostra queda no consumo de produtos de limpeza")], feed).size).toBe(0);
  });

  it("título que nenhum feed traz fica de fora, e a ordem das linhas não importa", () => {
    const achadas = fotosPorTitulo([linha(5, "Uma manchete que só o Google News tem hoje"), linha(6, "Preço da limpeza profissional sobe em outubro")], feed);
    expect([...achadas.keys()]).toEqual([6]);
  });
});

describe("fotosPorTitulo: o mesmo veículo e a mesma janela de tempo", () => {
  const HORA = 60 * 60 * 1000;
  const agora = new Date("2026-10-10T12:00:00.000Z");
  const titulo = "Frente fria chega ao Sul e derruba a temperatura";
  const item = (veiculo: string, imagem: string, publicadoEm: Date | null = agora) => ({ titulo, veiculo, imagemUrl: imagem, publicadoEm });

  it("a notícia de um veículo só ganha a foto do mesmo veículo (sem diferença de maiúscula ou acento)", () => {
    const feed = [item("G1", "https://s2-g1.glbimg.com/frente.jpg")];
    expect(fotosPorTitulo([{ ...linha(1, titulo), fonte: "Valor Econômico", publicadoEm: agora }], feed).size).toBe(0);
    expect(fotosPorTitulo([{ ...linha(1, titulo), fonte: "g1", publicadoEm: agora }], feed).get(1)?.imagemUrl).toBe("https://s2-g1.glbimg.com/frente.jpg");
  });

  it("o mesmo título em dois veículos: vale o do veículo da notícia, não o primeiro que aparece", () => {
    const feed = [item("UOL", "https://imagens.uol.com.br/frente.jpg"), item("G1", "https://s2-g1.glbimg.com/frente.jpg")];
    expect(fotosPorTitulo([{ ...linha(1, titulo), fonte: "G1", publicadoEm: agora }], feed).get(1)?.veiculo).toBe("G1");
  });

  it("sem o veículo da notícia (nulo), o primeiro item de mesmo título vale", () => {
    const feed = [item("UOL", "https://imagens.uol.com.br/frente.jpg")];
    expect(fotosPorTitulo([{ ...linha(1, titulo), fonte: null, publicadoEm: agora }], feed).get(1)?.veiculo).toBe("UOL");
  });

  it("a mesma manchete de outro dia não é a mesma matéria: passou de 36 horas, não casa", () => {
    const feed = [item("G1", "https://s2-g1.glbimg.com/frente.jpg", agora)];
    const dePerto = { ...linha(1, titulo), fonte: "G1", publicadoEm: new Date(agora.getTime() - 30 * HORA) };
    const dePasso = { ...linha(2, titulo), fonte: "G1", publicadoEm: new Date(agora.getTime() - 40 * HORA) };
    const adiante = { ...linha(3, titulo), fonte: "G1", publicadoEm: new Date(agora.getTime() + 40 * HORA) };
    const achadas = fotosPorTitulo([dePerto, dePasso, adiante], feed);
    expect([...achadas.keys()]).toEqual([1]);
  });

  it("sem a hora de um dos lados não há como conferir, e o título e o veículo valem", () => {
    const feed = [item("G1", "https://s2-g1.glbimg.com/frente.jpg", null)];
    expect(fotosPorTitulo([{ ...linha(1, titulo), fonte: "G1", publicadoEm: agora }], feed).size).toBe(1);
    expect(fotosPorTitulo([{ ...linha(2, titulo), fonte: "G1", publicadoEm: null }], [item("G1", "https://s2-g1.glbimg.com/frente.jpg", agora)]).size).toBe(1);
  });
});
