/**
 * E22 PR 1: o portao da cobranca no layout do painel. A marca que `marcaPrecisaAssinar` manda assinar cai em `/assinar`; depois do briefing e dos termos (nao antes); e o
 * "ver como" nunca e barrado. As regras do portao em si (cortesia, assinatura, ligado ou desligado) estao em `servicos/assinatura.test.ts` e na integracao.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; role: string }; verComo: object | null },
  precisa: false,
  briefingOk: true,
  termosEm: new Date("2999-01-01") as Date | null,
  precisaChamada: vi.fn(),
  semMarca: false,
}));

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));
vi.mock("@/lib/ver-como", () => ({ sessaoDoPainel: async () => m.sessao }));
vi.mock("@/servicos/clientes", () => ({
  clienteAtivoDoUsuario: async () => (m.semMarca ? null : { id: 7, cortesia: false, ultimoAcessoEm: new Date() }),
  briefingCompleto: async () => m.briefingOk,
  acessouHoje: () => true,
  registrarAcessoHoje: async () => undefined,
  preferenciasDoUsuario: async () => ({ aceitouTermosEm: m.termosEm, instaladoEm: null }),
}));
vi.mock("@/servicos/push", () => ({ aparelhosSemFalha: async () => [], pedidoDePushPodeAparecer: () => false }));
vi.mock("@/servicos/assinatura", () => ({
  marcaPrecisaAssinar: async (...args: unknown[]) => {
    m.precisaChamada(...args);
    return m.precisa;
  },
}));
vi.mock("../_casca/FolhaAceiteTermos", () => ({ FolhaAceiteTermos: () => null }));
vi.mock("../_casca/OuvinteInstalacao", () => ({ OuvinteInstalacao: () => null }));
vi.mock("../_casca/ReinscreverAviso", () => ({ ReinscreverAviso: () => null }));
vi.mock("@/ui/componentes/PedidoDeAviso", () => ({ PedidoDeAviso: () => null }));

const { default: LayoutCompleto } = await import("./layout");

beforeEach(() => {
  m.sessao = { user: { id: "u1", role: "cliente" }, verComo: null };
  m.precisa = false;
  m.semMarca = false;
  m.briefingOk = true;
  m.termosEm = new Date("2999-01-01");
  m.precisaChamada.mockClear();
});

describe("o portao no layout do painel", () => {
  it("marca que precisa assinar vai para /assinar", async () => {
    m.precisa = true;
    await expect(LayoutCompleto({ children: null })).rejects.toThrow("REDIRECT:/assinar");
  });

  it("marca que nao precisa segue para a tela pedida", async () => {
    await expect(LayoutCompleto({ children: null })).resolves.toBeTruthy();
    expect(m.precisaChamada).toHaveBeenCalledTimes(1);
  });

  it("o portao recebe a marca (o id e a cortesia vem do banco), nao um dado do navegador", async () => {
    await LayoutCompleto({ children: null });
    expect(m.precisaChamada.mock.calls[0][0]).toMatchObject({ id: 7, cortesia: false });
  });

  it("briefing incompleto vai para /comecar antes do portao (a pessoa conhece o produto antes de pagar)", async () => {
    m.briefingOk = false;
    m.precisa = true;
    await expect(LayoutCompleto({ children: null })).rejects.toThrow("REDIRECT:/comecar");
    expect(m.precisaChamada).not.toHaveBeenCalled();
  });

  it("termos nao aceitos mostram a folha de aceite antes do portao", async () => {
    m.termosEm = null;
    m.precisa = true;
    await expect(LayoutCompleto({ children: null })).resolves.toBeTruthy();
    expect(m.precisaChamada).not.toHaveBeenCalled();
  });

  it("no 'ver como' o admin nunca e barrado, mesmo que a marca precise assinar", async () => {
    m.sessao = { user: { id: "u1", role: "cliente" }, verComo: { entradaId: 1 } };
    m.precisa = true;
    await expect(LayoutCompleto({ children: null })).resolves.toBeTruthy();
    expect(m.precisaChamada).not.toHaveBeenCalled();
  });

  it("conta sem marca vai para a tela propria, nunca para /comecar nem /entrar (era o laco)", async () => {
    m.semMarca = true;
    await expect(LayoutCompleto({ children: null })).rejects.toThrow("REDIRECT:/sem-marca");
    expect(m.precisaChamada).not.toHaveBeenCalled();
  });

  it("admin sem marca vai para /admin, nunca para a tela de conta sem marca", async () => {
    m.sessao = { user: { id: "a1", role: "admin" }, verComo: null };
    m.semMarca = true;
    await expect(LayoutCompleto({ children: null })).rejects.toThrow("REDIRECT:/admin");
  });

  it("sem sessao vai para /entrar", async () => {
    m.sessao = null;
    await expect(LayoutCompleto({ children: null })).rejects.toThrow("REDIRECT:/entrar");
  });
});
