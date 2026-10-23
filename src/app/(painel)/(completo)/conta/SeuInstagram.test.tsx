/**
 * O cartão "Seu Instagram" da Conta (E19 PR 2), estado por estado: indisponível, sem ligação (dona, membro, ver como, app aprovado ou em teste), ligada (com e sem leitura, com o problema
 * guardado), escolher entre várias, desligar com confirmação, e cada frase da volta do diálogo. As duas Server Actions e o contexto de conexão saem mockados: o que importa aqui é o
 * que a tela mostra, quem vê botão, e o que ela faz com o que as ações devolvem.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { textosLigacao } from "@/textos/conta-conectada";

const desligarInstagramAction = vi.fn();
const escolherInstagramAction = vi.fn();

vi.mock("./instagram-acoes", () => ({
  desligarInstagramAction: () => desligarInstagramAction(),
  escolherInstagramAction: (contaId: string) => escolherInstagramAction(contaId),
}));

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

import { montarVisaoSeuInstagram, type EntradaDaVisao } from "./seu-instagram-visao";
import { SeuInstagram } from "./SeuInstagram";

const t = textosLigacao.tela;

function conta(extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    contaId: "17841400000000001",
    nome: "casa.em.ordem",
    paginaNome: "Casa em Ordem",
    conectadaEm: new Date("2026-10-12T15:30:00Z"),
    ultimaLeituraEm: null,
    tokenExpiraEm: null,
    erro: null,
    ...extra,
  };
}

const BASE: EntradaDaVisao = { ligacaoAberta: true, aprovadoPelaMeta: false, dono: true, verComo: false, conta: null, candidatas: [], retorno: null };

function desenhar(entrada: Partial<EntradaDaVisao> = {}) {
  return render(<SeuInstagram visao={montarVisaoSeuInstagram({ ...BASE, ...entrada })} />);
}

function cartao() {
  return screen.getByTestId("seu-instagram");
}

beforeEach(() => {
  desligarInstagramAction.mockReset();
  escolherInstagramAction.mockReset();
  window.history.replaceState(null, "", "/conta");
});

afterEach(cleanup);

describe("sem a ligação aberta (faltam os dados do aplicativo da Meta)", () => {
  it("diz com calma que abre para todos quando a Meta aprovar, e não tem botão nenhum", () => {
    desenhar({ ligacaoAberta: false });
    expect(cartao().getAttribute("data-estado")).toBe("indisponivel");
    expect(screen.getByRole("heading", { name: t.titulo })).toBeTruthy();
    expect(within(cartao()).getByText(/abre para todos quando a Meta aprovar o aplicativo/)).toBeTruthy();
    expect(within(cartao()).queryByRole("link")).toBeNull();
    expect(within(cartao()).queryByRole("button")).toBeNull();
  });

  it("com o aplicativo já aprovado, a frase não promete uma aprovação que já veio", () => {
    desenhar({ ligacaoAberta: false, aprovadoPelaMeta: true });
    expect(within(cartao()).queryByText(/quando a Meta aprovar/)).toBeNull();
    expect(within(cartao()).getByText(t.indisponivelAprovado)).toBeTruthy();
  });
});

describe("sem conta ligada", () => {
  it("a dona vê o botão que leva a /api/meta/conectar, o que lemos e o que nunca fazemos, e o aviso do grupo pequeno", () => {
    desenhar();
    expect(cartao().getAttribute("data-estado")).toBe("sem-ligacao");
    const ligar = within(cartao()).getByRole("link", { name: t.ligar });
    expect(ligar.getAttribute("href")).toBe("/api/meta/conectar");
    expect(within(cartao()).getByText(t.oQueLemos)).toBeTruthy();
    expect(within(cartao()).getByText(/nunca fazemos: ler as suas mensagens nem postar sem você pedir/)).toBeTruthy();
    const aviso = within(cartao()).getByText(/abre para todos quando a Meta aprovar o aplicativo/);
    expect(aviso.textContent).toContain("Se a Meta disser que você não pode entrar");
  });

  it("com o aplicativo aprovado, o aviso do grupo pequeno some e o botão fica", () => {
    desenhar({ aprovadoPelaMeta: true });
    expect(within(cartao()).queryByText(/grupo pequeno/)).toBeNull();
    expect(within(cartao()).getByRole("link", { name: t.ligar })).toBeTruthy();
  });

  it("quem é só membro lê o convite, sem o botão, e vê quem pode ligar", () => {
    desenhar({ dono: false });
    expect(within(cartao()).queryByRole("link")).toBeNull();
    expect(within(cartao()).getByText(t.soDono)).toBeTruthy();
  });

  it("no ver como a dona também não tem o botão, e a tela diz por quê", () => {
    desenhar({ verComo: true });
    expect(within(cartao()).queryByRole("link")).toBeNull();
    expect(within(cartao()).queryByRole("button")).toBeNull();
    expect(within(cartao()).getByText(t.verComo)).toBeTruthy();
  });
});

describe("com a conta ligada", () => {
  it("mostra o nome da conta, a Página, desde quando e a última leitura", () => {
    desenhar({ conta: conta({ ultimaLeituraEm: new Date("2026-10-22T09:20:00Z"), publicarLiberado: true }) });
    expect(cartao().getAttribute("data-estado")).toBe("ligada");
    const c = cartao();
    expect(within(c).getByText("@casa.em.ordem")).toBeTruthy();
    expect(within(c).getByText("Casa em Ordem")).toBeTruthy();
    expect(within(c).getByText("12/10/2026")).toBeTruthy();
    expect(within(c).getByText("22/10/2026 às 06:20")).toBeTruthy();
    expect(within(c).getByRole("button", { name: t.desligar })).toBeTruthy();
    expect(within(c).queryByRole("link")).toBeNull();
  });

  it("E56: conta ligada sem a publicação liberada diz como liberar (ligar de novo); com ela, diz que está liberada", () => {
    const sem = desenhar({ conta: conta() });
    expect(within(cartao()).getByText(t.publicarFalta).closest("[data-parte='publicar']")?.getAttribute("data-publicar")).toBe("falta");
    expect(within(cartao()).getByRole("link", { name: t.ligarDeNovo }).getAttribute("href")).toBe("/api/meta/conectar");
    sem.unmount();
    desenhar({ conta: conta({ publicarLiberado: true }) });
    expect(within(cartao()).getByText(t.publicarLiberada).closest("[data-parte='publicar']")?.getAttribute("data-publicar")).toBe("liberada");
    expect(within(cartao()).queryByRole("link", { name: t.ligarDeNovo })).toBeNull();
  });

  it("sem leitura ainda, diz que acontece sozinho", () => {
    desenhar({ conta: conta() });
    expect(within(cartao()).getByText(t.semLeitura)).toBeTruthy();
  });

  it("com o problema guardado na conta: mostra a frase como alerta e oferece ligar de novo", () => {
    desenhar({ conta: conta({ erro: textosLigacao.erroDaConta.recusada }) });
    const alerta = within(cartao()).getByRole("alert");
    expect(alerta.textContent).toContain(textosLigacao.erroDaConta.recusada);
    expect(within(cartao()).getByRole("link", { name: t.ligarDeNovo }).getAttribute("href")).toBe("/api/meta/conectar");
    expect(within(cartao()).getByRole("button", { name: t.desligar })).toBeTruthy();
  });

  it("cada problema guardado aparece com a frase pronta", () => {
    for (const frase of Object.values(textosLigacao.erroDaConta)) {
      const { unmount } = desenhar({ conta: conta({ erro: frase }) });
      expect(within(cartao()).getByText(frase)).toBeTruthy();
      unmount();
    }
  });

  it("com o problema guardado e a ligação fechada, não oferece ligar de novo (só desligar)", () => {
    desenhar({ ligacaoAberta: false, conta: conta({ erro: textosLigacao.erroDaConta.venceu }) });
    expect(within(cartao()).queryByRole("link", { name: t.ligarDeNovo })).toBeNull();
    expect(within(cartao()).getByRole("button", { name: t.desligar })).toBeTruthy();
  });

  it("quem é só membro lê a conta, sem Desligar", () => {
    desenhar({ dono: false, conta: conta() });
    expect(within(cartao()).getByText("@casa.em.ordem")).toBeTruthy();
    expect(within(cartao()).queryByRole("button")).toBeNull();
    expect(within(cartao()).getByText(t.soDono)).toBeTruthy();
  });

  it("no ver como lê a conta, sem Desligar e sem Ligar de novo, mesmo com problema guardado", () => {
    desenhar({ verComo: true, conta: conta({ erro: textosLigacao.erroDaConta.recusada }) });
    expect(within(cartao()).getByText("@casa.em.ordem")).toBeTruthy();
    expect(within(cartao()).queryByRole("button")).toBeNull();
    expect(within(cartao()).queryByRole("link")).toBeNull();
    expect(within(cartao()).getByText(t.verComo)).toBeTruthy();
  });
});

describe("desligar com confirmação", () => {
  it("Desligar só pergunta; nada é desligado até o 'Sim', e 'Manter ligado' volta atrás", () => {
    desenhar({ conta: conta() });
    fireEvent.click(within(cartao()).getByRole("button", { name: t.desligar }));
    const pergunta = within(cartao()).getByRole("alertdialog");
    expect(pergunta.textContent).toMatch(/apaga o acesso que guardamos/);
    expect(desligarInstagramAction).not.toHaveBeenCalled();
    fireEvent.click(within(pergunta).getByRole("button", { name: t.confirmaNao }));
    expect(within(cartao()).queryByRole("alertdialog")).toBeNull();
    expect(desligarInstagramAction).not.toHaveBeenCalled();
    expect(within(cartao()).getByRole("button", { name: t.desligar })).toBeTruthy();
  });

  it("'Sim, desligar' chama a ação uma vez e avisa que desligou", async () => {
    desenhar({ conta: conta() });
    desligarInstagramAction.mockResolvedValue({ ok: true, dado: { apagadas: 1 } });
    fireEvent.click(within(cartao()).getByRole("button", { name: t.desligar }));
    fireEvent.click(within(cartao()).getByRole("button", { name: t.confirmaSim }));
    await waitFor(() => expect(screen.getByText(t.desligado)).toBeTruthy());
    expect(desligarInstagramAction).toHaveBeenCalledTimes(1);
    expect(within(cartao()).queryByRole("alertdialog")).toBeNull();
  });

  it("se a ação recusa, mostra a frase dela e deixa a pergunta aberta para tentar de novo", async () => {
    desenhar({ conta: conta() });
    desligarInstagramAction.mockResolvedValue({ ok: false, erro: textosLigacao.retorno["sem-acesso"] });
    fireEvent.click(within(cartao()).getByRole("button", { name: t.desligar }));
    fireEvent.click(within(cartao()).getByRole("button", { name: t.confirmaSim }));
    await waitFor(() => expect(within(cartao()).getByRole("alert").textContent).toContain(textosLigacao.retorno["sem-acesso"]));
    expect(within(cartao()).getByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByText(t.desligado)).toBeNull();
  });

  it("se a ação cai (rede, servidor), mostra a frase de tentar de novo", async () => {
    desenhar({ conta: conta() });
    desligarInstagramAction.mockRejectedValue(new Error("rede"));
    fireEvent.click(within(cartao()).getByRole("button", { name: t.desligar }));
    fireEvent.click(within(cartao()).getByRole("button", { name: t.confirmaSim }));
    await waitFor(() => expect(within(cartao()).getByRole("alert").textContent).toContain(t.erroDesligar));
  });
});

describe("escolher entre várias contas", () => {
  const candidatas = [conta({ contaId: "111", nome: "casa.em.ordem", paginaNome: "Casa em Ordem" }), conta({ id: 2, contaId: "222", nome: "casa.em.ordem.sul", paginaNome: null })];

  it("lista cada Instagram com a Página, e um botão por conta", () => {
    desenhar({ candidatas, retorno: "escolher" });
    expect(cartao().getAttribute("data-estado")).toBe("escolher");
    const itens = within(cartao()).getAllByRole("listitem");
    expect(itens).toHaveLength(2);
    expect(within(itens[0]).getByText("@casa.em.ordem")).toBeTruthy();
    expect(within(itens[0]).getByText("Página Casa em Ordem")).toBeTruthy();
    expect(within(itens[1]).getByText("@casa.em.ordem.sul")).toBeTruthy();
    expect(within(itens[1]).queryByText(/^Página/)).toBeNull();
    expect(within(cartao()).getAllByRole("button", { name: t.escolher.esta })).toHaveLength(2);
    expect(within(cartao()).getByText(t.escolher.validade)).toBeTruthy();
    // A frase da volta já diz "escolha qual é o seu": a lista não repete.
    expect(within(cartao()).getAllByText(textosLigacao.retorno.escolher)).toHaveLength(1);
  });

  it("sem a frase da volta (a pessoa abriu Conta de novo), a lista traz a própria pergunta", () => {
    desenhar({ candidatas });
    expect(within(cartao()).getByText(textosLigacao.retorno.escolher)).toBeTruthy();
  });

  it("escolher manda o id da conta escolhida e avisa que ligou", async () => {
    desenhar({ candidatas });
    escolherInstagramAction.mockResolvedValue({ ok: true, dado: { contaId: "222" } });
    const itens = within(cartao()).getAllByRole("listitem");
    fireEvent.click(within(itens[1]).getByRole("button", { name: t.escolher.esta }));
    await waitFor(() => expect(screen.getByText(t.escolher.escolhida)).toBeTruthy());
    expect(escolherInstagramAction).toHaveBeenCalledTimes(1);
    expect(escolherInstagramAction).toHaveBeenCalledWith("222");
  });

  it("a escolha que venceu volta com a frase da ação", async () => {
    desenhar({ candidatas });
    escolherInstagramAction.mockResolvedValue({ ok: false, erro: textosLigacao.retorno.venceu });
    fireEvent.click(within(cartao()).getAllByRole("button", { name: t.escolher.esta })[0]);
    await waitFor(() => expect(within(cartao()).getByRole("alert").textContent).toContain(textosLigacao.retorno.venceu));
  });

  it("quem é só membro e o ver como não veem a lista de escolha", () => {
    desenhar({ dono: false, candidatas });
    expect(within(cartao()).queryByRole("listitem")).toBeNull();
    cleanup();
    desenhar({ verComo: true, candidatas });
    expect(within(cartao()).queryByRole("listitem")).toBeNull();
    expect(within(cartao()).queryByRole("button")).toBeNull();
  });
});

describe("a volta do diálogo da Meta (?instagram=)", () => {
  it("cada código mostra a sua frase pronta; ligada em faixa de aviso calmo, o resto como alerta", () => {
    for (const [codigo, frase] of Object.entries(textosLigacao.retorno)) {
      const { unmount } = desenhar({ retorno: codigo as keyof typeof textosLigacao.retorno });
      const faixa = cartao().querySelector(`[data-retorno="${codigo}"]`);
      expect(faixa, codigo).not.toBeNull();
      expect(faixa?.textContent).toContain(frase);
      expect(faixa?.getAttribute("role")).toBe(codigo === "ligada" || codigo === "escolher" ? "status" : "alert");
      unmount();
    }
  });

  it("tira o ?instagram= do endereço, para recarregar a página não repetir a frase", async () => {
    window.history.replaceState(null, "", "/conta?instagram=cancelou&outra=1");
    desenhar({ retorno: "cancelou" });
    await waitFor(() => expect(window.location.search).toBe("?outra=1"));
    expect(within(cartao()).getByText(textosLigacao.retorno.cancelou)).toBeTruthy();
  });

  it("depois de uma ação, a frase da volta sai da tela", async () => {
    desenhar({ retorno: "ligada", conta: conta() });
    desligarInstagramAction.mockResolvedValue({ ok: false, erro: t.erroDesligar });
    expect(within(cartao()).getByText(textosLigacao.retorno.ligada)).toBeTruthy();
    fireEvent.click(within(cartao()).getByRole("button", { name: t.desligar }));
    fireEvent.click(within(cartao()).getByRole("button", { name: t.confirmaSim }));
    await waitFor(() => expect(within(cartao()).queryByText(textosLigacao.retorno.ligada)).toBeNull());
  });
});
