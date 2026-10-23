/**
 * E22 PR 2, item 0a: o portão da cobrança fora do layout. Com tudo simulado (sem banco): desligado não lê nada; ligado, a marca que precisa assinar é levada para /assinar (ação) ou
 * recebe 402 (rota); cortesia, assinatura que vale, "ver como" e briefing incompleto (nas ações do onboarding) passam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string }; verComo: object | null },
  cliente: { id: 7, cortesia: false } as null | { id: number; cortesia: boolean },
  precisa: true,
  briefingOk: true,
  chamadas: { sessao: vi.fn(), cliente: vi.fn(), briefing: vi.fn(), portao: vi.fn() },
  ativa: true,
}));

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));
vi.mock("@/lib/config", () => ({
  config: {
    cobranca: {
      get ativa() {
        return m.ativa;
      },
    },
  },
}));
vi.mock("@/lib/ver-como", () => ({
  sessaoDoPainel: async () => {
    m.chamadas.sessao();
    return m.sessao;
  },
}));
vi.mock("@/servicos/clientes", () => ({
  clienteAtivoDoUsuario: async () => {
    m.chamadas.cliente();
    return m.cliente;
  },
  briefingCompleto: async () => {
    m.chamadas.briefing();
    return m.briefingOk;
  },
}));
vi.mock("@/servicos/assinatura", () => ({
  marcaPrecisaAssinar: async (...args: unknown[]) => {
    m.chamadas.portao(...args);
    return m.precisa;
  },
}));

const { exigirAssinaturaValida, marcaBarradaPelaCobranca, recusaDaCobranca, FRASE_ASSINATURA_NECESSARIA } = await import("./portao-cobranca");

beforeEach(() => {
  m.ativa = true;
  m.sessao = { user: { id: "u1" }, verComo: null };
  m.cliente = { id: 7, cortesia: false };
  m.precisa = true;
  m.briefingOk = true;
  for (const f of Object.values(m.chamadas)) f.mockClear();
});

describe("cobrança desligada: nada muda para ninguém", () => {
  it("não lê sessão, marca nem banco, e nem a ação nem a rota barram", async () => {
    m.ativa = false;
    await expect(exigirAssinaturaValida()).resolves.toBeUndefined();
    await expect(exigirAssinaturaValida({ soDepoisDoBriefing: true })).resolves.toBeUndefined();
    expect(await recusaDaCobranca()).toBeNull();
    expect(m.chamadas.sessao).not.toHaveBeenCalled();
    expect(m.chamadas.cliente).not.toHaveBeenCalled();
    expect(m.chamadas.briefing).not.toHaveBeenCalled();
    expect(m.chamadas.portao).not.toHaveBeenCalled();
  });
});

describe("cobrança ligada", () => {
  it("a ação da marca sem assinatura leva para /assinar", async () => {
    await expect(exigirAssinaturaValida()).rejects.toThrow("REDIRECT:/assinar");
  });

  it("a rota da marca sem assinatura recebe 402 com a frase, sem guardar em cache", async () => {
    const r = await recusaDaCobranca();
    expect(r?.status).toBe(402);
    expect(await r?.json()).toEqual({ erro: FRASE_ASSINATURA_NECESSARIA });
    expect(r?.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("marca que não precisa assinar (cortesia ou assinatura que vale) segue", async () => {
    m.precisa = false;
    await expect(exigirAssinaturaValida()).resolves.toBeUndefined();
    expect(await recusaDaCobranca()).toBeNull();
  });

  it("o portão recebe a marca lida do banco e a cobrança ligada, não um dado do navegador", async () => {
    await marcaBarradaPelaCobranca();
    expect(m.chamadas.portao.mock.calls[0][0]).toMatchObject({ id: 7, cortesia: false });
    expect(m.chamadas.portao.mock.calls[0][2]).toBe(true);
  });

  it("no 'ver como' o admin nunca é barrado", async () => {
    m.sessao = { user: { id: "u1" }, verComo: { entradaId: 1 } };
    await expect(exigirAssinaturaValida()).resolves.toBeUndefined();
    expect(await recusaDaCobranca()).toBeNull();
    expect(m.chamadas.portao).not.toHaveBeenCalled();
  });

  it("sem sessão ou sem marca, quem responde é a própria ação ou rota (o portão não barra)", async () => {
    m.sessao = null;
    await expect(exigirAssinaturaValida()).resolves.toBeUndefined();
    m.sessao = { user: { id: "u1" }, verComo: null };
    m.cliente = null;
    await expect(exigirAssinaturaValida()).resolves.toBeUndefined();
    expect(m.chamadas.portao).not.toHaveBeenCalled();
  });

  it("soDepoisDoBriefing: com o briefing incompleto o onboarding segue livre; completo, é barrado como o layout faz", async () => {
    m.briefingOk = false;
    await expect(exigirAssinaturaValida({ soDepoisDoBriefing: true })).resolves.toBeUndefined();
    expect(await recusaDaCobranca({ soDepoisDoBriefing: true })).toBeNull();
    expect(m.chamadas.portao).not.toHaveBeenCalled();
    m.briefingOk = true;
    await expect(exigirAssinaturaValida({ soDepoisDoBriefing: true })).rejects.toThrow("REDIRECT:/assinar");
  });

  it("sem soDepoisDoBriefing o briefing nem é consultado (as ações do painel completo são barradas sempre)", async () => {
    m.briefingOk = false;
    await expect(exigirAssinaturaValida()).rejects.toThrow("REDIRECT:/assinar");
    expect(m.chamadas.briefing).not.toHaveBeenCalled();
  });
});
