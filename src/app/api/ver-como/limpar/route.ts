import { NextResponse, type NextRequest } from "next/server";

import { lerCookieVerComo, NOME_COOKIE_VER_COMO } from "@/lib/ver-como-cookie";
import { entradaAberta, registrarSaidaVerComo } from "@/servicos/ver-como";

/**
 * Apaga um cookie do "ver como" que sobrou (E46 PR 2, regra 2): o painel o ignora quando a sessão real não é de admin, quando expirou, quando está estragado ou quando a entrada
 * já foi fechada, e o layout manda para cá. Só apaga o cookie (e fecha a entrada do banco, se a assinatura é de verdade e ela ainda está aberta); nunca dá acesso a nada, então
 * não precisa de papel nenhum: com cookie forjado, apagar é tudo o que acontece. Idempotente.
 */
export async function GET(request: NextRequest) {
  const leitura = lerCookieVerComo(request.cookies.get(NOME_COOKIE_VER_COMO)?.value);
  if (leitura.estado === "expirado") {
    await registrarSaidaVerComo(leitura.carga.r, "expirou");
  } else if (leitura.estado === "valido") {
    // O cookie ainda vale, mas o painel o recusou: ou a hora gravada no banco passou, ou a sessão de admin acabou.
    const entrada = await entradaAberta(leitura.carga.r);
    await registrarSaidaVerComo(leitura.carga.r, entrada && entrada.expiraEm.getTime() <= Date.now() ? "expirou" : "sessao");
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  const resposta = NextResponse.redirect(url);
  resposta.cookies.delete(NOME_COOKIE_VER_COMO);
  return resposta;
}
