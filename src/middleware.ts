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
 * /api/versao tambem: devolve so o sha do commit em execucao, e o navegador a consulta para saber se a
 * pagina aberta e de uma versao anterior, inclusive depois que a sessao venceu (`src/lib/versao.ts`).
 * /termos e /privacidade sao publicas (etapa 12, decisao 7): quem ainda nao
 * assina precisa conseguir ler antes de entrar, e a folha de aceite linka
 * para elas de dentro do painel tambem. /dados e publica pelo mesmo motivo
 * (E6 parte 3, item 8): a configuracao do app da Meta pede uma URL de
 * instrucoes de exclusao de dados que qualquer um consiga abrir, sem sessao.
 * /redefinir-senha (E58) e o destino do link do e-mail de "esqueci a senha":
 * quem esqueceu a senha nao tem sessao.
 */
const ROTAS_PUBLICAS = ["/entrar", "/api/saude", "/api/versao", "/termos", "/privacidade", "/dados", "/redefinir-senha"];

/**
 * Rotas com autenticacao propria, sem cookie de sessao (etapa 6): o cabecalho
 * `x-jobs-key` faz esse papel para `/api/jobs/[nome]`, porque quem chama e o
 * cron, um servico externo ou uma Server Action do admin, nunca um navegador
 * logado. Achado rodando a etapa 6, parte 2, contra o servidor de verdade: os
 * testes chamam a funcao da rota direto, sem passar pelo middleware, entao
 * esse redirecionamento nunca tinha sido pego antes. `/api/webhooks/stripe` (E22 PR 1)
 * tambem: quem chama e o Stripe, sem cookie; a rota confere a assinatura do corpo com
 * `STRIPE_WEBHOOK_SECRET` antes de qualquer coisa. `/api/meta/exclusao` (E19 PR 1) tambem: quem chama e a Meta, sem cookie; a rota confere a assinatura do
 * `signed_request` com o segredo do aplicativo. `/api/publicar-arquivo` (E19b) tambem: quem baixa o video e a Meta, sem cookie; a rota confere o codigo assinado do endereco, o prazo e se a publicacao ainda esta viva. Ja `/api/meta/conectar` e `/api/meta/retorno` NAO entram aqui: sao da pessoa logada, e sem cookie de sessao vao para `/entrar`.
 */
const ROTAS_COM_AUTENTICACAO_PROPRIA = ["/api/jobs", "/api/webhooks/stripe", "/api/meta/exclusao", "/api/publicar-arquivo"];

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

/**
 * `/` (E57a): a pagina de vendas e de captura ("Quero testar"). So a raiz EXATA e publica; `startsWith("/")` em `ROTAS_PUBLICAS` abriria o aplicativo inteiro, entao a raiz tem a
 * checagem propria. Quem ja esta com sessao e levado ao painel pela propria pagina (`src/app/page.tsx`). A Server Action do formulario chega por POST nesta mesma raiz.
 */
function ehPaginaDeEntrada(pathname: string): boolean {
  return pathname === "/";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    ehPaginaDeEntrada(pathname) ||
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

/**
 * `api/publicar/` (E56 PR 1) tambem fica de fora, por outro motivo: o corpo do pedido de la e o VIDEO (ate 300 MB). Quando o middleware roda, o Next.js clona o corpo para ele e, passando de
 * 10 MB (`experimental.middlewareClientMaxBodySize`), entrega a rota so os primeiros 10 MB, truncando o video em silencio; e o clone guardaria o video inteiro na memoria. A rota confere a
 * sessao inteira sozinha (`sessaoAtual`, 401 sem ela), entao nada fica aberto: o cookie so servia para o redirecionamento a `/entrar`, que numa rota de API nem faz sentido.
 *
 * Lista explicita dos arquivos estaticos, nunca exclusao por formato (achado
 * de seguranca em producao, 20/09/2026): a V5 (item 3) trocou por um tempo
 * para "qualquer caminho cujo ultimo segmento tenha um ponto", pensando em
 * `favicon.ico`, `/marca/*.svg` e `/manifest.webmanifest`, mas isso tambem
 * casava com `/admin/clientes/1.0`, um id de cliente com uma falsa extensao
 * ".0" (`Number("1.0")` e 1). Com essa exclusao, o pedido nunca passava pelo
 * middleware, e a unica barreira sobrando era o layout do admin, que nao
 * bastava sozinho (o App Router roda layout e pagina em paralelo; ver
 * `exigirAdmin` em `src/lib/sessao.ts`). Lista fixa: cresce quando um arquivo
 * novo entrar em `public/`, nunca por formato.
 */
export const config = {
  matcher: [
    "/((?!api/auth|api/publicar/|_next/static|_next/image|favicon\\.ico|favicon\\.svg|favicon-16\\.png|favicon-32\\.png|favicon-48\\.png|apple-touch-icon\\.png|icone-192\\.png|icone-512\\.png|icone-maskable-512\\.png|manifest\\.webmanifest|sw\\.js|offline\\.html|marca/).*)",
  ],
};
