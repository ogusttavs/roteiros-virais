/**
 * T114: os títulos da capa de notícia quando a lista inteira é reprovada duas vezes (no ensaio de 26/11/2026 a IA pôs o horário da clínica num título e a capa caía inteira). Confere título a título e
 * fica com os que passam, como os ganchos alternativos. A IA é simulada: `conferirSaida` aprova ou reprova pelo texto do título, sem rede e sem banco.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const conferir = vi.hoisted(() => vi.fn());
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, conferirSaida: conferir };
});

import { ErroIA } from "@/ia/erro";

import { aproveitarTitulosUmAUm } from "./capa-noticia";

const BOM = "O que a regra nova muda no seu clareamento";
const OUTRO_BOM = "Clareamento em casa: o que a notícia diz";
const COM_HORARIO = "A gente atende das 7h às 9h para você clarear";

const parametros = { extrairCampos: () => ({}) } as never;
type Dados = { titulos: string[] };
const tituloDe = (dados: unknown) => (dados as Dados).titulos[0];
const resposta = (aprovado: boolean, dados: unknown) => ({ aprovado, dados, motivos: aprovado ? [] : ["fato sem apoio"], evidencias: [], reparavel: false });

beforeEach(() => {
  conferir.mockReset();
});

describe("aproveitarTitulosUmAUm", () => {
  it("confere cada título sozinho, na 2ª tentativa, e devolve só os aprovados, na ordem do modelo", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(tituloDe(dados) !== COM_HORARIO, dados));
    expect(await aproveitarTitulosUmAUm(parametros, { titulos: [BOM, COM_HORARIO, OUTRO_BOM] })).toEqual([BOM, OUTRO_BOM]);
    expect(conferir).toHaveBeenCalledTimes(3);
    for (const chamada of conferir.mock.calls) {
      expect((chamada[1] as Dados).titulos).toHaveLength(1);
      expect(chamada[2]).toBe(2);
    }
  });

  it("com todos reprovados devolve vazio (quem chama mantém a falha)", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(false, dados));
    expect(await aproveitarTitulosUmAUm(parametros, { titulos: [BOM, COM_HORARIO, OUTRO_BOM] })).toEqual([]);
  });

  it("limpa e tira o repetido antes de conferir, e confere no máximo 5", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(true, dados));
    const r = await aproveitarTitulosUmAUm(parametros, { titulos: [`  ${BOM}.  `, BOM.toUpperCase(), "Um", "Dois", "Três", "Quatro", "Cinco"] });
    expect(r).toEqual([BOM, "Um", "Dois", "Três", "Quatro"]);
    expect(conferir).toHaveBeenCalledTimes(5);
  });

  it("devolve o título como a conferência deixou (a correção mecânica, quando houve)", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(true, { titulos: [`${tituloDe(dados)} hoje`] }));
    expect(await aproveitarTitulosUmAUm(parametros, { titulos: [BOM] })).toEqual([`${BOM} hoje`]);
  });

  it("uma conferência que falha tira só aquele título, nunca mostra um que não foi conferido", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => {
      if (tituloDe(dados) === BOM) throw new ErroIA("fora");
      return resposta(true, dados);
    });
    expect(await aproveitarTitulosUmAUm(parametros, { titulos: [BOM, OUTRO_BOM] })).toEqual([OUTRO_BOM]);
  });
});
