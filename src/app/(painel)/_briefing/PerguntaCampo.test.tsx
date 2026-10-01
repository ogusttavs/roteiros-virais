/**
 * `PerguntaCampo` (P2b, item 0a da revisão do PR #77): "a fala soma, não substitui, quando o
 * campo já tem texto". Primeiro teste de componente do projeto; `useGravadorDeAudio` e a Server
 * Action `organizarFalaBriefingAction` saem mockados (o gancho já tem o próprio teste de unidade,
 * `useGravadorDeAudio.test.tsx`; aqui o que importa é só o que `PerguntaCampo` faz com o
 * `onTranscrito` que o gancho chama).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PerguntaBriefing } from "@/config/briefing";

let onTranscritoCapturado: ((texto: string, duracaoS: number) => void | Promise<void>) | null = null;

vi.mock("@/ui/componentes/useGravadorDeAudio", () => ({
  LIMITE_SEGUNDOS_PADRAO: 120,
  useGravadorDeAudio: (opcoes: { onTranscrito: (texto: string, duracaoS: number) => void | Promise<void> }) => {
    onTranscritoCapturado = opcoes.onTranscrito;
    return { fase: "inicial", segundos: 0, semMicrofone: false, erro: null, iniciarGravacao: vi.fn(), pararGravacao: vi.fn() };
  },
}));

vi.mock("./acoes", () => ({
  organizarFalaBriefingAction: vi.fn(async (_pergunta: string, textoFalado: string) => `organizado: ${textoFalado}`),
}));

vi.mock("@/ui/ConexaoContext", () => ({
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

vi.mock("../_casca/TrocaMarcaContext", () => ({
  useTrocaMarcaOpcional: () => null,
}));

import { PerguntaCampo } from "./PerguntaCampo";

const PERGUNTA: PerguntaBriefing = {
  id: "p1",
  bloco: 1,
  blocoNome: "Sobre o negócio",
  peso: 1,
  enunciado: "o que o seu negócio faz hoje",
  ajuda: "",
  oQueAIAProcura: "",
  rotuloCurto: "o que o negócio faz",
  oQueUmaBoaRespostaTem: "o que você faz, para quem, e o que muda na vida de quem compra",
};

afterEach(() => {
  cleanup();
  onTranscritoCapturado = null;
  vi.restoreAllMocks();
});

describe("PerguntaCampo, Responder falando", () => {
  it("campo vazio: a fala organizada substitui (comportamento de sempre)", async () => {
    const onSalvarRascunho = vi.fn().mockResolvedValue(undefined);
    render(
      <PerguntaCampo
        pergunta={PERGUNTA}
        resposta=""
        avaliacao={null}
        onSalvarRascunho={onSalvarRascunho}
        onAvaliar={vi.fn()}
        onAtualizado={vi.fn()}
        meta={9}
      />,
    );

    expect(onTranscritoCapturado).not.toBeNull();
    await act(async () => {
      await onTranscritoCapturado!("fala transcrita do aparelho", 12);
    });

    const campo = screen.getByLabelText(PERGUNTA.enunciado) as HTMLTextAreaElement;
    expect(campo.value).toBe("organizado: fala transcrita do aparelho");
    expect(screen.getByText("Resposta substituída pelo que você falou")).toBeTruthy();
  });

  it("campo com texto: a fala organizada entra numa linha nova, sem apagar o que já estava", async () => {
    const onSalvarRascunho = vi.fn().mockResolvedValue(undefined);
    render(
      <PerguntaCampo
        pergunta={PERGUNTA}
        resposta="Primeira parte da resposta, gravada antes."
        avaliacao={null}
        onSalvarRascunho={onSalvarRascunho}
        onAvaliar={vi.fn()}
        onAtualizado={vi.fn()}
        meta={9}
      />,
    );

    expect(onTranscritoCapturado).not.toBeNull();
    await act(async () => {
      await onTranscritoCapturado!("segunda parte, gravada depois do limite de dois minutos", 30);
    });

    const campo = screen.getByLabelText(PERGUNTA.enunciado) as HTMLTextAreaElement;
    expect(campo.value).toBe(
      "Primeira parte da resposta, gravada antes.\norganizado: segunda parte, gravada depois do limite de dois minutos",
    );
    expect(screen.getByText("Acrescentamos o que você falou")).toBeTruthy();
  });

  it("desfazer depois de somar volta exatamente ao texto de antes da segunda gravação", async () => {
    const onSalvarRascunho = vi.fn().mockResolvedValue(undefined);
    render(
      <PerguntaCampo
        pergunta={PERGUNTA}
        resposta="Primeira parte."
        avaliacao={null}
        onSalvarRascunho={onSalvarRascunho}
        onAvaliar={vi.fn()}
        onAtualizado={vi.fn()}
        meta={9}
      />,
    );

    await act(async () => {
      await onTranscritoCapturado!("segunda parte", 10);
    });
    const campo = screen.getByLabelText(PERGUNTA.enunciado) as HTMLTextAreaElement;
    expect(campo.value).toContain("segunda parte");

    act(() => {
      screen.getByRole("button", { name: "Desfazer" }).click();
    });
    expect(campo.value).toBe("Primeira parte.");
  });
});

describe("PerguntaCampo, sugestão de resposta (E37a, item 2)", () => {
  const AVALIACAO = {
    nota: 7,
    bom: "Conta o que o negócio faz.",
    melhorar: "Falta um exemplo real.",
    como: "Dê um caso concreto.",
    impacto: "Ajuda o roteiro a soar real.",
    exemplo: "Semana passada um cliente chegou com uma mancha de vinho e saiu com o sofá limpo.",
  };

  it("nunca tem textarea nem papel de campo: só o rótulo, o texto, o aviso fixo e o botão", () => {
    render(
      <PerguntaCampo
        pergunta={PERGUNTA}
        resposta="O que o negócio faz."
        avaliacao={AVALIACAO}
        onSalvarRascunho={vi.fn()}
        onAvaliar={vi.fn()}
        onAtualizado={vi.fn()}
        meta={9}
        variante="wizard"
      />,
    );

    // Só o campo de resposta é textarea; a sugestão nunca é um segundo campo.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);

    expect(screen.getByText("Sugestão de resposta")).toBeTruthy();
    expect(screen.getByText(AVALIACAO.exemplo)).toBeTruthy();
    expect(screen.getByText("É um exemplo escrito pela IA com o que você contou. Só vale se for verdade.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Usar esta sugestão" })).toBeTruthy();
  });

  it("no briefing vivo, o campo já está editável (sem botão 'editar'), e mudar o texto troca a análise pela nota antiga", () => {
    render(
      <PerguntaCampo
        pergunta={PERGUNTA}
        resposta="O que o negócio faz."
        avaliacao={AVALIACAO}
        onSalvarRascunho={vi.fn().mockResolvedValue(undefined)}
        onAvaliar={vi.fn()}
        onAtualizado={vi.fn()}
        meta={9}
        variante="vivo"
      />,
    );

    // E37a, item 1: nunca existe um botão "editar" nem um card fechado; o campo já está aberto.
    expect(screen.queryByRole("button", { name: "editar" })).toBeNull();
    expect(screen.getByText("Sugestão de resposta")).toBeTruthy();

    const campo = screen.getByLabelText(PERGUNTA.enunciado) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "O que o negócio faz, agora editado." } });

    expect(screen.getByText("de antes da edição. A nota nova vem quando você avaliar.")).toBeTruthy();
    expect(screen.queryByText("Sugestão de resposta")).toBeNull();
    expect(screen.getByRole("button", { name: "Avaliar de novo" })).toBeTruthy();
  });
});
