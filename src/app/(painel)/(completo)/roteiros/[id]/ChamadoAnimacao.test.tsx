/**
 * O cartão "Sem tempo de gravar hoje?": com espaço para completar entre colchetes ele não deixa pedir e leva a pessoa a editar; na prévia ele lista o que ficou de fora do vídeo.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VisaoDaAnimacao, VistaDaAnimacao } from "@/servicos/animacao";
import { textosAnimacao } from "@/textos/animacao";

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, frase: string) => frase,
}));
vi.mock("./animacao-acoes", () => ({
  pedirAnimacaoAction: vi.fn(),
  aprovarAnimacaoAction: vi.fn(),
  dispensarAnimacaoAction: vi.fn(),
  tentarAnimacaoDeNovoAction: vi.fn(),
}));

import { ChamadoAnimacao } from "./ChamadoAnimacao";

const t = textosAnimacao;

afterEach(() => cleanup());

const vista = (extra: Partial<VistaDaAnimacao> = {}): VistaDaAnimacao => ({ id: 1, estado: "previa_pronta", progresso: null, motivo: null, tempoDaPrevia: "uns 40 segundos", tempoDoFinal: "uns 2 minutos", foraDoVideo: [], finalExpiraEm: null, ...extra });
const visao = (extra: Partial<VisaoDaAnimacao> = {}): VisaoDaAnimacao => ({ verComo: false, animacao: null, colchetes: 0, outraEmAndamento: false, ...extra });

describe("ChamadoAnimacao: espaços para completar", () => {
  it("com colchete no roteiro diz quantos faltam, não mostra o botão de pedir e o botão de completar abre a edição", () => {
    const aoCompletar = vi.fn();
    render(<ChamadoAnimacao roteiroId={1} visao={visao({ colchetes: 2 })} aoCompletar={aoCompletar} />);
    expect(screen.getByText(t.chamado.completar(2))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.chamado.botao })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.chamado.botaoCompletar }));
    expect(aoCompletar).toHaveBeenCalledTimes(1);
  });

  it("sem colchete o botão de pedir aparece e não há convite para completar", () => {
    render(<ChamadoAnimacao roteiroId={1} visao={visao()} aoCompletar={vi.fn()} />);
    expect(screen.getByRole("button", { name: t.chamado.botao })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.chamado.botaoCompletar })).toBeNull();
  });
});

describe("ChamadoAnimacao: o que ficou de fora", () => {
  it("na prévia pronta lista as frases que não couberam, antes do botão de aprovar", () => {
    render(<ChamadoAnimacao roteiroId={1} visao={visao({ animacao: vista({ foraDoVideo: ["Frase um do meio.", "Frase dois do meio."] }) })} />);
    expect(screen.getByText(t.aviso.foraDoVideo(2))).toBeTruthy();
    expect(screen.getByText("Frase um do meio.")).toBeTruthy();
    expect(screen.getByText("Frase dois do meio.")).toBeTruthy();
    expect(screen.getByRole("button", { name: t.acoes.aprovar })).toBeTruthy();
  });

  it("quando coube tudo, nenhum aviso", () => {
    const { container } = render(<ChamadoAnimacao roteiroId={1} visao={visao({ animacao: vista() })} />);
    expect(container.querySelector("[data-fora-do-video]")).toBeNull();
  });
});
