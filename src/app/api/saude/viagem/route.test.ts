import { beforeEach, describe, expect, it, vi } from "vitest";

const sessaoAtual = vi.fn();
const saudeDaViagem = vi.fn();
vi.mock("@/lib/sessao", () => ({ sessaoAtual: () => sessaoAtual() }));
vi.mock("@/servicos/admin-acompanhamento", () => ({ saudeDaViagem: () => saudeDaViagem() }));

import { GET } from "./route";

describe("GET /api/saude/viagem (T100, M2)", () => {
  beforeEach(() => {
    sessaoAtual.mockReset();
    saudeDaViagem.mockReset().mockResolvedValue({ ok: true, marcasAtivas: 2 });
  });

  it("sem sessao: 401 e nao consulta o banco", async () => {
    sessaoAtual.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(saudeDaViagem).not.toHaveBeenCalled();
  });

  it("sessao de cliente: 403 e nao consulta o banco", async () => {
    sessaoAtual.mockResolvedValue({ user: { id: "u", role: "cliente" } });
    expect((await GET()).status).toBe(403);
    expect(saudeDaViagem).not.toHaveBeenCalled();
  });

  it("sessao de admin: 200 com a saude", async () => {
    sessaoAtual.mockResolvedValue({ user: { id: "a", role: "admin" } });
    const r = await GET();
    expect(r.status).toBe(200);
    expect((await r.json()).marcasAtivas).toBe(2);
  });
});
