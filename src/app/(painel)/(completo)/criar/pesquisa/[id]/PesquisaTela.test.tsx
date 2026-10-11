/**
 * `PesquisaTela` (E54, parte 3, passo 22): o que a tela da pesquisa faz com o que o servidor devolve. O e2e prova o caminho inteiro; aqui ficam as regras de tela: o que cada estado
 * mostra, o que marcar muda no botão, a premissa e os três caminhos, a pergunta de posição só quando falta, o que "Escrever com estes N" manda ao servidor e para onde segue, o
 * "Voltar depois" e o teto do dia dito com calma.
 *
 * As Server Actions, o roteador e o contexto de conexão saem mockados.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmarPesquisaAction = vi.fn();
const lerPesquisaAction = vi.fn();
const pesquisarDeNovoAction = vi.fn();
const gerarRoteiroMomentoAction = vi.fn();
const roteiroRecenteDesdeAction = vi.fn();
const apagarRascunho = vi.fn();
const empurrar = vi.fn();
const trocar = vi.fn();

vi.mock("../acoes", () => ({
  confirmarPesquisaAction: (...args: unknown[]) => confirmarPesquisaAction(...args),
  lerPesquisaAction: (...args: unknown[]) => lerPesquisaAction(...args),
  pesquisarDeNovoAction: (...args: unknown[]) => pesquisarDeNovoAction(...args),
}));
vi.mock("../../../hoje/momento/acoes", () => ({ gerarRoteiroMomentoAction: (...args: unknown[]) => gerarRoteiroMomentoAction(...args) }));
vi.mock("../../../hoje/acoes", () => ({ roteiroRecenteDesdeAction: (...args: unknown[]) => roteiroRecenteDesdeAction(...args) }));
vi.mock("@/lib/rascunho-momento", () => ({
  apagarRascunhoDoMomento: (...args: unknown[]) => apagarRascunho(...args),
  armazenamentoDaSessao: () => "sessao",
  chaveDoRascunhoDoMomento: (marca: number) => `rascunho-${marca}`,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: empurrar, replace: trocar }) }));
vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));
// O gravador de áudio do campo de posição precisa de APIs do navegador que o jsdom não tem.
vi.mock("@/ui/componentes/CampoComFala", () => ({
  CampoComFala: ({ value, onChange, rotulo }: { value: string; onChange: (v: string) => void; rotulo: string }) => (
    <textarea aria-label={rotulo} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { OBJETIVOS_EM_ORDEM } from "@/ia/enums";
import type { AchadoDaTela, PesquisaDaTela } from "@/servicos/pesquisa-na-hora";

import { PesquisaTela } from "./PesquisaTela";

function achado(id: number, extra: Partial<AchadoDaTela> = {}): AchadoDaTela {
  return {
    id,
    dado: `Dado ${id} em frase.`,
    trecho: `Trecho ${id} da fonte.`,
    fonte: id === 1 ? "IBGE" : "Diário Nacional",
    tipo: id === 1 ? "oficial" : "imprensa",
    data: "10 de setembro de 2026",
    url: `https://exemplo.gov.br/${id}`,
    antigo: false,
    semNumero: false,
    outroLado: false,
    marcado: id <= 2,
    ...extra,
  };
}

function pesquisa(extra: Partial<PesquisaDaTela> = {}): PesquisaDaTela {
  return {
    id: 7,
    status: "pronta",
    pedido: "quanto subiu o preço dos produtos de limpeza",
    profundidade: "normal",
    motivo: null,
    achados: [achado(1), achado(2), achado(3, { antigo: true, marcado: false }), achado(4, { outroLado: true, marcado: false }), achado(5, { semNumero: true, marcado: false })],
    fontes: 2,
    premissa: null,
    decisao: null,
    pergunta: null,
    posicao: null,
    usadasHoje: 1,
    tetoPorDia: 3,
    destino: { tipo: "objetivo", consulta: { livre: "o preço subiu", data: "2026-10-20" } },
    confirmada: false,
    ...extra,
  };
}

const OBJETIVO = OBJETIVOS_EM_ORDEM[0];
const VOLTAR = "/criar/tema-livre?tema=o+pre%C3%A7o+subiu";

beforeEach(() => {
  for (const f of [confirmarPesquisaAction, lerPesquisaAction, pesquisarDeNovoAction, gerarRoteiroMomentoAction, roteiroRecenteDesdeAction, apagarRascunho, empurrar, trocar]) f.mockReset();
  lerPesquisaAction.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PesquisaTela: os dados", () => {
  it("mostra cada dado com o trecho entre aspas, a fonte, o tipo, a data e o link; os três primeiros vêm marcados (aqui, dois)", () => {
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("heading", { level: 1, name: "O que a pesquisa achou" })).toBeTruthy();
    expect(screen.getByText("5 dados em 2 fontes")).toBeTruthy();
    expect(screen.getByText("2 marcados")).toBeTruthy();
    const primeiro = document.querySelector('[data-achado="1"]') as HTMLElement;
    expect(within(primeiro).getByText("Dado 1 em frase.")).toBeTruthy();
    expect(within(primeiro).getByText(/Trecho 1 da fonte\./)).toBeTruthy();
    expect(within(primeiro).getByText("IBGE")).toBeTruthy();
    expect(within(primeiro).getByText("órgão oficial")).toBeTruthy();
    expect(within(primeiro).getByText("10 de setembro de 2026")).toBeTruthy();
    const link = within(primeiro).getByRole("link", { name: /Abrir a fonte/ });
    expect(link.getAttribute("href")).toBe("https://exemplo.gov.br/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("checkbox", { name: /Usar este dado: Dado 1 em frase\./ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: /Usar este dado: Dado 3 em frase\./ }).getAttribute("aria-checked")).toBe("false");
  });

  it("as etiquetas: o outro lado, sem número e de mais de 1 ano", () => {
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByText("De mais de 1 ano")).toBeTruthy();
    expect(screen.getByText("O outro lado")).toBeTruthy();
    expect(screen.getByText("Sem número: confira o trecho")).toBeTruthy();
  });

  it("a data que a página não deu aparece como 'sem data', e sem endereço seguro não há link", () => {
    render(<PesquisaTela inicial={pesquisa({ achados: [achado(1, { data: null, url: null })] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByText("sem data")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Abrir a fonte/ })).toBeNull();
  });

  it("marcar e desmarcar muda a contagem e o botão; sem nenhum dado marcado o botão não deixa escrever", () => {
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("button", { name: "Escrever com estes 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Dado 3 em frase\./ }));
    expect(screen.getByText("3 marcados")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escrever com estes 3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Dado 1 em frase\./ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Dado 2 em frase\./ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Dado 3 em frase\./ }));
    const botao = screen.getByRole("button", { name: "Marque pelo menos um dado para escrever" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("um dado só: 'Escrever com este 1' e '1 marcado'", () => {
    render(<PesquisaTela inicial={pesquisa({ achados: [achado(1)] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByText("1 marcado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escrever com este 1" })).toBeTruthy();
    expect(screen.getByText("1 dado em 2 fontes")).toBeTruthy();
  });

  it("'Como a gente pesquisa' diz o que as travas fazem e quanto do dia já foi usado", () => {
    render(<PesquisaTela inicial={pesquisa({ usadasHoje: 2 })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("heading", { name: "Como a gente pesquisa" })).toBeTruthy();
    expect(screen.getByText("Só em portais grandes e órgãos oficiais.")).toBeTruthy();
    expect(screen.getByText(/Hoje você já usou 2 das 3 pesquisas do dia\./)).toBeTruthy();
  });
});

describe("PesquisaTela: seguir", () => {
  it("manda os ids marcados ao servidor e, no Tema livre, abre o objetivo com a pesquisa presa ao tema", async () => {
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "objetivo", consulta: { livre: "o preço subiu", data: "2026-10-20" } } } });
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Dado 3 em frase\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 3" }));
    await waitFor(() => expect(empurrar).toHaveBeenCalled());
    expect(confirmarPesquisaAction).toHaveBeenCalledWith(7, { ids: [1, 2, 3], decisao: null, posicao: null });
    expect(empurrar).toHaveBeenCalledWith("/criar/objetivo?livre=o+pre%C3%A7o+subiu&pesquisa=7&data=2026-10-20");
  });

  it("no momento, escreve o roteiro aqui mesmo com a pesquisa e abre o roteiro novo", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockResolvedValue({ ok: true, dado: { id: 99 } });
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/roteiros/99"));
    expect(gerarRoteiroMomentoAction).toHaveBeenCalledWith({ ...dados, pesquisaId: 7 });
  });

  it("a frase do servidor (o dado que sumiu, o teto) fica na tela com calma, sem seguir", async () => {
    confirmarPesquisaAction.mockResolvedValue({ ok: false, erro: "Marque pelo menos um dado para escrever com a pesquisa, ou escreva sem ela." });
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    expect(await screen.findByText(/Marque pelo menos um dado para escrever com a pesquisa/)).toBeTruthy();
    expect(empurrar).not.toHaveBeenCalled();
    expect(document.querySelector("[data-aviso-da-pesquisa]")?.getAttribute("role")).toBe("status");
  });

  it("escrever o momento que falhou deixa a frase e os dados marcados, e o botão tenta de novo", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockResolvedValueOnce({ ok: false, erro: "A IA demorou demais." }).mockResolvedValueOnce({ ok: true, dado: { id: 5 } });
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    expect(await screen.findByText("A IA demorou demais.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/roteiros/5"));
  });
});

describe("PesquisaTela: a premissa", () => {
  const PREMISSA = { aviso: "O que você escreveu não bate com as fontes: o preço subiu 9,4%, não dobrou.", anguloSugerido: "Fale da alta de 9,4% e de quem troca de marca." };

  it("avisa antes da lista, com o caminho das fontes já marcado, e o aviso vai ao servidor na decisão", async () => {
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: null } });
    render(<PesquisaTela inicial={pesquisa({ premissa: PREMISSA })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByText("O que você escreveu não bate com as fontes")).toBeTruthy();
    expect(screen.getByText(/o preço subiu 9,4%, não dobrou\./)).toBeTruthy();
    expect(screen.getByText("Fale da alta de 9,4% e de quem troca de marca.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Escrever com o que as fontes dizem/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(confirmarPesquisaAction).toHaveBeenCalled());
    expect(confirmarPesquisaAction).toHaveBeenCalledWith(7, { ids: [1, 2], decisao: "fontes", posicao: null });
  });

  it("'Seguir com o que eu escrevi' mostra de quem é a responsabilidade e vai ao servidor como 'manter'", async () => {
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: null } });
    render(<PesquisaTela inicial={pesquisa({ premissa: PREMISSA })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("radio", { name: /Seguir com o que eu escrevi, mesmo assim/ }));
    expect(screen.getByText(/quem responde pelo que é dito é você/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(confirmarPesquisaAction).toHaveBeenCalled());
    expect(confirmarPesquisaAction.mock.calls[0][1].decisao).toBe("manter");
  });

  it("'Mudar o que eu escrevi' troca o botão por voltar ao campo, sem gastar nada", () => {
    render(<PesquisaTela inicial={pesquisa({ premissa: PREMISSA })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("radio", { name: /Mudar o que eu escrevi/ }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar e mudar o que escrevi" }));
    expect(empurrar).toHaveBeenCalledWith(VOLTAR);
    expect(confirmarPesquisaAction).not.toHaveBeenCalled();
  });

  it("sem aviso (a premissa confere ou não existia), a pergunta nem aparece", () => {
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.queryByText("O que você escreveu não bate com as fontes")).toBeNull();
  });
});

describe("PesquisaTela: a posição", () => {
  const PERGUNTA = { pergunta: "Para você, de quem é a culpa da alta?", opcoes: ["Do fabricante", "Do imposto e do frete", "Dos dois", "Prefiro não dar opinião"] };

  it("com a pergunta, 'Escrever' primeiro leva à pergunta, e a resposta vai junto dos dados", async () => {
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: null } });
    render(<PesquisaTela inicial={pesquisa({ pergunta: PERGUNTA })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    expect(screen.getByRole("heading", { level: 1, name: "Uma pergunta antes de escrever" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Para você, de quem é a culpa da alta?" })).toBeTruthy();
    expect(screen.getByText("Você marcou 2 dados, do IBGE e do Diário Nacional.")).toBeTruthy();
    expect(confirmarPesquisaAction).not.toHaveBeenCalled();

    // sem resposta, não escreve
    expect((screen.getByRole("button", { name: "Escrever o roteiro" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Dos dois" }));
    fireEvent.click(screen.getByRole("button", { name: "Escrever o roteiro" }));
    await waitFor(() => expect(confirmarPesquisaAction).toHaveBeenCalled());
    expect(confirmarPesquisaAction).toHaveBeenCalledWith(7, { ids: [1, 2], decisao: null, posicao: "Dos dois" });
  });

  it("a frase escrita vale mais que a opção marcada; 'Prefiro não dar opinião' é uma resposta", async () => {
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: null } });
    render(<PesquisaTela inicial={pesquisa({ pergunta: PERGUNTA })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    fireEvent.click(screen.getByRole("radio", { name: "Prefiro não dar opinião" }));
    fireEvent.change(screen.getByLabelText("Sua resposta, em uma frase"), { target: { value: "Subiu para todo mundo." } });
    fireEvent.click(screen.getByRole("button", { name: "Escrever o roteiro" }));
    await waitFor(() => expect(confirmarPesquisaAction).toHaveBeenCalled());
    expect(confirmarPesquisaAction.mock.calls[0][1].posicao).toBe("Subiu para todo mundo.");
  });

  it("'Voltar aos dados' volta à lista com o que estava marcado", () => {
    render(<PesquisaTela inicial={pesquisa({ pergunta: PERGUNTA })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos dados" }));
    expect(screen.getByText("2 marcados")).toBeTruthy();
  });
});

describe("PesquisaTela: sem dado, erro e teto", () => {
  it("sem achados: diz que a busca conta e oferece escrever sem pesquisa ou mudar o pedido", () => {
    render(<PesquisaTela inicial={pesquisa({ status: "sem_achados", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("heading", { level: 1, name: "Não achamos dado confiável sobre isso" })).toBeTruthy();
    expect(screen.getByText(/A busca foi feita, então ela conta no seu limite do dia\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mudar o pedido" }));
    expect(empurrar).toHaveBeenCalledWith(VOLTAR);
  });

  it("'Escrever sem pesquisa' segue o caminho de sempre, sem o id da pesquisa", () => {
    render(<PesquisaTela inicial={pesquisa({ status: "sem_achados", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever sem pesquisa" }));
    expect(empurrar).toHaveBeenCalledWith("/criar/objetivo?livre=o+pre%C3%A7o+subiu&data=2026-10-20");
  });

  it("no momento, 'Escrever sem pesquisa' escreve o roteiro aqui mesmo, sem pesquisaId", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO };
    gerarRoteiroMomentoAction.mockResolvedValue({ ok: true, dado: { id: 12 } });
    render(<PesquisaTela inicial={pesquisa({ status: "erro", motivo: "A pesquisa não terminou.", achados: [], destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever sem pesquisa" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/roteiros/12"));
    expect(gerarRoteiroMomentoAction).toHaveBeenCalledWith({ ...dados, pesquisaId: undefined });
  });

  it("erro: a frase do servidor e 'Tentar de novo' cria outra pesquisa e abre a dela", async () => {
    pesquisarDeNovoAction.mockResolvedValue({ ok: true, dado: { id: 8 } });
    render(<PesquisaTela inicial={pesquisa({ status: "erro", motivo: "A pesquisa não terminou. Tente de novo em alguns minutos, ou escreva sem pesquisa.", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("heading", { level: 1, name: "A pesquisa não terminou" })).toBeTruthy();
    expect(screen.getByText("A falha foi nossa. O seu pedido continua aqui.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/criar/pesquisa/8"));
    expect(pesquisarDeNovoAction).toHaveBeenCalledWith(7, undefined);
  });

  it("o teto do dia na hora de pesquisar de novo vem como aviso calmo (status), nunca como alerta", async () => {
    pesquisarDeNovoAction.mockResolvedValue({ ok: false, erro: "Você já usou as 3 pesquisas de hoje. Amanhã tem mais; hoje dá para escrever com o que a gente já sabe do seu setor.", calma: true, soCabeRapida: false });
    render(<PesquisaTela inicial={pesquisa()} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar de novo (usa 1)" }));
    const aviso = await screen.findByText(/Você já usou as 3 pesquisas de hoje\./);
    expect(aviso.closest("[data-aviso-da-pesquisa]")?.getAttribute("role")).toBe("status");
    expect(trocar).not.toHaveBeenCalled();
  });
});

describe("PesquisaTela: o teto com saldo, a rede, a data e o rascunho", () => {
  it("'Pesquisar de novo' diz o que gasta no próprio botão: 1 na rápida, 2 na a fundo", () => {
    render(<PesquisaTela inicial={pesquisa({ profundidade: "aprofundada" })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("button", { name: "Pesquisar de novo (usa 2)" })).toBeTruthy();
  });

  it("quando só cabe a rápida, a frase diz isso e o botão pede a rápida (o mesmo pedido, tamanho normal)", async () => {
    pesquisarDeNovoAction
      .mockResolvedValueOnce({ ok: false, erro: 'Hoje só sobra 1 pesquisa, e a "Mais a fundo" usa 2. A rápida cabe.', calma: true, soCabeRapida: true })
      .mockResolvedValueOnce({ ok: true, dado: { id: 9 } });
    render(<PesquisaTela inicial={pesquisa({ profundidade: "aprofundada" })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar de novo (usa 2)" }));
    expect(await screen.findByText(/Hoje só sobra 1 pesquisa/)).toBeTruthy();
    expect(pesquisarDeNovoAction).toHaveBeenLastCalledWith(7, undefined);
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar de novo, na rápida" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/criar/pesquisa/9"));
    expect(pesquisarDeNovoAction).toHaveBeenLastCalledWith(7, "normal");
  });

  it("a resposta que não voltou (rede) confere se o roteiro já existe e abre o que foi escrito, sem pedir outro", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockRejectedValue(new TypeError("Failed to fetch"));
    roteiroRecenteDesdeAction.mockResolvedValue({ id: 77 });
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/roteiros/77"));
    expect(gerarRoteiroMomentoAction).toHaveBeenCalledTimes(1);
    expect(apagarRascunho).toHaveBeenCalledWith("sessao", "rascunho-3");
  });

  it("a rede caiu e o roteiro não existe: a frase de sempre, com os dados ainda marcados", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockRejectedValue(new TypeError("Failed to fetch"));
    roteiroRecenteDesdeAction.mockResolvedValue(null);
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    expect(await screen.findByText(/Não conseguimos escrever o roteiro agora/)).toBeTruthy();
    expect(trocar).not.toHaveBeenCalled();
    expect(screen.getByText("2 marcados")).toBeTruthy();
  });

  it("a data que passou enquanto a pesquisa esperava vai para hoje (sem a data), em vez de prender a pesquisa já paga", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO, data: "2020-01-01" };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockResolvedValue({ ok: true, dado: { id: 5 } });
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/roteiros/5"));
    expect(gerarRoteiroMomentoAction.mock.calls[0][0]).not.toHaveProperty("data");
  });

  it("a data de hoje ou de depois segue como a pessoa escolheu", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO, data: "2099-01-01" };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockResolvedValue({ ok: true, dado: { id: 5 } });
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(gerarRoteiroMomentoAction).toHaveBeenCalled());
    expect(gerarRoteiroMomentoAction.mock.calls[0][0].data).toBe("2099-01-01");
  });

  it("o roteiro escrito aqui apaga o rascunho do momento da marca (senão 'Contar o momento' abre com o texto já usado)", async () => {
    const dados = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama", oQueDaParaMostrar: "a etiqueta", objetivo: OBJETIVO };
    confirmarPesquisaAction.mockResolvedValue({ ok: true, dado: { destino: { tipo: "momento", dados } } });
    gerarRoteiroMomentoAction.mockResolvedValue({ ok: true, dado: { id: 5 } });
    render(<PesquisaTela inicial={pesquisa({ destino: { tipo: "momento", dados } })} voltarPara="/criar" marcaAtivaId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Escrever com estes 2" }));
    await waitFor(() => expect(trocar).toHaveBeenCalledWith("/roteiros/5"));
    expect(apagarRascunho).toHaveBeenCalledWith("sessao", "rascunho-3");
  });
});

describe("PesquisaTela: a espera", () => {
  it("enquanto pesquisa, mostra a claquete com o pedido, os passos, o tempo e 'Voltar depois' (leva ao Criar, a pesquisa continua)", () => {
    render(<PesquisaTela inicial={pesquisa({ status: "pesquisando", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    const espera = document.querySelector("[data-pesquisando]") as HTMLElement;
    expect(within(espera).getByRole("heading", { name: "Pesquisando" })).toBeTruthy();
    expect(within(espera).getByText("quanto subiu o preço dos produtos de limpeza")).toBeTruthy();
    expect(within(espera).getByText("Procurando em portais grandes e órgãos oficiais")).toBeTruthy();
    expect(within(espera).getByText(/Leva de 30 segundos a 1 minuto e meio\./)).toBeTruthy();
    fireEvent.click(within(espera).getByRole("button", { name: "Voltar depois" }));
    expect(empurrar).toHaveBeenCalledWith("/criar");
  });

  it("a 'Mais a fundo' diz que leva até 2 minutos", () => {
    render(<PesquisaTela inicial={pesquisa({ status: "pesquisando", achados: [], profundidade: "aprofundada" })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    const espera = document.querySelector("[data-pesquisando]") as HTMLElement;
    expect(within(espera).getByText(/Leva até 2 minutos\./)).toBeTruthy();
  });

  it("enquanto espera, o título da página é 'Pesquisando' (não 'O que a pesquisa achou' por trás da claquete)", () => {
    render(<PesquisaTela inicial={pesquisa({ status: "pesquisando", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    expect(screen.getByRole("heading", { level: 1, name: "Pesquisando" })).toBeTruthy();
  });

  it("lê de novo até a pesquisa terminar e então mostra o que achou, com os três primeiros marcados", async () => {
    vi.useFakeTimers();
    lerPesquisaAction.mockResolvedValueOnce(pesquisa({ status: "pesquisando", achados: [] })).mockResolvedValueOnce(pesquisa());
    render(<PesquisaTela inicial={pesquisa({ status: "pesquisando", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    await vi.advanceTimersByTimeAsync(3100);
    expect(document.querySelector("[data-pesquisando]")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3100);
    expect(lerPesquisaAction).toHaveBeenCalledWith(7);
    expect(document.querySelector("[data-pesquisando]")).toBeNull();
    expect(screen.getByText("2 marcados")).toBeTruthy();
  });

  it("uma leitura que falha não derruba a espera: tenta na próxima", async () => {
    vi.useFakeTimers();
    lerPesquisaAction.mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce(pesquisa());
    render(<PesquisaTela inicial={pesquisa({ status: "pesquisando", achados: [] })} voltarPara={VOLTAR} marcaAtivaId={3} />);
    await vi.advanceTimersByTimeAsync(3100);
    expect(document.querySelector("[data-pesquisando]")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3100);
    expect(screen.getByText("2 marcados")).toBeTruthy();
  });
});
