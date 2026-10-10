import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssuntoSemEncaixe } from "@/servicos/em-alta";

import { linhaDoAssuntoSemEncaixe, SemEncaixeEmAlta } from "./SemEncaixeEmAlta";

const A: AssuntoSemEncaixe = { chave: "final da copa do brasil", assunto: "Final da Copa do Brasil", doGoogle: true, doYoutube: true, desde: { dia: "ontem", hora: 22 } };
const B: AssuntoSemEncaixe = { chave: "estreia da novela", assunto: "Estreia da novela das nove", doGoogle: true, doYoutube: false, desde: { dia: "hoje", hora: 8 } };
const C: AssuntoSemEncaixe = { chave: "desfile", assunto: "Desfile de 7 de Setembro", doGoogle: false, doYoutube: true, desde: null };

afterEach(cleanup);

describe("o bloco do que está em alta e não coube no ramo (E55 PR 2b)", () => {
  it("a linha mono diz de onde vem o assunto e desde quando, e só a fonte quando o desde é desconhecido", () => {
    expect(linhaDoAssuntoSemEncaixe(A)).toBe("Google e YouTube · desde ontem, 22h");
    expect(linhaDoAssuntoSemEncaixe(B)).toBe("Google · desde hoje, 8h");
    expect(linhaDoAssuntoSemEncaixe(C)).toBe("YouTube");
    expect(linhaDoAssuntoSemEncaixe({ ...A, desde: { dia: "antes", hora: 9 } })).toBe("Google e YouTube · desde antes de ontem");
  });

  it("lista os assuntos, cada um com o botão que leva o assunto (a chave dele) ao Tema livre, e explica por que não há tema", () => {
    const aoTrazer = vi.fn();
    render(<SemEncaixeEmAlta assuntos={[A, B, C]} aoTrazer={aoTrazer} />);

    const bloco = screen.getByRole("region", { name: "Nada disso cabe bem no seu ramo hoje" });
    expect(within(bloco).getAllByRole("listitem")).toHaveLength(3);
    expect(within(bloco).getByText("Final da Copa do Brasil")).toBeTruthy();
    expect(within(bloco).getByText(/Por isso a gente não sugeriu tema/)).toBeTruthy();
    expect(within(bloco).getByText(/Assunto delicado, como política e tragédia, não aparece aqui/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Trazer para o meu ramo: Estreia da novela das nove" }));
    expect(aoTrazer).toHaveBeenCalledWith(B);
  });

  it("sem assunto nenhum não mostra o bloco, e desabilitado trava os botões", () => {
    const { container, rerender } = render(<SemEncaixeEmAlta assuntos={[]} aoTrazer={() => {}} />);
    expect(container.firstChild).toBeNull();
    rerender(<SemEncaixeEmAlta assuntos={[A]} desabilitado aoTrazer={() => {}} />);
    expect((screen.getByRole("button", { name: /Trazer para o meu ramo/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
