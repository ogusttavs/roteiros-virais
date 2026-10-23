/**
 * E19 PR 1: tudo que o produto faz com o Login do Facebook para Empresas (fluxo de código) fica aqui, sem banco e sem Next: montar o diálogo com `config_id` e `state` assinado,
 * conferir o `state` na volta, trocar o código pelo token, trocar o token curto pelo de longa duração, descobrir a conta do Instagram ligada às Páginas que a pessoa liberou, e
 * conferir o `signed_request` do aviso de exclusão de dados. Fontes (baixadas em `pesquisa/plataformas/docs/meta/`): `login-para-empresas.md` (o `config_id`, a permissão que a
 * pessoa libera), `login-fluxo-manual-codigo.md` (o diálogo, o `state`, a troca do código), `token-longa-duracao.md` (a troca para 60 dias), `instagram-login-facebook-comecar.md`
 * (as Páginas e `instagram_business_account`), `exclusao-de-dados-callback.md` (o `signed_request`) e `graph-requisicoes-seguras.md` (o `appsecret_proof`).
 *
 * O token NUNCA vai para log, para mensagem de erro ou para retorno de erro: o endereço das chamadas leva `access_token`/`client_secret` na query, então o endereço também nunca é
 * escrito em lugar nenhum. Nos testes o `fetch` é simulado; a chamada de verdade recusa rodar dentro do Vitest sem isso.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config";

/** A versão da Graph API que o resto do produto usa (`src/jobs/meta-api.ts`). */
export const VERSAO_GRAPH = "v26.0";
const GRAPH = `https://graph.facebook.com/${VERSAO_GRAPH}`;
const DIALOGO = `https://www.facebook.com/${VERSAO_GRAPH}/dialog/oauth`;

/** As permissões que a configuração de login precisa liberar. O código confere, depois do login, que a pessoa liberou todas (`login-para-empresas.md`: todas ou nenhuma). */
export const PERMISSOES_EXIGIDAS = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"] as const;

/** A pessoa tem dez minutos entre abrir o diálogo da Meta e voltar. */
export const VALIDADE_DO_STATE_MS = 10 * 60 * 1000;
export const NOME_COOKIE_STATE_META = "meta_conexao";

/** Falha de uma chamada à Meta. `codigo` e `subcodigo` são os da Graph API; a mensagem é a técnica, sem token e sem endereço. */
export class ErroMetaLogin extends Error {
  constructor(
    message: string,
    public readonly codigo?: number,
    public readonly subcodigo?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// O state assinado (contra CSRF)
// ---------------------------------------------------------------------------

export type CargaDoState = {
  /** A marca que vai receber a conta. */
  c: number;
  /** A pessoa que abriu o diálogo (o dono da marca). */
  u: string;
  /** Um valor sem repetição por tentativa. */
  n: string;
  /** Quando vence, em milissegundos desde 1970. */
  e: number;
};

function assinar(corpo: string): string {
  return createHmac("sha256", config.auth.secret).update(`meta-state:${corpo}`).digest("hex");
}

/** O valor que vai no `state` da Meta e, igual, no cookie. */
export function criarState(carga: Omit<CargaDoState, "n" | "e">, agora: Date = new Date()): string {
  const completa: CargaDoState = { ...carga, n: randomBytes(16).toString("base64url"), e: agora.getTime() + VALIDADE_DO_STATE_MS };
  const corpo = Buffer.from(JSON.stringify(completa), "utf8").toString("base64url");
  return `${corpo}.${assinar(corpo)}`;
}

export type LeituraDoState = { ok: true; carga: CargaDoState } | { ok: false; motivo: "ausente" | "invalido" | "expirado" | "diferente" };

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Confere o `state` que a Meta devolveu contra o cookie do navegador que abriu o diálogo: os dois precisam existir e ser idênticos (quem não abriu o diálogo neste navegador não tem
 * o cookie), a assinatura tem de bater e a hora não pode ter passado. Só depois de tudo isso o conteúdo é lido.
 */
export function lerState(doRetorno: string | null | undefined, doCookie: string | null | undefined, agora: Date = new Date()): LeituraDoState {
  if (!doRetorno || !doCookie) return { ok: false, motivo: "ausente" };
  if (!iguais(doRetorno, doCookie)) return { ok: false, motivo: "diferente" };
  const separador = doRetorno.lastIndexOf(".");
  if (separador === -1) return { ok: false, motivo: "invalido" };
  const corpo = doRetorno.slice(0, separador);
  if (!iguais(doRetorno.slice(separador + 1), assinar(corpo))) return { ok: false, motivo: "invalido" };
  try {
    const bruto = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Partial<CargaDoState>;
    if (!Number.isInteger(bruto.c) || typeof bruto.u !== "string" || typeof bruto.n !== "string" || typeof bruto.e !== "number") return { ok: false, motivo: "invalido" };
    const carga = { c: bruto.c as number, u: bruto.u, n: bruto.n, e: bruto.e };
    return carga.e <= agora.getTime() ? { ok: false, motivo: "expirado" } : { ok: true, carga };
  } catch {
    return { ok: false, motivo: "invalido" };
  }
}

export function opcoesCookieState() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/meta", maxAge: VALIDADE_DO_STATE_MS / 1000 };
}

/** O endereço do diálogo do Login para Empresas: `config_id` no lugar de `scope` (a configuração define as permissões), fluxo de código, e o `state`. */
export function urlDoDialogo(state: string): string {
  const url = new URL(DIALOGO);
  url.searchParams.set("client_id", config.metaConexao.appId);
  url.searchParams.set("redirect_uri", config.metaConexao.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("config_id", config.metaConexao.loginConfigId);
  url.searchParams.set("response_type", "code");
  // Com `config_id` o tipo padrão da resposta é o implícito; o código (que o servidor troca com o segredo do aplicativo) precisa ser pedido (`login-para-empresas.md`).
  url.searchParams.set("override_default_response_type", "true");
  return url.toString();
}

// ---------------------------------------------------------------------------
// A prova do segredo do aplicativo e o aviso de exclusão
// ---------------------------------------------------------------------------

/** `appsecret_proof` (`graph-requisicoes-seguras.md`): HMAC-SHA256 do token, com o segredo do aplicativo como chave. */
export function provaDoSegredo(token: string, segredo: string = config.metaConexao.appSecret): string {
  return createHmac("sha256", segredo).update(token).digest("hex");
}

export type CargaDaExclusao = { algorithm?: string; user_id?: string; issued_at?: number };

function decodificar(base64url: string): Buffer {
  return Buffer.from(base64url.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

/**
 * Confere o `signed_request` do aviso de exclusão de dados (`exclusao-de-dados-callback.md`): `<assinatura>.<carga>`, base64url, HMAC-SHA256 da carga com o segredo do aplicativo. Devolve
 * a carga só quando a assinatura bate e o algoritmo é o esperado; senão `null`.
 */
export function lerSignedRequest(valor: string | null | undefined, segredo: string = config.metaConexao.appSecret): CargaDaExclusao | null {
  if (!valor || !segredo) return null;
  const [assinaturaB64, carga, ...resto] = valor.split(".");
  if (!assinaturaB64 || !carga || resto.length > 0) return null;
  const recebida = decodificar(assinaturaB64);
  const esperada = createHmac("sha256", segredo).update(carga).digest();
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const dado = JSON.parse(decodificar(carga).toString("utf8")) as CargaDaExclusao;
    return dado.algorithm?.toUpperCase() === "HMAC-SHA256" && typeof dado.user_id === "string" && dado.user_id !== "" ? dado : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// As chamadas à Graph API
// ---------------------------------------------------------------------------

type ErroGraph = { message?: string; code?: number; error_subcode?: number };

/** Dentro do Vitest, só com `fetch` simulado: nenhum teste fala com a Meta de verdade. */
function conferirQueNaoEhRedeDeVerdade(): void {
  if (process.env.VITEST && !("mock" in (globalThis.fetch as unknown as object))) {
    throw new ErroMetaLogin("Dentro do Vitest o fetch precisa estar simulado: nenhum teste chama a Meta de verdade.");
  }
}

async function pedirGraph<T>(caminho: string, parametros: Record<string, string>, token?: string): Promise<T> {
  conferirQueNaoEhRedeDeVerdade();
  const url = new URL(`${GRAPH}/${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) url.searchParams.set(chave, valor);
  if (token) {
    url.searchParams.set("access_token", token);
    if (config.metaConexao.appSecret) url.searchParams.set("appsecret_proof", provaDoSegredo(token));
  }
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    // Sem a causa nem o endereço: o endereço leva token e segredo na query.
    throw new ErroMetaLogin("Nao foi possivel falar com a Meta (rede ou prazo).");
  }
  let corpo: ({ error?: ErroGraph } & Record<string, unknown>) | null = null;
  try {
    corpo = (await resposta.json()) as { error?: ErroGraph } & Record<string, unknown>;
  } catch {
    throw new ErroMetaLogin(`A Meta respondeu ${resposta.status} sem corpo em JSON.`, resposta.status);
  }
  if (!resposta.ok || corpo?.error) {
    const erro = corpo?.error ?? {};
    throw new ErroMetaLogin(erro.message ?? `A Meta respondeu ${resposta.status}.`, erro.code, erro.error_subcode);
  }
  return corpo as T;
}

export type TokenDaMeta = {
  token: string;
  /** Segundos até vencer, quando a Meta diz; `null` quando não diz. */
  expiraEmSeg: number | null;
};

function lerToken(corpo: { access_token?: unknown; expires_in?: unknown }): TokenDaMeta {
  if (typeof corpo.access_token !== "string" || corpo.access_token === "") throw new ErroMetaLogin("A Meta nao devolveu o token.");
  const expira = typeof corpo.expires_in === "number" && Number.isFinite(corpo.expires_in) && corpo.expires_in > 0 ? corpo.expires_in : null;
  return { token: corpo.access_token, expiraEmSeg: expira };
}

/** Troca o `code` do retorno pelo token do usuário (`login-fluxo-manual-codigo.md`, "Como trocar um código por um token de acesso"). A `redirect_uri` é a mesma do diálogo. */
export async function trocarCodigoPorToken(codigo: string): Promise<TokenDaMeta> {
  const { appId, appSecret, redirectUri } = config.metaConexao;
  return lerToken(await pedirGraph("oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code: codigo }));
}

/**
 * Troca um token de usuário válido pelo de longa duração, de uns 60 dias (`token-longa-duracao.md`). A mesma chamada, com um token de longa duração ainda válido, devolve um novo
 * (a renovação). Token vencido não troca: a pessoa precisa ligar de novo.
 */
export async function trocarPorLongaDuracao(token: string): Promise<TokenDaMeta> {
  const { appId, appSecret } = config.metaConexao;
  return lerToken(await pedirGraph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token }));
}

/** O id da pessoa no aplicativo (o que a Meta manda no aviso de exclusão). */
export async function usuarioDoToken(token: string): Promise<{ id: string }> {
  const corpo = await pedirGraph<{ id?: unknown }>("me", { fields: "id" }, token);
  if (typeof corpo.id !== "string" || corpo.id === "") throw new ErroMetaLogin("A Meta nao devolveu o id da pessoa.");
  return { id: corpo.id };
}

/** As permissões exigidas que a pessoa não liberou (`/me/permissions`, `login-fluxo-manual-codigo.md`). */
export async function permissoesQueFaltam(token: string): Promise<string[]> {
  const corpo = await pedirGraph<{ data?: { permission?: string; status?: string }[] }>("me/permissions", {}, token);
  const liberadas = new Set((corpo.data ?? []).filter((p) => p.status === "granted" && p.permission).map((p) => p.permission as string));
  return PERMISSOES_EXIGIDAS.filter((p) => !liberadas.has(p));
}

export type ContaDoInstagram = { paginaId: string; paginaNome: string | null; contaId: string; nome: string };

type PaginaGraph = { id?: string; name?: string; instagram_business_account?: { id?: string; username?: string; name?: string } };

/**
 * As contas profissionais do Instagram ligadas às Páginas que a pessoa liberou no diálogo (`/me/accounts` com `instagram_business_account`,
 * `instagram-login-facebook-comecar.md`, passos 4 e 5). Página sem Instagram ligado fica de fora. Segue a paginação da Meta, até dez páginas de resposta.
 */
export async function contasDoInstagram(token: string): Promise<ContaDoInstagram[]> {
  const achadas: ContaDoInstagram[] = [];
  let depois: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const corpo = await pedirGraph<{ data?: PaginaGraph[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      "me/accounts",
      { fields: "name,instagram_business_account{id,username,name}", limit: "50", ...(depois ? { after: depois } : {}) },
      token,
    );
    for (const pagina of corpo.data ?? []) {
      const ig = pagina.instagram_business_account;
      if (!pagina.id || !ig?.id) continue;
      achadas.push({ paginaId: pagina.id, paginaNome: pagina.name ?? null, contaId: ig.id, nome: ig.username ?? ig.name ?? ig.id });
    }
    depois = corpo.paging?.next ? corpo.paging.cursors?.after : undefined;
    if (!depois) break;
  }
  return achadas;
}
