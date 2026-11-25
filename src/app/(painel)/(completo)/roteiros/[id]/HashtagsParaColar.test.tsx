/**
 * E70: o bloco "Hashtags para colar" aparece com dados, copia separado por espaço e some sem dados.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textosRoteiro } from "@/textos/roteiro";

import { HashtagsParaColar } from "./HashtagsParaColar";

const t = textosRoteiro.hashtags;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HashtagsParaColar", () => {
  it("com hashtags: mostra o título, as hashtags separadas por espaço e a nota honesta", () => {
    render(<HashtagsParaColar hashtags={["#dentista", "#clareamento"]} aoCopiar={vi.fn()} aoFalhar={vi.fn()} />);
    expect(screen.getByText(t.titulo)).toBeTruthy();
    expect(screen.getByText("#dentista #clareamento")).toBeTruthy();
    expect(screen.getByText(t.nota)).toBeTruthy();
  });

  it("o botão copia as hashtags separadas por espaço e avisa", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: escrever } });
    const aoCopiar = vi.fn();
    render(<HashtagsParaColar hashtags={["#a1b", "#c2d"]} aoCopiar={aoCopiar} aoFalhar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.copiar }));
    await waitFor(() => expect(aoCopiar).toHaveBeenCalledTimes(1));
    expect(escrever).toHaveBeenCalledWith("#a1b #c2d");
  });

  it("se a cópia falha, avisa a falha", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("negado")) } });
    const aoFalhar = vi.fn();
    render(<HashtagsParaColar hashtags={["#a1b"]} aoCopiar={vi.fn()} aoFalhar={aoFalhar} />);
    fireEvent.click(screen.getByRole("button", { name: t.copiar }));
    await waitFor(() => expect(aoFalhar).toHaveBeenCalledTimes(1));
  });

  it("sem hashtags o bloco não aparece", () => {
    const { container } = render(<HashtagsParaColar hashtags={[]} aoCopiar={vi.fn()} aoFalhar={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
