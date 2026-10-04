import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const offline = vi.hoisted(() => ({ limpar: vi.fn(async () => undefined), registrar: vi.fn(async () => undefined) }));

vi.mock("next/navigation", () => ({ usePathname: () => "/hoje" }));
vi.mock("@/lib/offline", async () => {
  const real = await vi.importActual<typeof import("@/lib/offline")>("@/lib/offline");
  return { ...real, limparCachesDoAparelho: offline.limpar, registrarEscopo: offline.registrar };
});

import { Conexao } from "./Conexao";

describe("Conexao no ver como", () => {
  beforeEach(() => {
    offline.limpar.mockClear();
    offline.registrar.mockClear();
  });

  it("no modo, apaga o que o aparelho guardou e não registra escopo (nada da pessoa fica no aparelho do admin)", () => {
    render(
      <Conexao usuarioId="pessoa" marcaId={1} verComo>
        <p>painel</p>
      </Conexao>,
    );
    expect(offline.limpar).toHaveBeenCalledTimes(1);
    expect(offline.registrar).not.toHaveBeenCalled();
  });

  it("fora do modo, não apaga nada (em teste o registro do worker nem roda: só em produção)", () => {
    render(
      <Conexao usuarioId="pessoa" marcaId={1}>
        <p>painel</p>
      </Conexao>,
    );
    expect(offline.limpar).not.toHaveBeenCalled();
  });
});
