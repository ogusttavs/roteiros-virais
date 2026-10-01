import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampoPerfilRede } from "./CampoPerfilRede";

afterEach(() => {
  cleanup();
});

describe("CampoPerfilRede (V12c, item 3b, a E37b)", () => {
  it("mostra o começo do endereço fixo, por plataforma", () => {
    render(<CampoPerfilRede plataforma="tiktok" rotulo="TikTok" valor="" onMudar={() => {}} avisoInvalido="Confira o nome do perfil" />);
    expect(screen.getByText("tiktok.com/@")).toBeTruthy();
  });

  it("o campo nunca repete o @ do YouTube (já está no prefixo)", () => {
    render(
      <CampoPerfilRede plataforma="youtube" rotulo="YouTube" valor="@drwash" onMudar={() => {}} avisoInvalido="Confira o nome do perfil" />,
    );
    const campo = screen.getByLabelText("YouTube") as HTMLInputElement;
    expect(campo.value).toBe("drwash");
  });

  it("colar um endereço inteiro devolve só o nome, já normalizado", () => {
    const onMudar = vi.fn();
    render(<CampoPerfilRede plataforma="instagram" rotulo="Instagram" valor="" onMudar={onMudar} avisoInvalido="Confira o nome do perfil" />);
    fireEvent.change(screen.getByLabelText("Instagram"), { target: { value: "https://www.instagram.com/drwash/" } });
    expect(onMudar).toHaveBeenCalledWith("drwash");
  });

  it("caractere que a plataforma não aceita mostra o aviso, sem travar (campo continua preenchido)", () => {
    render(
      <CampoPerfilRede plataforma="instagram" rotulo="Instagram" valor="dr wash" onMudar={() => {}} avisoInvalido="Confira o nome do perfil" />,
    );
    expect(screen.getByText("Confira o nome do perfil")).toBeTruthy();
    expect((screen.getByLabelText("Instagram") as HTMLInputElement).value).toBe("dr wash");
  });

  it("vazio nunca mostra o aviso", () => {
    render(<CampoPerfilRede plataforma="instagram" rotulo="Instagram" valor="" onMudar={() => {}} avisoInvalido="Confira o nome do perfil" />);
    expect(screen.queryByText("Confira o nome do perfil")).toBeNull();
  });
});
