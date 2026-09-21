import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "./auth";

/** Sessao com dado de verdade (banco), para usar em Server Components e rotas. */
export async function sessaoAtual() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Sessao de administrador, ou redireciona. Chamada na primeira linha do
 * layout do admin e de cada `page.tsx` de `src/app/admin/`: no App Router o
 * layout e a pagina rodam em paralelo, entao o `redirect()` do layout sozinho
 * nao impede a pagina de ja ter consultado o banco e devolvido o dado no
 * corpo da resposta, mesmo com o status 307 (achado em producao, 20/09/2026).
 * `cache` do React faz as duas chamadas do mesmo pedido lerem a sessao uma
 * vez so.
 */
export const exigirAdmin = cache(async function exigirAdmin() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }
  if (sessao.user.role !== "admin") {
    redirect("/hoje");
  }
  return sessao;
});
