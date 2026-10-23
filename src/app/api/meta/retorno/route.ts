import { NextResponse, type NextRequest } from "next/server";

import { config } from "@/lib/config";
import { NOME_COOKIE_STATE_META, opcoesCookieState } from "@/lib/meta-oauth";
import { sessaoAtual } from "@/lib/sessao";
import { modoVerComoLigado } from "@/lib/ver-como";
import { concluirLigacao } from "@/servicos/conta-conectada";

export const dynamic = "force-dynamic";

/**
 * E19 PR 1: a volta do diálogo da Meta (a URI cadastrada no aplicativo: `<APP_URL>/api/meta/retorno`). Recebe `code` e `state` (ou `error`, quando a pessoa cancelou). Quem confere tudo é
 * `concluirLigacao`: o `state` assinado, igual ao cookie deste navegador e dentro do prazo, a pessoa da sessão ser a que abriu o diálogo e ser dona da marca. O resultado vira um
 * código em `/conta?instagram=<código>` (a tela do PR 2 lê o código e mostra a frase). Nada do que a Meta mandou é repetido na resposta, e o cookie do `state` é apagado em qualquer caso.
 */
export async function GET(req: NextRequest) {
  const consulta = req.nextUrl.searchParams;
  const sessao = await sessaoAtual();
  // Sessão do "ver como" nunca termina uma ligação: a ligação é da pessoa, não de quem a está vendo.
  const usuarioId = sessao && !(await modoVerComoLigado()) ? sessao.user.id : null;

  const { resultado } = await concluirLigacao({
    codigo: consulta.get("code"),
    erroDaMeta: consulta.get("error"),
    state: consulta.get("state"),
    stateDoCookie: req.cookies.get(NOME_COOKIE_STATE_META)?.value ?? null,
    usuarioId,
  });

  const destino = new URL("/conta", config.appUrl);
  destino.searchParams.set("instagram", resultado);
  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set(NOME_COOKIE_STATE_META, "", { ...opcoesCookieState(), maxAge: 0 });
  resposta.headers.set("Cache-Control", "no-store");
  return resposta;
}
