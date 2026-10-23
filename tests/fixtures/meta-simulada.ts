/**
 * A Meta simulada para o e2e e para as capturas da ligação do Instagram (E19 PR 2): um servidor HTTP local que faz o papel do diálogo de autorização e da Graph API. O aplicativo só
 * fala com ele quando sobe com `MODO_E2E=1` e `META_SIMULADOR_E2E=http://127.0.0.1:<porta>` (`config.metaConexao.simuladorE2E`, `lib/meta-oauth.ts`); em qualquer outro caso as
 * chamadas vão à Meta de verdade, e nenhum teste desta suíte chega nela.
 *
 * O cenário muda de um teste para outro (`meta.cenario = {...}`); `meta.chamadas` guarda o que o aplicativo pediu, para o teste conferir o que foi e o que NÃO foi enviado.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const TOKEN_CURTO_SIMULADO = "EAA-CURTO-E2E-NAO-E-REAL";
export const TOKEN_LONGO_SIMULADO = "EAA-LONGO-E2E-NAO-E-REAL";
export const CODIGO_SIMULADO = "codigo-simulado-e2e";

const TODAS_AS_PERMISSOES = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "public_profile"];

export type ContaSimulada = { paginaId: string; paginaNome: string; igId: string; username: string };

export type CenarioMeta = {
  /** O que a pessoa faz no diálogo da Meta: libera (padrão) ou cancela. */
  dialogo?: "autorizar" | "cancelar";
  /** As contas do Instagram das Páginas liberadas. Padrão: uma só. */
  contas?: ContaSimulada[];
  /** As permissões que ela liberou. Padrão: todas. */
  permissoesLiberadas?: string[];
  /** Responde com erro da Graph API em uma etapa. */
  erroEm?: "codigo" | "longo" | "usuario" | "permissoes" | "contas";
};

export type ChamadaSimulada = { caminho: string; parametros: Record<string, string> };

export type MetaSimulada = {
  cenario: CenarioMeta;
  chamadas: ChamadaSimulada[];
  porta: number;
  fechar: () => Promise<void>;
};

export const CONTA_PADRAO: ContaSimulada = { paginaId: "pagina-e2e-1", paginaNome: "Casa em Ordem E2E", igId: "17841400000000101", username: "casa.em.ordem.e2e" };

function json(res: ServerResponse, corpo: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

export async function iniciarMetaSimulada(porta: number): Promise<MetaSimulada> {
  const meta: MetaSimulada = { cenario: {}, chamadas: [], porta, fechar: async () => undefined };

  function tratar(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${porta}`);
    const parametros = Object.fromEntries(url.searchParams);
    meta.chamadas.push({ caminho: url.pathname, parametros });
    const c = meta.cenario;

    if (url.pathname === "/dialog/oauth") {
      const volta = new URL(parametros.redirect_uri);
      if (c.dialogo === "cancelar") {
        volta.searchParams.set("error", "access_denied");
        volta.searchParams.set("error_reason", "user_denied");
      } else {
        volta.searchParams.set("code", CODIGO_SIMULADO);
      }
      volta.searchParams.set("state", parametros.state);
      res.writeHead(302, { location: volta.toString() });
      res.end();
      return;
    }

    const caminho = url.pathname.replace(/^\/graph\//, "");
    const etapa =
      caminho === "oauth/access_token"
        ? parametros.grant_type === "fb_exchange_token"
          ? "longo"
          : "codigo"
        : caminho === "me"
          ? "usuario"
          : caminho === "me/permissions"
            ? "permissoes"
            : caminho === "me/accounts"
              ? "contas"
              : null;
    if (!url.pathname.startsWith("/graph/") || etapa === null) return json(res, { error: { message: "caminho desconhecido do simulador", code: 100 } }, 404);
    if (c.erroEm === etapa) return json(res, { error: { message: `erro simulado em ${etapa}`, code: 1 } }, 400);

    if (etapa === "codigo") return json(res, { access_token: TOKEN_CURTO_SIMULADO, token_type: "bearer", expires_in: 3600 });
    if (etapa === "longo") return json(res, { access_token: TOKEN_LONGO_SIMULADO, token_type: "bearer", expires_in: 5183944 });
    if (etapa === "usuario") return json(res, { id: "meta-pessoa-e2e" });
    if (etapa === "permissoes") return json(res, { data: (c.permissoesLiberadas ?? TODAS_AS_PERMISSOES).map((permission) => ({ permission, status: "granted" })) });
    const contas = c.contas ?? [CONTA_PADRAO];
    return json(res, { data: contas.map((x) => ({ id: x.paginaId, name: x.paginaNome, instagram_business_account: { id: x.igId, username: x.username } })) });
  }

  const servidor: Server = createServer(tratar);
  await new Promise<void>((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(porta, "127.0.0.1", () => resolver());
  });
  meta.fechar = () =>
    new Promise<void>((resolver) => {
      servidor.closeAllConnections();
      servidor.close(() => resolver());
    });
  return meta;
}
