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

import { config, middleware } from "./middleware";

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

  it("/dados passa sem cookie de sessao (rota publica, exclusao de dados da Meta, E6 parte 3, item 8)", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null);
    expect(foiRedirecionada(middleware(requisicao("/dados")))).toBe(false);
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

  /**
   * O `matcher` decide quais pedidos chegam ate a funcao `middleware` (o
   * Next.js confere isto antes de rodar o codigo acima); testar a funcao nao
   * basta. Achado de seguranca, 20/09/2026: a exclusao antiga por formato
   * (`.*\.\w+$`) tratava `/admin/clientes/1.0` como se fosse um arquivo com
   * extensao ".0", e esse pedido nunca chegava ao middleware.
   */
  describe("matcher (lista explicita de arquivo estatico, nao exclusao por formato)", () => {
    const regexDoMatcher = new RegExp(`^${config.matcher[0]}$`);

    function passaPeloMiddleware(pathname: string): boolean {
      return regexDoMatcher.test(pathname);
    }

    it("um id de cliente com falsa extensao (1.0) continua passando pelo middleware", () => {
      expect(passaPeloMiddleware("/admin/clientes/1.0")).toBe(true);
      expect(passaPeloMiddleware("/admin/geracoes/1.0")).toBe(true);
    });

    it("uma tela comum continua passando pelo middleware", () => {
      expect(passaPeloMiddleware("/hoje")).toBe(true);
      expect(passaPeloMiddleware("/roteiros/42")).toBe(true);
    });

    it("os arquivos estaticos da lista explicita ficam de fora do middleware", () => {
      expect(passaPeloMiddleware("/favicon.ico")).toBe(false);
      expect(passaPeloMiddleware("/favicon.svg")).toBe(false);
      expect(passaPeloMiddleware("/favicon-16.png")).toBe(false);
      expect(passaPeloMiddleware("/favicon-32.png")).toBe(false);
      expect(passaPeloMiddleware("/favicon-48.png")).toBe(false);
      expect(passaPeloMiddleware("/apple-touch-icon.png")).toBe(false);
      expect(passaPeloMiddleware("/icone-192.png")).toBe(false);
      expect(passaPeloMiddleware("/icone-512.png")).toBe(false);
      expect(passaPeloMiddleware("/icone-maskable-512.png")).toBe(false);
      expect(passaPeloMiddleware("/manifest.webmanifest")).toBe(false);
      expect(passaPeloMiddleware("/marca/klaki-logotipo.svg")).toBe(false);
    });

    /**
     * V7, itens 6 e 8: o service worker e a pagina "Sem conexao" sao estaticos
     * de `public/` sem dado de ninguem; o navegador busca o `sw.js` sem
     * cookie em algumas atualizacoes, e a pagina offline tem de abrir para
     * quem ja perdeu a sessao. Entram na lista pelo nome, nunca por formato.
     */
    it("o service worker e a pagina offline ficam de fora do middleware", () => {
      expect(passaPeloMiddleware("/sw.js")).toBe(false);
      expect(passaPeloMiddleware("/offline.html")).toBe(false);
    });

    it("um caminho parecido (formato .js ou .html qualquer) continua passando pelo middleware", () => {
      expect(passaPeloMiddleware("/admin/outro.js")).toBe(true);
      expect(passaPeloMiddleware("/admin/pagina.html")).toBe(true);
      expect(passaPeloMiddleware("/roteiros/42.html")).toBe(true);
    });

    it("_next/static, _next/image e api/auth continuam de fora", () => {
      expect(passaPeloMiddleware("/_next/static/chunk.js")).toBe(false);
      expect(passaPeloMiddleware("/_next/image/foo")).toBe(false);
      expect(passaPeloMiddleware("/api/auth/session")).toBe(false);
    });
  });
});
