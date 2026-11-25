import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CarrosselTela } from "./CarrosselTela";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const foto = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome, { type: "image/png" });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:teste", revokeObjectURL: () => undefined }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("em marca de saúde, duas áreas de foto (E65 PR 5)", () => {
  it("mostra 'As suas fotos' e 'Fotos de paciente'; a autorização vale só para a segunda e o botão dela espera a marcação", () => {
    vi.mocked(fetch).mockResolvedValue(json({ carrosseis: [] }));
    render(<CarrosselTela temasDeHoje={["Seu dente escureceu?"]} corMarca="#0e5a6a" arroba="@clinica.exemplo" ramoSaude idInicial={null} />);
    expect(screen.getByRole("heading", { name: "As suas fotos" })).toBeTruthy();
    const area = screen.getByTestId("area-de-paciente");
    expect(within(area).getByRole("heading", { name: "Fotos de paciente, para o antes e depois" })).toBeTruthy();
    expect(within(area).getByText("Tenho a autorização por escrito do paciente")).toBeTruthy();
    // a área das fotos comuns não pede autorização: o botão dela está livre
    expect((screen.getByRole("button", { name: "Mandar fotos" }) as HTMLButtonElement).disabled).toBe(false);
    const botaoDePaciente = within(area).getByRole("button", { name: "Mandar fotos de paciente" }) as HTMLButtonElement;
    expect(botaoDePaciente.disabled).toBe(true);
    fireEvent.click(within(area).getByRole("checkbox"));
    expect(botaoDePaciente.disabled).toBe(false);
  });

  it("ao criar, a foto comum vai sem marca nem autorização e a de paciente vai com as duas", async () => {
    const corpos: { url: string; init?: RequestInit }[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      corpos.push({ url: String(url), init });
      if (String(url) === "/api/carrossel" && init?.method === "POST") return json({ id: 9 });
      if (String(url).endsWith("/fotos")) return json({ foto: { id: 1 }, aviso: null });
      if (String(url) === "/api/carrossel") return json({ carrosseis: [] });
      return json({ erro: "parou aqui" }, 500);
    });
    render(<CarrosselTela temasDeHoje={["Seu dente escureceu?"]} corMarca="#0e5a6a" arroba="@clinica.exemplo" ramoSaude idInicial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seu dente escureceu?" }));
    fireEvent.change(screen.getByTestId("entrada-de-foto"), { target: { files: [foto("lugar.png")] } });
    fireEvent.click(within(screen.getByTestId("area-de-paciente")).getByRole("checkbox"));
    fireEvent.change(screen.getByTestId("entrada-de-foto-de-paciente"), { target: { files: [foto("paciente.png")] } });
    await screen.findByAltText("foto de paciente 1");
    expect(screen.getByAltText("foto 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Criar o carrossel" }));
    await waitFor(() => expect(corpos.filter((c) => c.url.endsWith("/fotos"))).toHaveLength(2));
    const pedido = JSON.parse(String(corpos.find((c) => c.url === "/api/carrossel" && c.init?.method === "POST")!.init!.body)) as { fotos: number; fotosDePaciente: number };
    expect(pedido).toMatchObject({ fotos: 1, fotosDePaciente: 1 });
    const [comum, paciente] = corpos.filter((c) => c.url.endsWith("/fotos")).map((c) => c.init!.body as FormData);
    expect(comum.get("dePaciente")).toBeNull();
    expect(comum.get("autorizacaoDoPaciente")).toBeNull();
    expect(paciente.get("dePaciente")).toBe("true");
    expect(paciente.get("autorizacaoDoPaciente")).toBe("true");
  });

  it("fora da saúde há uma área só, sem autorização", () => {
    vi.mocked(fetch).mockResolvedValue(json({ carrosseis: [] }));
    render(<CarrosselTela temasDeHoje={["x"]} corMarca="#0e5a6a" arroba="" ramoSaude={false} idInicial={null} />);
    expect(screen.queryByTestId("area-de-paciente")).toBeNull();
    expect(screen.queryByText("Tenho a autorização por escrito do paciente")).toBeNull();
  });
});
