/**
 * A folha "Editar o meu vídeo" do roteiro (E47 PR 4), estado por estado: o formulário, o "ver como", a espera (preparando, na vez, montando), a prévia com Aprovar e Pedir ajuste, o vídeo
 * pronto com baixar e publicar, e a edição que falhou. As Server Actions, a consulta ao servidor (`fetch`) e o contexto de conexão saem simulados: o que importa é o que a tela mostra e o
 * que ela pede ao servidor.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VisaoDeEditar, VistaCompletaDaEdicao } from "@/servicos/edicao-tela";
import { fraseDaEdicao, textosEdicao } from "@/textos/edicao";

const aprovarEdicaoAction = vi.fn();
const refazerEdicaoAction = vi.fn();

vi.mock("./edicao-acoes", () => ({
  aprovarEdicaoAction: (...args: unknown[]) => aprovarEdicaoAction(...args),
  refazerEdicaoAction: (...args: unknown[]) => refazerEdicaoAction(...args),
  publicarEdicaoAction: vi.fn(),
}));

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

import { EditarMeuVideo } from "./EditarMeuVideo";

const t = textosEdicao.tela;

function vista(extra: Partial<VistaCompletaDaEdicao> = {}): VistaCompletaDaEdicao {
  return {
    id: 7,
    roteiroId: 3,
    estado: "previa_pronta",
    motivo: null,
    progresso: null,
    aFrente: null,
    esperaMin: null,
    avisos: [],
    duracaoDoVideoS: 42,
    temPrevia: true,
    temVideoPronto: false,
    refazeresRestantes: 3,
    prontoAte: null,
    ...extra,
  };
}

function visao(extra: Partial<VisaoDeEditar> = {}): VisaoDeEditar {
  return { verComo: false, uso: { usadas: 4, limite: 30 }, edicao: null, podePublicar: false, ...extra };
}

function folha(v: VisaoDeEditar, aoPublicar = vi.fn()) {
  render(<EditarMeuVideo roteiroId={3} visao={v} aoEnviando={vi.fn()} semConexao={false} aoPublicar={aoPublicar} />);
  return aoPublicar;
}

beforeEach(() => {
  aprovarEdicaoAction.mockReset();
  refazerEdicaoAction.mockReset();
  // A consulta periódica: devolve o mesmo estado que a folha já mostra, para o teste não depender dela.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...vista(), uso: { usadas: 4 } }), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EditarMeuVideo", () => {
  it("sem edição mostra o formulário: o que gravar, o aviso de que o vídeo sai sem música, o uso do mês e o botão desligado até escolher o vídeo", () => {
    folha(visao());
    const secao = document.querySelector("[data-parte='formulario']") as HTMLElement;
    expect(within(secao).getByRole("heading", { name: t.titulo })).toBeTruthy();
    expect(secao.textContent).toContain(t.semMusica);
    expect(secao.textContent).toContain(t.regras);
    expect(secao.textContent).toContain(t.usadas(4));
    expect((within(secao).getByRole("button", { name: t.enviar }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("um arquivo que não é vídeo é recusado no aparelho com a frase em língua de gente", async () => {
    folha(visao());
    const campo = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(campo, { target: { files: [new File(["x"], "foto.png", { type: "image/png" })] } });
    expect((await screen.findByRole("alert")).textContent).toContain(fraseDaEdicao("arquivo-tipo"));
  });

  it("no 'ver como' a folha só avisa que editar é da pessoa: nada de enviar, aprovar nem ver o vídeo", () => {
    folha(visao({ verComo: true, edicao: vista() }));
    const secao = document.querySelector("[data-parte='ver-como']") as HTMLElement;
    expect(secao.textContent).toContain(t.verComo);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button", { name: t.aprovar })).toBeNull();
    expect(screen.queryByRole("button", { name: t.enviar })).toBeNull();
  });

  it("preparando, na vez e montando mostram a posição, o andamento e o aviso de que o vídeo sai sem música", () => {
    folha(visao({ edicao: vista({ estado: "verificado", aFrente: 2, esperaMin: 3, temPrevia: false }) }));
    const fila = document.querySelector("[data-parte='fila-da-previa']") as HTMLElement;
    expect(fila.textContent).toContain(t.esperandoAVez(2, 3));
    expect(fila.textContent).toContain(t.semMusica);
    cleanup();

    folha(visao({ edicao: vista({ estado: "montando_previa", progresso: 40, temPrevia: false }) }));
    expect((document.querySelector("[data-parte='montando-previa']") as HTMLElement).textContent).toContain(t.montandoPrevia(40));
    expect((document.querySelector("progress") as HTMLProgressElement).value).toBe(40);
    cleanup();

    folha(visao({ edicao: vista({ estado: "montando_final", progresso: 75 }) }));
    expect((document.querySelector("[data-parte='montando-final']") as HTMLElement).textContent).toContain(t.montandoFinal(75));
    cleanup();

    folha(visao({ edicao: vista({ estado: "transcrevendo", temPrevia: false }) }));
    expect((document.querySelector("[data-parte='preparando']") as HTMLElement).textContent).toContain(t.preparando);
  });

  it("a frase da fila fala de um vídeo ou de vários, e quem é o próximo", () => {
    expect(t.esperandoAVez(0, 1)).toContain("próximo");
    expect(t.esperandoAVez(1, 2)).toContain("1 vídeo na frente");
    expect(t.esperandoAVez(3, 5)).toContain("3 vídeos na frente");
    expect(t.esperandoAVez(1, 1)).toContain("1 minuto");
  });

  it("a prévia tem o player, o que vale conferir, Aprovar e Pedir ajuste; Aprovar chama o servidor e passa para a vez do vídeo final", async () => {
    aprovarEdicaoAction.mockResolvedValue({ ok: true, dado: {} });
    folha(visao({ edicao: vista({ avisos: ["Você disse 3.956 e o roteiro diz 3.976."] }) }));
    const secao = document.querySelector("[data-parte='previa-pronta']") as HTMLElement;
    const video = secao.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("/api/edicao/7/previa");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(secao.textContent).toContain(t.previaAjuda);
    expect(secao.textContent).toContain(t.avisosTitulo);
    expect(secao.textContent).toContain("Você disse 3.956");
    expect(secao.textContent).toContain(t.semMusica);
    fireEvent.click(within(secao).getByRole("button", { name: t.aprovar }));
    await waitFor(() => expect(aprovarEdicaoAction).toHaveBeenCalledWith(7));
    await waitFor(() => expect(document.querySelector("[data-parte='fila-do-final']")).not.toBeNull());
  });

  it("Aprovar que o servidor recusa mostra a frase dele e fica na prévia", async () => {
    aprovarEdicaoAction.mockResolvedValue({ ok: false, erro: fraseDaEdicao("arquivo-saiu") });
    folha(visao({ edicao: vista() }));
    fireEvent.click(screen.getByRole("button", { name: t.aprovar }));
    expect((await screen.findByRole("alert")).textContent).toContain(fraseDaEdicao("arquivo-saiu"));
    expect(document.querySelector("[data-parte='previa-pronta']")).not.toBeNull();
  });

  it("Pedir ajuste abre o campo do motivo (obrigatório), manda o motivo ao servidor e a edição volta a ser preparada", async () => {
    refazerEdicaoAction.mockResolvedValue({ ok: true, dado: {} });
    folha(visao({ edicao: vista({ refazeresRestantes: 2 }) }));
    fireEvent.click(screen.getByRole("button", { name: t.refazer }));
    const ajuste = document.querySelector("[data-parte='pedir-ajuste']") as HTMLElement;
    expect(ajuste.textContent).toContain(t.refazerRestantes(2));
    const enviar = within(ajuste).getByRole("button", { name: t.refazerEnviar }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.change(within(ajuste).getByLabelText(t.refazerRotulo), { target: { value: "Deixe a abertura mais curta" } });
    expect(enviar.disabled).toBe(false);
    fireEvent.click(enviar);
    await waitFor(() => expect(refazerEdicaoAction).toHaveBeenCalledWith(7, "Deixe a abertura mais curta"));
    await waitFor(() => expect(document.querySelector("[data-parte='preparando']")).not.toBeNull());
    expect(document.querySelector("[data-parte='preparando']")?.textContent).toContain(t.refazeu);
  });

  it("sem pedidos de ajuste sobrando o botão de pedir ajuste some, e a frase do que sobra fala de um ou de vários", () => {
    folha(visao({ edicao: vista({ refazeresRestantes: 0 }) }));
    expect(screen.queryByRole("button", { name: t.refazer })).toBeNull();
    expect(t.refazerRestantes(1)).toContain("1 ajuste");
    expect(t.refazerRestantes(3)).toContain("3 ajustes");
  });

  it("o vídeo pronto toca, baixa o vídeo e a legenda, diz até quando fica guardado e só oferece publicar quando dá", () => {
    const pronto = vista({ estado: "pronta", temPrevia: false, temVideoPronto: true, prontoAte: "2026-11-05T15:00:00.000Z" });
    const aoPublicar = folha(visao({ edicao: pronto, podePublicar: true }));
    const secao = document.querySelector("[data-parte='pronta']") as HTMLElement;
    expect((secao.querySelector("video") as HTMLVideoElement).getAttribute("src")).toBe("/api/edicao/7/pronto");
    expect((secao.querySelector("[data-baixar-video]") as HTMLAnchorElement).getAttribute("href")).toBe("/api/edicao/7/pronto?baixar=1");
    expect((secao.querySelector("[data-baixar-legenda]") as HTMLAnchorElement).getAttribute("href")).toBe("/api/edicao/7/legenda");
    expect(secao.textContent).toContain("Fica guardado aqui até");
    expect(secao.textContent).toContain(t.semMusica);
    fireEvent.click(within(secao).getByRole("button", { name: t.publicar }));
    expect(aoPublicar).toHaveBeenCalledWith(7, 42);
    cleanup();

    folha(visao({ edicao: pronto, podePublicar: false }));
    expect(screen.queryByRole("button", { name: t.publicar })).toBeNull();
  });

  it("enviar outro vídeo, depois de pronto, volta ao formulário", () => {
    folha(visao({ edicao: vista({ estado: "pronta", temPrevia: false, temVideoPronto: true }) }));
    fireEvent.click(screen.getByRole("button", { name: t.novoVideo }));
    expect(document.querySelector("[data-parte='formulario']")).not.toBeNull();
  });

  it("uma edição que falhou mostra o motivo e o formulário para enviar de novo; uma para revisão mostra a frase de conferência", () => {
    folha(visao({ edicao: vista({ estado: "falhou", motivo: fraseDaEdicao("nao-montou"), temPrevia: false }) }));
    expect((document.querySelector("[data-parte='motivo-da-falha']") as HTMLElement).textContent).toContain(fraseDaEdicao("nao-montou"));
    expect(screen.getByRole("button", { name: t.enviar })).toBeTruthy();
    cleanup();
    folha(visao({ edicao: vista({ estado: "para_revisao", motivo: fraseDaEdicao("em-revisao"), temPrevia: false }) }));
    expect((document.querySelector("[data-parte='para-revisao']") as HTMLElement).textContent).toContain(fraseDaEdicao("em-revisao"));
  });

  it("enquanto a edição anda a folha pergunta ao servidor e muda sozinha quando a prévia fica pronta", async () => {
    vi.useFakeTimers();
    try {
      const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ ...vista({ estado: "previa_pronta" }), uso: { usadas: 5 } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchFalso);
      folha(visao({ edicao: vista({ estado: "montando_previa", progresso: 90, temPrevia: false }) }));
      expect(document.querySelector("[data-parte='montando-previa']")).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchFalso).toHaveBeenCalledWith("/api/edicao/7", { cache: "no-store" });
      expect(document.querySelector("[data-parte='previa-pronta']")).not.toBeNull();
      // Parou de perguntar: a prévia pronta espera a pessoa.
      const chamadas = fetchFalso.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(fetchFalso.mock.calls.length).toBe(chamadas);
    } finally {
      vi.useRealTimers();
    }
  });
});
