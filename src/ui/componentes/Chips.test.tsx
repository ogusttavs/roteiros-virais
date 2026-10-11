/** Os chips (entrega do design): uma opção marcada por vez e, a partir da E52 (PR 4), opções que aparecem mas não se escolhem. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Chips } from "./Chips";

afterEach(cleanup);

describe("Chips", () => {
  it("marca a opção escolhida e avisa o índice do toque", () => {
    const aoMudar = vi.fn();
    render(<Chips rotuloGrupo="Quanto tempo?" opcoes={["Até 60 segundos", "Mais de 3 minutos"]} selecionado={0} onChange={aoMudar} />);
    expect(screen.getByRole("button", { name: "Até 60 segundos" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Mais de 3 minutos" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Mais de 3 minutos" }));
    expect(aoMudar).toHaveBeenCalledWith(1);
  });

  it("uma opção desabilitada aparece, não se escolhe e não avisa ninguém; as outras seguem funcionando", () => {
    const aoMudar = vi.fn();
    render(<Chips rotuloGrupo="Quanto tempo?" opcoes={["Até 60 segundos", "Mais de 3 minutos"]} selecionado={0} onChange={aoMudar} desabilitadas={[1]} />);
    const longa = screen.getByRole("button", { name: "Mais de 3 minutos" }) as HTMLButtonElement;
    expect(longa.disabled).toBe(true);
    fireEvent.click(longa);
    expect(aoMudar).not.toHaveBeenCalled();
    const curta = screen.getByRole("button", { name: "Até 60 segundos" }) as HTMLButtonElement;
    expect(curta.disabled).toBe(false);
    fireEvent.click(curta);
    expect(aoMudar).toHaveBeenCalledWith(0);
  });

  it("sem a lista de desabilitadas nada muda (o uso de sempre)", () => {
    render(<Chips rotuloGrupo="Filtro" opcoes={["A", "B", "C"]} selecionado={null} onChange={() => {}} />);
    for (const nome of ["A", "B", "C"]) expect((screen.getByRole("button", { name: nome }) as HTMLButtonElement).disabled).toBe(false);
  });
});
