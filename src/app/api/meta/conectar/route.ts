import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { NOME_COOKIE_STATE_META, opcoesCookieState } from "@/lib/meta-oauth";
import { sessaoAtual } from "@/lib/sessao";
import { modoVerComoLigado } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { iniciarLigacao } from "@/servicos/conta-conectada";

export const dynamic = "force-dynamic";

function paraConta(codigo: string): NextResponse {
  const destino = new URL("/conta", config.appUrl);
  destino.searchParams.set("instagram", codigo);
  return NextResponse.redirect(destino);
}

/**
 * E19 PR 1: o começo da ligação do Instagram. A pessoa clica em "conectar" (PR 2), cai aqui, e daqui vai para o diálogo da Meta. Precisa de sessão (o `middleware.ts` já manda quem não
 * tem para `/entrar`), da sessão REAL e não do "ver como" (nunca liga em nome de outra pessoa), e de ser a dona da marca ativa. O `state` assinado vai na volta pela Meta e, igual, num
 * cookie deste navegador (`path=/api/meta`, só a rota de retorno o recebe): quem não abriu o diálogo aqui não consegue terminar a ligação.
 */
export async function GET() {
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.redirect(new URL("/entrar", config.appUrl));
  if (await modoVerComoLigado()) return paraConta("sem-acesso");

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.redirect(new URL("/hoje", config.appUrl));

  const inicio = await iniciarLigacao(sessao.user.id, cliente.id);
  if ("recusa" in inicio) return paraConta(inicio.recusa);

  const resposta = NextResponse.redirect(inicio.url);
  resposta.cookies.set(NOME_COOKIE_STATE_META, inicio.state, opcoesCookieState());
  // Nada de cache: o endereço leva um `state` que vale uma vez.
  resposta.headers.set("Cache-Control", "no-store");
  return resposta;
}
