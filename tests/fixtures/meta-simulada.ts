/**
 * A Meta simulada para o e2e e para as capturas da ligação do Instagram (E19 PR 2): um servidor HTTP local que faz o papel do diálogo de autorização e da Graph API. O aplicativo só
 * fala com ele quando sobe com `MODO_E2E=1` e `META_SIMULADOR_E2E=http://127.0.0.1:<porta>` (`config.metaConexao.simuladorE2E`, `lib/meta-oauth.ts`); em qualquer outro caso as
 * chamadas vão à Meta de verdade, e nenhum teste desta suíte chega nela.
 *
 * E19b: o mesmo servidor também faz o papel do Login do Instagram: o diálogo em `/instagram/oauth/authorize`, a troca do código em `/instagram/api/oauth/access_token` (o `api.instagram.com`) e o
 * `graph.instagram.com` em `/graph-ig/...` (troca para longa duração, renovação, `/me`, publicação). Na publicação pela via do Instagram o simulador BAIXA o `video_url` que recebe (como a Meta
 * faz) e guarda o status e os bytes, para o teste provar que o endereço público funciona.
 *
 * O cenário muda de um teste para outro (`meta.cenario = {...}`); `meta.chamadas` guarda o que o aplicativo pediu, para o teste conferir o que foi e o que NÃO foi enviado.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const TOKEN_CURTO_SIMULADO = "EAA-CURTO-E2E-NAO-E-REAL";
export const TOKEN_LONGO_SIMULADO = "EAA-LONGO-E2E-NAO-E-REAL";
export const CODIGO_SIMULADO = "codigo-simulado-e2e";

const TODAS_AS_PERMISSOES_INSTAGRAM = ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"];
const TODAS_AS_PERMISSOES = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "instagram_content_publish", "public_profile"];

export type ContaSimulada = { paginaId: string; paginaNome: string; igId: string; username: string };

export type CenarioMeta = {
  /** O que a pessoa faz no diálogo da Meta: libera (padrão) ou cancela. */
  dialogo?: "autorizar" | "cancelar";
  /** As contas do Instagram das Páginas liberadas. Padrão: uma só. */
  contas?: ContaSimulada[];
  /** As permissões que ela liberou. Padrão: todas. */
  permissoesLiberadas?: string[];
  /** E19b: o `account_type` que o `/me` do Login do Instagram devolve (padrão BUSINESS). */
  tipoDeConta?: string;
  /** Responde com erro da Graph API em uma etapa. */
  erroEm?: "codigo" | "longo" | "usuario" | "permissoes" | "contas";
  /** E56 PR 1: a publicação. Os `status_code` que o contêiner devolve, um por pergunta (o último se repete); padrão: FINISHED. */
  statusDoContainer?: string[];
  /** Erro ao criar o contêiner ou ao enviar o vídeo (a Meta recusa o formato, por exemplo). */
  erroNaPublicacao?: "container" | "envio";
  /** O endereço da mídia publicada. */
  permalink?: string;
  /** Quanto o servidor de envio demora a responder (só para as capturas pararem na tela de "enviando"). */
  demoraNoEnvioMs?: number;
};

export type ChamadaSimulada = { caminho: string; parametros: Record<string, string>; metodo?: string; bytes?: number; cabecalhos?: Record<string, string> };

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

  /** O corpo do pedido, lido até o fim (o envio de vídeo pode ser grande; o simulador só conta os bytes). */
  async function lerCorpo(req: IncomingMessage): Promise<Buffer> {
    const pedacos: Buffer[] = [];
    for await (const pedaco of req) pedacos.push(pedaco as Buffer);
    return Buffer.concat(pedacos);
  }

  async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${porta}`);
    const parametros = Object.fromEntries(url.searchParams);
    const c = meta.cenario;

    // E56 PR 1: o envio de vídeo (rupload) e os passos da publicação.
    if (url.pathname.startsWith("/rupload/")) {
      const corpo = await lerCorpo(req);
      meta.chamadas.push({ caminho: url.pathname, parametros: { offset: String(req.headers.offset ?? ""), file_size: String(req.headers.file_size ?? "") }, metodo: req.method, bytes: corpo.byteLength });
      if (c.demoraNoEnvioMs) await new Promise((resolver) => setTimeout(resolver, c.demoraNoEnvioMs));
      if (c.erroNaPublicacao === "envio") return json(res, { debug_info: { retriable: false, type: "ProcessingFailedError", message: JSON.stringify({ success: false, error: { message: "formato", code: 352 } }) } }, 400);
      return json(res, { success: true, message: "Upload successful." });
    }
    // E19b: a troca do código do Login do Instagram (o `api.instagram.com`): POST de formulário, resposta direta.
    if (req.method === "POST" && url.pathname === "/instagram/api/oauth/access_token") {
      const dados = Object.fromEntries(new URLSearchParams((await lerCorpo(req)).toString("utf8")));
      // O segredo do aplicativo nunca é gravado como dado da chamada; o teste confere que ele FOI enviado pela marca `segredoEnviado`.
      const segredoEnviado = dados.client_secret ? "sim" : "nao";
      delete dados.client_secret;
      meta.chamadas.push({ caminho: url.pathname, parametros: { ...dados, segredoEnviado }, metodo: "POST" });
      if (c.erroEm === "codigo") return json(res, { error_type: "OAuthException", code: 400, error_message: "Matching code was not found or was already used" }, 400);
      return json(res, { access_token: TOKEN_CURTO_SIMULADO, user_id: "ig-escopo-e2e", permissions: c.permissoesLiberadas ?? TODAS_AS_PERMISSOES_INSTAGRAM });
    }
    if (req.method === "POST" && (url.pathname.startsWith("/graph/") || url.pathname.startsWith("/graph-ig/"))) {
      const corpo = new URLSearchParams((await lerCorpo(req)).toString("utf8"));
      const dados = Object.fromEntries(corpo);
      // O acesso de quem pede nunca é gravado como dado da chamada (o teste confere o que foi pedido, não o segredo).
      const acessoRecebido = dados.access_token ? "sim" : "nao";
      delete dados.access_token;
      delete dados.appsecret_proof;
      const viaInstagram = url.pathname.startsWith("/graph-ig/");
      meta.chamadas.push({ caminho: url.pathname, parametros: { ...dados, ...(viaInstagram ? { acessoRecebido } : {}) }, metodo: "POST" });
      if (url.pathname.endsWith("/media")) {
        if (c.erroNaPublicacao === "container") return json(res, { error: { message: "erro simulado", code: 100, error_subcode: 2207032 } }, 400);
        if (viaInstagram && c.erroNaPublicacao === "envio") return json(res, { error: { message: "nao foi possivel baixar o video", code: 100, error_subcode: 2207052 } }, 400);
        if (viaInstagram && dados.video_url) {
          // Como a Meta: baixa o vídeo do endereço público, sem cookie nenhum, e guarda o que veio.
          const baixado = await fetch(dados.video_url);
          const bytes = Buffer.from(await baixado.arrayBuffer());
          meta.chamadas.push({ caminho: "video_url", parametros: { status: String(baixado.status), tipo: baixado.headers.get("content-type") ?? "" }, bytes: bytes.byteLength });
          if (!baixado.ok) return json(res, { error: { message: "nao foi possivel baixar o video", code: 100, error_subcode: 2207052 } }, 400);
        }
        return json(res, { id: "container-simulado-1", uri: `http://127.0.0.1:${porta}/rupload/container-simulado-1` });
      }
      if (url.pathname.endsWith("/media_publish")) return json(res, { id: "midia-simulada-1" });
      return json(res, { error: { message: "caminho desconhecido do simulador", code: 100 } }, 404);
    }
    meta.chamadas.push({ caminho: url.pathname, parametros, metodo: req.method });
    if (url.pathname.endsWith("/content_publishing_limit")) return json(res, { data: [{ quota_usage: 1, config: { quota_total: 50, quota_duration: 86400 } }] });
    if (parametros.fields === "status_code") {
      const lista = c.statusDoContainer ?? ["FINISHED"];
      // Quantas vezes o contêiner já foi perguntado neste teste (a chamada de agora já está na lista).
      const perguntas = meta.chamadas.filter((x) => x.parametros.fields === "status_code").length - 1;
      const status = lista[Math.min(perguntas, lista.length - 1)];
      return json(res, { status_code: status, id: url.pathname });
    }
    if (parametros.fields === "permalink") return json(res, { permalink: c.permalink ?? "https://www.instagram.com/reel/SIMULADOe2e/", id: url.pathname });

    if (url.pathname === "/dialog/oauth" || url.pathname === "/instagram/oauth/authorize") {
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

    // E19b: o `graph.instagram.com` (troca para longa duração, renovação, `/me`).
    if (url.pathname.startsWith("/graph-ig/")) {
      const passo = url.pathname.replace(/^\/graph-ig\//, "");
      const etapaIg = passo === "access_token" ? "longo" : passo === "refresh_access_token" ? "renovacao" : passo === "me" ? "usuario" : null;
      if (etapaIg === null) return json(res, { error: { message: "caminho desconhecido do simulador", code: 100 } }, 404);
      if (c.erroEm === etapaIg) return json(res, { error: { message: `erro simulado em ${etapaIg}`, code: 190 } }, 400);
      if (etapaIg === "longo" || etapaIg === "renovacao") return json(res, { access_token: TOKEN_LONGO_SIMULADO, token_type: "bearer", expires_in: 5183944 });
      const conta = (c.contas ?? [CONTA_PADRAO])[0];
      return json(res, { user_id: conta.igId, username: conta.username, account_type: c.tipoDeConta ?? "BUSINESS", id: "ig-escopo-e2e" });
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

  const servidor: Server = createServer((req, res) => {
    tratar(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
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
