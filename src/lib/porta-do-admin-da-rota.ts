/**
 * E69 PR A: a porta das rotas de API do admin (`src/app/api/admin/**`). Diferente de `exigirAdmin()` (que redireciona, certo para pagina), uma rota de API responde com status: com a chave `ILUSTRACAO_ATIVA`
 * desligada, 404 como se nao existisse (nem para o admin); sem sessao, 401; sessao que nao e de admin, 403. Toda funcao exportada de uma `route.ts` do admin chama `adminDaRota()` ANTES de qualquer outro
 * `await` (o `checar-admin-protegido` confere). O middleware ja barra quem nao tem cookie; o papel so o banco diz.
 */
import { NextResponse } from "next/server";

import { ilustracaoAtiva } from "@/config/carrossel";
import { sessaoAtual } from "@/lib/sessao";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

export function respostaDoAdmin(mensagem: string, status: number): NextResponse {
  return NextResponse.json({ erro: mensagem }, { status, headers: SEM_CACHE });
}

/** O admin da sessao, ou a resposta que a rota devolve sem fazer mais nada. */
export async function adminDaRota(): Promise<{ usuarioId: string } | NextResponse> {
  if (!ilustracaoAtiva()) return respostaDoAdmin("nao encontrado", 404);
  const sessao = await sessaoAtual();
  if (!sessao) return respostaDoAdmin("nao autenticado", 401);
  if (sessao.user.role !== "admin") return respostaDoAdmin("sem permissao", 403);
  return { usuarioId: sessao.user.id };
}
