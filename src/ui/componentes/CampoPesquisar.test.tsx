/**
 * `CampoPesquisar` (E54, parte 3, passo 22): a linha fechada que não pesa, o campo aberto com o custo em língua de gente (tempo, reais e quantas das pesquisas do dia), o "Mais a
 * fundo" que só cabe com duas pesquisas sobrando, e o teto do dia dito com calma (nunca erro).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));
vi.mock("./CampoComFala", () => ({
  CampoComFala: ({ value, onChange, rotulo, erro, ref }: { value: string; onChange: (v: string) => void; rotulo: string; erro?: string; ref?: React.Ref<HTMLTextAreaElement> }) => (
    <div>
      <textarea aria-label={rotulo} value={value} onChange={(e) => onChange(e.target.value)} ref={ref} />
      {erro ? <p role="alert">{erro}</p> : null}
    </div>
  ),
}));

import type { DadosDoCampoDePesquisa } from "@/servicos/pesquisa-na-hora";

import { CampoPesquisar } from "./CampoPesquisar";

const DADOS: DadosDoCampoDePesquisa = { usadasHoje: 0, teto: 3, rapida: "uns R$ 0,50", aFundo: "uns R$ 0,95" };

afterEach(cleanup);

function Montado({ dados = DADOS, abertoInicial = false, erro = null }: { dados?: DadosDoCampoDePesquisa; abertoInicial?: boolean; erro?: string | null }) {
  const [aberto, setAberto] = useState(abertoInicial);
  const [pedido, setPedido] = useState("");
  const [profundidade, setProfundidade] = useState<"normal" | "aprofundada">("normal");
  return (
    <CampoPesquisar
      dados={dados}
      aberto={aberto}
      aoAbrir={() => setAberto(true)}
      aoTirar={() => setAberto(false)}
      pedido={pedido}
      aoMudarPedido={setPedido}
      profundidade={profundidade}
      aoMudarProfundidade={setProfundidade}
      erro={erro}
    />
  );
}

describe("CampoPesquisar", () => {
  it("fechado é uma linha só, opcional; tocar abre o campo", () => {
    render(<Montado />);
    const linha = screen.getByRole("button", { name: /Pesquisar antes de escrever/ });
    expect(linha.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Opcional. Dados de verdade, com a fonte, no seu vídeo.")).toBeTruthy();
    fireEvent.click(linha);
    expect(screen.getByRole("textbox", { name: "O que pesquisar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tirar" })).toBeTruthy();
  });

  it("aberto, diz o tempo, o custo em reais e quantas das pesquisas do dia cada tamanho usa", () => {
    render(<Montado abertoInicial />);
    expect(screen.getByText(/A rápida leva de 30 segundos a 1 minuto e meio, custa uns R\$ 0,50 e usa 1 das 3 pesquisas do seu dia\./)).toBeTruthy();
    expect(screen.getByText(/Mais a fundo leva até 2 minutos, custa uns R\$ 0,95 e usa 2\./)).toBeTruthy();
    expect(screen.getByText(/Hoje você ainda tem as 3\./)).toBeTruthy();
  });

  it("depois de usar uma, diz quantas sobram", () => {
    render(<Montado abertoInicial dados={{ ...DADOS, usadasHoje: 1 }} />);
    expect(screen.getByText(/Hoje você ainda tem 2\./)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Mais a fundo" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("com uma só pesquisa sobrando, o 'Mais a fundo' não cabe e o texto diz só a rápida", () => {
    render(<Montado abertoInicial dados={{ ...DADOS, usadasHoje: 2 }} />);
    expect((screen.getByRole("radio", { name: "Mais a fundo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Hoje só sobra 1 pesquisa, então só a rápida cabe/)).toBeTruthy();
  });

  it("'Rápida' vem marcada e a pessoa troca para 'Mais a fundo'", () => {
    render(<Montado abertoInicial />);
    expect(screen.getByRole("radio", { name: "Rápida" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Mais a fundo" }));
    expect(screen.getByRole("radio", { name: "Mais a fundo" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Rápida" }).getAttribute("aria-checked")).toBe("false");
  });

  it("no teto do dia, vira um aviso calmo: sem campo, sem botão, sem alerta", () => {
    render(<Montado dados={{ ...DADOS, usadasHoje: 3 }} />);
    expect(screen.getByText(/Você já usou as 3 pesquisas de hoje\./)).toBeTruthy();
    expect(screen.getByText(/Amanhã tem mais\./)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Pesquisar antes de escrever/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("'Tirar' fecha o campo", () => {
    render(<Montado abertoInicial />);
    fireEvent.click(screen.getByRole("button", { name: "Tirar" }));
    expect(screen.getByRole("button", { name: /Pesquisar antes de escrever/ })).toBeTruthy();
  });

  it("o teto que o servidor acabou de dizer vira aviso calmo (status), nunca erro do campo", () => {
    render(<CampoPesquisar dados={DADOS} aberto aoAbrir={() => undefined} aoTirar={() => undefined} pedido="x" aoMudarPedido={() => undefined} profundidade="normal" aoMudarProfundidade={() => undefined} aviso="Você já usou as 3 pesquisas de hoje." />);
    const aviso = screen.getByText("Você já usou as 3 pesquisas de hoje.").closest("[data-aviso-do-campo]") as HTMLElement;
    expect(aviso.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("abrir o campo leva o foco para o pedido (o botão que foi tocado some)", () => {
    render(<Montado />);
    fireEvent.click(screen.getByRole("button", { name: /Pesquisar antes de escrever/ }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "O que pesquisar" }));
  });

  it("nascer aberto não rouba o foco da tela", () => {
    render(<Montado abertoInicial />);
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "O que pesquisar" }));
  });

  it("o erro do pedido aparece junto do campo", () => {
    render(<Montado abertoInicial erro="Escreva em uma frase o que você quer pesquisar." />);
    expect(screen.getByRole("alert").textContent).toBe("Escreva em uma frase o que você quer pesquisar.");
  });
});
