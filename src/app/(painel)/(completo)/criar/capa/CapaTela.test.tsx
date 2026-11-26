import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CapaTela } from "./CapaTela";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const NOTICIA = { id: 7, titulo: "Conselho publica regra nova", veiculo: "Jornal da Cidade", data: "24/11/2026" };
const DADOS = {
  carrossel: { id: 55, tema: NOTICIA.titulo, quantidade: 1, cor: "#0e5a6a", avisos: [], slides: [{ tipo: "noticia", titulo: "O que muda no seu clareamento", veiculo: NOTICIA.veiculo, data: NOTICIA.data }], legenda: "O que muda no seu clareamento. Fonte: Jornal da Cidade, 24/11/2026.", hashtags: [] },
  fotos: [],
  fotosDosSlides: [{ foto: null, fotoDepois: null }],
  slidesComFoto: [false],
};

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a capa pronta não vive só na memória da tela", () => {
  it("aberta pelo id do endereço, a tela carrega a capa por ele e mostra o pronto, sem pedir títulos nem criar outra", async () => {
    const chamadas: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url) => {
      chamadas.push(String(url));
      if (String(url).endsWith("/previa")) return json({ slides: [{ n: 1, imagem: "data:image/png;base64,AAAA", precisaEncurtar: false, semFoto: true }] });
      return json(DADOS);
    });
    render(<CapaTela noticia={NOTICIA} corMarca="#0e5a6a" arroba="@clinica.exemplo" capaInicialId={55} />);
    expect(await screen.findByRole("heading", { name: "A sua capa está pronta" })).toBeTruthy();
    expect(chamadas).toEqual(["/api/carrossel/55", "/api/carrossel/55/previa"]);
  });

  it("se a capa não abre, a tela diz isso e oferece tentar de novo", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ erro: "nao encontrado" }, 404));
    render(<CapaTela noticia={NOTICIA} corMarca="#0e5a6a" arroba="" capaInicialId={55} />);
    expect(await screen.findByText("Não deu para abrir a capa")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
});

describe("baixar a capa", () => {
  it("por fetch e blob; se o servidor falha, a frase de erro aparece na tela e a página não sai dela", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith("/previa")) return json({ slides: [{ n: 1, imagem: "data:image/png;base64,AAAA", precisaEncurtar: false, semFoto: true }] });
      if (String(url).endsWith("/slide/1")) return json({ erro: "falhou" }, 504);
      return json(DADOS);
    });
    render(<CapaTela noticia={NOTICIA} corMarca="#0e5a6a" arroba="" capaInicialId={55} />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar a imagem" }));
    expect(await screen.findByText("Não deu para baixar agora. Tente de novo em instantes.")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith("/slide/1"))).toBe(true));
  });
});

describe("a foto da capa é foto comum, em qualquer ramo (inclusive saúde)", () => {
  it("o botão da foto não espera marcação nenhuma, não há caixa de autorização e a foto vai sem marca de paciente nem autorização", async () => {
    const corpos: FormData[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/fotos")) {
        corpos.push(init?.body as FormData);
        return json({ foto: { id: 3 } });
      }
      if (u.endsWith("/previa")) return json({ slides: [{ n: 1, imagem: "data:image/png;base64,AAAA", precisaEncurtar: false, semFoto: true }] });
      return json(DADOS);
    });
    const { container } = render(<CapaTela noticia={NOTICIA} corMarca="#0e5a6a" arroba="" capaInicialId={55} />);
    const botao = (await screen.findByRole("button", { name: "Pôr uma foto" })) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Tenho a autorização por escrito do paciente")).toBeNull();
    const entrada = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" })] } });
    await waitFor(() => expect(corpos).toHaveLength(1));
    expect(corpos[0]!.get("autorizacaoDoPaciente")).toBeNull();
    expect(corpos[0]!.get("dePaciente")).toBeNull();
  });
});
