import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * So confere se existe cookie de sessao (rapido, sem consulta ao banco, roda
 * no edge). Quem entra sem sessao volta para /entrar. O papel (admin ou
 * cliente) e o briefing completo dependem do banco, entao essas checagens
 * ficam nos layouts de servidor (src/app/admin/layout.tsx e
 * src/app/(painel)/(completo)/layout.tsx), que rodam no runtime Node e podem
 * consultar de verdade.
 */
const ROTAS_PUBLICAS = ["/entrar"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (ROTAS_PUBLICAS.some((rota) => pathname.startsWith(rota))) {
    return NextResponse.next();
  }

  if (!getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
