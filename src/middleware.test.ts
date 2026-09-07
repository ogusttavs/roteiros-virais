/**
 * Middleware de sessao (etapa 6, parte 2, achado rodando contra o servidor
 * de verdade): `/api/jobs/[nome]` tem autenticacao propria (`x-jobs-key`,
 * nunca cookie de sessao) e precisa passar direto pelo middleware, senao
 * toda chamada de fora (cron, admin, disparo manual) volta redirecionada
 * para `/entrar` em vez de chegar na rota. `getSessionCookie` mockado
 * porque o middleware so confere se ela existe, nao se e valida.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

/** `vi.mock` e hoisted pelo Vitest para o topo do arquivo, antes de todos os imports acima. */
vi.mock("better-auth/cookies", () => ({ getSessionCookie: vi.fn() }));

function requisicao(caminho: string): NextRequest {
  return new NextRequest(new URL(caminho, "http://localhost:3000"));
}

function foiRedirecionada(resposta: ReturnType<typeof middleware>): boolean {
  return resposta.headers.get("location") !== null;
}

describe("middleware", () => {
  it("/entrar passa sem cookie de sessao (rota publica)", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null);
    expect(foiRedirecionada(middleware(requisicao("/entrar")))).toBe(false);
  });

  it("/api/jobs/[nome] passa sem cookie de sessao (autenticacao propria por x-jobs-key)", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null);
    expect(foiRedirecionada(middleware(requisicao("/api/jobs/coleta-noticias")))).toBe(false);
  });

  it("uma rota protegida sem cookie de sessao redireciona para /entrar", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null);
    const resposta = middleware(requisicao("/admin/nichos"));
    expect(resposta.status).toBe(307);
    expect(new URL(resposta.headers.get("location")!).pathname).toBe("/entrar");
  });

  it("uma rota protegida com cookie de sessao passa direto", () => {
    vi.mocked(getSessionCookie).mockReturnValue("algum-token-de-sessao");
    expect(foiRedirecionada(middleware(requisicao("/admin/nichos")))).toBe(false);
  });

  describe("/roteiros/[id]/imprimir (roteiro em PDF, achado do primeiro uso no iPad, item 5)", () => {
    it("passa sem cookie de sessao (autenticacao propria pelo token de impressao)", () => {
      vi.mocked(getSessionCookie).mockReturnValue(null);
      expect(foiRedirecionada(middleware(requisicao("/roteiros/42/imprimir")))).toBe(false);
    });

    it("/roteiros/[id] (a tela de verdade) continua exigindo cookie de sessao", () => {
      vi.mocked(getSessionCookie).mockReturnValue(null);
      const resposta = middleware(requisicao("/roteiros/42"));
      expect(resposta.status).toBe(307);
      expect(new URL(resposta.headers.get("location")!).pathname).toBe("/entrar");
    });

    it("/roteiros/[id]/gravar continua exigindo cookie de sessao", () => {
      vi.mocked(getSessionCookie).mockReturnValue(null);
      const resposta = middleware(requisicao("/roteiros/42/gravar"));
      expect(resposta.status).toBe(307);
      expect(new URL(resposta.headers.get("location")!).pathname).toBe("/entrar");
    });
  });
});
