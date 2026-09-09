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
/**
 * /api/saude e publica de proposito (etapa 13): healthcheck do Compose,
 * deploy e monitor externo batem nela sem sessao; nao devolve dado.
 * /termos e /privacidade sao publicas (etapa 12, decisao 7): quem ainda nao
 * assina precisa conseguir ler antes de entrar, e a folha de aceite linka
 * para elas de dentro do painel tambem. /dados e publica pelo mesmo motivo
 * (E6 parte 3, item 8): a configuracao do app da Meta pede uma URL de
 * instrucoes de exclusao de dados que qualquer um consiga abrir, sem sessao.
 */
const ROTAS_PUBLICAS = ["/entrar", "/api/saude", "/termos", "/privacidade", "/dados"];

/**
 * Rotas com autenticacao propria, sem cookie de sessao (etapa 6): o cabecalho
 * `x-jobs-key` faz esse papel para `/api/jobs/[nome]`, porque quem chama e o
 * cron, um servico externo ou uma Server Action do admin, nunca um navegador
 * logado. Achado rodando a etapa 6, parte 2, contra o servidor de verdade: os
 * testes chamam a funcao da rota direto, sem passar pelo middleware, entao
 * esse redirecionamento nunca tinha sido pego antes.
 */
const ROTAS_COM_AUTENTICACAO_PROPRIA = ["/api/jobs"];

/**
 * `/roteiros/[id]/imprimir` (roteiro em PDF, `PROXIMO.md`, acabamento do
 * iPad, item 5): quem abre essa pagina e o Playwright de dentro da propria
 * rota `/api/roteiros/[id]/pdf`, sem cookie de sessao nenhum; a pagina se
 * autentica sozinha com o token de `tokenImpressao.ts`. Sem esta excecao, o
 * middleware redirecionava para `/entrar` antes da pagina rodar, e o PDF
 * saia com a tela de login em vez do roteiro (achado gerando a primeira
 * captura de verdade, nao no e2e, que so confere o arquivo nao vazio).
 */
function ehImpressaoDeRoteiro(pathname: string): boolean {
  return pathname.startsWith("/roteiros/") && pathname.endsWith("/imprimir");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    ROTAS_PUBLICAS.some((rota) => pathname.startsWith(rota)) ||
    ROTAS_COM_AUTENTICACAO_PROPRIA.some((rota) => pathname.startsWith(rota)) ||
    ehImpressaoDeRoteiro(pathname)
  ) {
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
