/**
 * Os ganchos alternativos quando a lista inteira é reprovada duas vezes (T75): confere gancho a gancho e fica com os que passam. A IA é simulada: `conferirSaida` (o verificador de fato) aprova ou
 * reprova pelo texto do gancho, sem rede e sem banco.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const conferir = vi.hoisted(() => vi.fn());
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, conferirSaida: conferir };
});

import type { GanchoAlternativo, TipoAbertura } from "@/db/schema";
import { ErroIA, ErroReprovadoDuasVezes } from "@/ia/erro";

import { aproveitarGanchosUmAUm } from "./ganchos-alternativos";

const FONTES = "Perfil do cliente: lava sofá em Campinas.\nTema: tirar mancha de café do sofá.";
const CONTEXTO = { ganchoAtual: "Mancha de café no sofá não precisa virar problema", tipoAtual: "fala_direta" as TipoAbertura | null, fontes: FONTES, ramoSaude: false };

function g(texto: string, tipoAbertura: TipoAbertura): GanchoAlternativo {
  return { texto, tipoAbertura, emocao: "curiosidade" };
}

const BOM = g("Olhe esta mancha de café no sofá, antes de eu encostar nela", "cena");
const OUTRO_BOM = g("O sofá voltou a ficar claro em dez minutos", "resultado");
const RUIM = g("Você sabe o que fazer quando o café cai no sofá?", "pergunta");

const parametros = { extrairCampos: () => ({}) } as never;
const saida = (ganchos: GanchoAlternativo[]) => ({ ganchos }) as never;

beforeEach(() => {
  conferir.mockReset();
});

type Dados = { ganchos: GanchoAlternativo[] };
const textoDe = (dados: unknown) => (dados as Dados).ganchos[0].texto;
const resposta = (aprovado: boolean, dados: unknown) => ({ aprovado, dados, motivos: aprovado ? [] : ["fato sem apoio"], evidencias: [], reparavel: !aprovado });

describe("aproveitarGanchosUmAUm", () => {
  it("confere cada gancho sozinho e devolve só o que o verificador aprova, na ordem", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(textoDe(dados) !== RUIM.texto, dados));
    const ficam = await aproveitarGanchosUmAUm(parametros, saida([BOM, RUIM, OUTRO_BOM]), CONTEXTO, FONTES);
    expect(ficam).toEqual([BOM, OUTRO_BOM]);
    expect(conferir).toHaveBeenCalledTimes(3);
    for (const chamada of conferir.mock.calls) {
      expect((chamada[1] as Dados).ganchos).toHaveLength(1);
      expect(chamada[2]).toBe(2);
    }
  });

  it("com todos reprovados devolve vazio (a tela diz que não deu)", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(false, dados));
    expect(await aproveitarGanchosUmAUm(parametros, saida([BOM, RUIM, OUTRO_BOM]), CONTEXTO, FONTES)).toEqual([]);
  });

  it("não gasta o verificador com o que já reprova por código (tipo igual ao do roteiro, texto igual ao atual)", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => resposta(true, dados));
    const igualAoAtual = g(CONTEXTO.ganchoAtual, "cena");
    const mesmoTipoDoRoteiro = g("Olhe esta outra mancha de café no sofá", "fala_direta");
    const ficam = await aproveitarGanchosUmAUm(parametros, saida([igualAoAtual, mesmoTipoDoRoteiro, BOM]), CONTEXTO, FONTES);
    expect(ficam).toEqual([BOM]);
    expect(conferir).toHaveBeenCalledTimes(1);
  });

  it("uma conferência que falha tira só aquele gancho, nunca mostra um não conferido", async () => {
    conferir.mockImplementation(async (_p: unknown, dados: unknown) => {
      if (textoDe(dados) === BOM.texto) throw new ErroIA("fora");
      return resposta(true, dados);
    });
    expect(await aproveitarGanchosUmAUm(parametros, saida([BOM, OUTRO_BOM]), CONTEXTO, FONTES)).toEqual([OUTRO_BOM]);
  });
});

describe("ErroReprovadoDuasVezes", () => {
  it("é um ErroIA e carrega a última saída", () => {
    const erro = new ErroReprovadoDuasVezes("reprovada", { ganchos: [BOM] });
    expect(erro).toBeInstanceOf(ErroIA);
    expect(erro.ultimaSaida).toEqual({ ganchos: [BOM] });
  });
});
