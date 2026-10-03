/**
 * `FormularioConta`, o ramo e o site (E45 PR 1 e 2): o que o e2e não prova com precisão: o que a pessoa manda e o que ela vê depois de
 * salvar sem recarregar a página (a página não recarrega: o que está "gravado" é o que a última gravação devolveu), o "Não achei o meu"
 * da Conta, o aviso do ramo provisório, e a frase do teto de ramos novos do dia, que volta como valor e não como erro lançado.
 *
 * A Server Action e o contexto de conexão saem mockados: o que importa aqui é só o que o formulário faz com o que elas devolvem.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const salvarContaAction = vi.fn();

vi.mock("./acoes", () => ({ salvarContaAction: (...args: unknown[]) => salvarContaAction(...args) }));

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

import { FormularioConta } from "./FormularioConta";

const PROPS_BASE = {
  nomeInicial: "Casa em Ordem",
  email: "casa@exemplo.teste",
  instagramInicial: "",
  tiktokInicial: "",
  youtubeInicial: "",
  siteInicial: "https://site-a.exemplo.test",
  temaInicial: "sistema" as const,
  horaLembreteInicial: "08:00",
  nomeMarca: "Casa em Ordem",
  tipo: "negocio" as const,
  ramoInicial: { slug: "odontologia", nome: "Odontologia" },
  pedidoDeRamo: null,
  ondeInicial: "brasil" as const,
  regiaoInicial: null,
  paisInicial: null,
  paisesInicial: null,
};

const OK_SEM_PEDIDO = { ok: true, dado: { pedidoDeRamo: undefined } };

beforeEach(() => {
  salvarContaAction.mockReset();
  salvarContaAction.mockResolvedValue(OK_SEM_PEDIDO);
});

afterEach(cleanup);

function campoRamo(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "ramo" }) as HTMLInputElement;
}

function campoSite(): HTMLInputElement {
  return screen.getByLabelText(/O site da sua marca/) as HTMLInputElement;
}

async function salvar() {
  fireEvent.click(screen.getByRole("button", { name: "salvar" }));
  await waitFor(() => expect(salvarContaAction).toHaveBeenCalled());
}

async function escolherRamo(digitado: string) {
  fireEvent.focus(campoRamo());
  fireEvent.change(campoRamo(), { target: { value: digitado } });
  fireEvent.keyDown(campoRamo(), { key: "Enter" });
}

function ultimaGravacao(): Record<string, unknown> {
  return salvarContaAction.mock.calls[salvarContaAction.mock.calls.length - 1][0] as Record<string, unknown>;
}

describe("FormularioConta: o que está gravado é o que a última gravação devolveu (a página não recarrega)", () => {
  it("o site: trocar, salvar, voltar ao de antes e salvar de novo manda o de antes (comparava com o da abertura e não mandava nada)", async () => {
    render(<FormularioConta {...PROPS_BASE} />);

    fireEvent.change(campoSite(), { target: { value: "https://site-b.exemplo.test" } });
    await salvar();
    expect(ultimaGravacao().site).toBe("https://site-b.exemplo.test");

    salvarContaAction.mockClear();
    fireEvent.change(campoSite(), { target: { value: "https://site-a.exemplo.test" } });
    await salvar();
    expect(ultimaGravacao().site).toBe("https://site-a.exemplo.test");
  });

  it("o site: salvar sem mexer nele não manda o site (o que está gravado antes da regra de agora nunca impede de salvar o resto)", async () => {
    render(<FormularioConta {...PROPS_BASE} />);
    await salvar();
    expect(ultimaGravacao()).not.toHaveProperty("site");
  });

  it("o ramo: trocar, salvar, voltar ao de antes e salvar de novo manda o de antes", async () => {
    render(<FormularioConta {...PROPS_BASE} />);

    await escolherRamo("nutri");
    await salvar();
    expect(ultimaGravacao().ramo).toBe("nutricao");

    salvarContaAction.mockClear();
    await escolherRamo("dentista");
    await salvar();
    expect(ultimaGravacao().ramo).toBe("odontologia");
  });

  it("o ramo: salvar sem mexer nele não manda o ramo", async () => {
    render(<FormularioConta {...PROPS_BASE} />);
    await salvar();
    expect(ultimaGravacao()).not.toHaveProperty("ramo");
    expect(ultimaGravacao()).not.toHaveProperty("ramoOutro");
  });
});

describe("FormularioConta: o 'Não achei o meu' (E45 PR 2)", () => {
  it("a lista oferece 'Não achei o meu'; escolher abre o campo de texto livre com o que a pessoa digitou", async () => {
    render(<FormularioConta {...PROPS_BASE} />);
    fireEvent.focus(campoRamo());
    fireEvent.change(campoRamo(), { target: { value: "criação de abelhas" } });
    fireEvent.keyDown(campoRamo(), { key: "ArrowDown" });

    // Sem ramo parecido (o catálogo não tem abelha no nome): só sobra a saída.
    const saida = screen.getAllByRole("option").find((o) => o.textContent?.includes("Não achei o meu"));
    expect(saida).toBeTruthy();
    fireEvent.click(saida!);

    const texto = screen.getByLabelText("qual é o seu ramo") as HTMLInputElement;
    expect(texto.value).toBe("criação de abelhas");
    expect(campoRamo().value).toBe("Não achei o meu");
  });

  it("salvar manda o texto livre (e não um ramo), e o aviso do ramo provisório aparece com o que a gravação devolveu", async () => {
    salvarContaAction.mockResolvedValue({ ok: true, dado: { pedidoDeRamo: { texto: "criação de abelhas", ramoProvisorio: "Agro e campo" } } });
    render(<FormularioConta {...PROPS_BASE} />);
    fireEvent.focus(campoRamo());
    fireEvent.change(campoRamo(), { target: { value: "criação de abelhas" } });
    fireEvent.keyDown(campoRamo(), { key: "ArrowDown" });
    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes("Não achei o meu"))!);

    await salvar();

    expect(ultimaGravacao().ramoOutro).toBe("criação de abelhas");
    expect(ultimaGravacao()).not.toHaveProperty("ramo");
    await waitFor(() => expect(screen.getByText("Você está em Agro e campo enquanto a gente confere o seu ramo.")).toBeTruthy());

    // Salvar de novo sem mexer no texto não refaz o palpite (não manda o texto de novo).
    salvarContaAction.mockClear();
    await salvar();
    expect(ultimaGravacao()).not.toHaveProperty("ramoOutro");
  });

  it("pedido aberto ao abrir a página: o campo mostra 'Não achei o meu' com o texto dela e o aviso, e salvar sem mexer não manda nada do ramo", async () => {
    render(
      <FormularioConta
        {...PROPS_BASE}
        ramoInicial={{ slug: "agro-e-campo", nome: "Agro e campo" }}
        pedidoDeRamo={{ texto: "criação de abelhas", ramoProvisorio: "Agro e campo" }}
      />,
    );

    expect(campoRamo().value).toBe("Não achei o meu");
    expect((screen.getByLabelText("qual é o seu ramo") as HTMLInputElement).value).toBe("criação de abelhas");
    expect(screen.getByText("Você está em Agro e campo enquanto a gente confere o seu ramo.")).toBeTruthy();

    await salvar();
    expect(ultimaGravacao()).not.toHaveProperty("ramo");
    expect(ultimaGravacao()).not.toHaveProperty("ramoOutro");
  });

  it("sem ramo parecido: a marca continua no ramo de antes e o aviso diz isso (nunca promete um ramo que não existe)", async () => {
    salvarContaAction.mockResolvedValue({ ok: true, dado: { pedidoDeRamo: { texto: "xyzw abcd", ramoProvisorio: null } } });
    render(<FormularioConta {...PROPS_BASE} />);
    fireEvent.focus(campoRamo());
    fireEvent.change(campoRamo(), { target: { value: "xyzw abcd" } });
    fireEvent.keyDown(campoRamo(), { key: "ArrowDown" });
    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes("Não achei o meu"))!);

    await salvar();

    await waitFor(() => expect(screen.getByText("A gente vai conferir o seu ramo. Até lá, você continua em Odontologia.")).toBeTruthy());
  });

  it("escolher um ramo da lista com o pedido aberto manda o ramo, e depois de salvar o aviso do provisório some", async () => {
    salvarContaAction.mockResolvedValue({ ok: true, dado: { pedidoDeRamo: null } });
    render(
      <FormularioConta
        {...PROPS_BASE}
        ramoInicial={{ slug: "agro-e-campo", nome: "Agro e campo" }}
        pedidoDeRamo={{ texto: "criação de abelhas", ramoProvisorio: "Agro e campo" }}
      />,
    );

    await escolherRamo("nutri");
    await salvar();

    expect(ultimaGravacao().ramo).toBe("nutricao");
    expect(ultimaGravacao()).not.toHaveProperty("ramoOutro");
    await waitFor(() => expect(screen.queryByText(/enquanto a gente confere o seu ramo/)).toBeNull());
    expect(screen.queryByLabelText("qual é o seu ramo")).toBeNull();
  });

  it("o texto livre vazio não deixa salvar (a marca precisa escrever o ramo ou escolher um da lista)", async () => {
    render(<FormularioConta {...PROPS_BASE} />);
    fireEvent.focus(campoRamo());
    fireEvent.change(campoRamo(), { target: { value: "xyzw" } });
    fireEvent.keyDown(campoRamo(), { key: "ArrowDown" });
    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes("Não achei o meu"))!);
    fireEvent.change(screen.getByLabelText("qual é o seu ramo"), { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: "salvar" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Escreva o seu ramo"));
    expect(salvarContaAction).not.toHaveBeenCalled();
  });
});

describe("FormularioConta: o teto de ramos novos do dia volta como frase", () => {
  it("a frase aparece no formulário (nada foi gravado), e uma segunda tentativa reenvia o ramo", async () => {
    salvarContaAction.mockResolvedValueOnce({ ok: false, erro: "Muitos ramos novos hoje; tente de novo amanhã." });
    render(<FormularioConta {...PROPS_BASE} />);
    await escolherRamo("nutri");

    await salvar();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Muitos ramos novos hoje; tente de novo amanhã."));
    // A página ainda vê o ramo de antes como o gravado: tentar de novo (amanhã) manda o ramo outra vez.
    salvarContaAction.mockClear();
    salvarContaAction.mockResolvedValue(OK_SEM_PEDIDO);
    await salvar();
    expect(ultimaGravacao().ramo).toBe("nutricao");
  });
});
