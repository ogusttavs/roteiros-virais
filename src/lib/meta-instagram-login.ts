/**
 * E19b: tudo que o produto faz com o Login do Instagram ("Login de Empresa no Instagram", API do Instagram com o Login do Instagram) fica aqui, sem banco e sem Next: montar o endereço de
 * autorizar, trocar o código pelo token curto, trocar pelo token de longa duração, renovar antes de vencer e ler quem é a conta. Sem Página do Facebook no caminho.
 *
 * Fontes (baixadas em `pesquisa/plataformas/docs/meta/`, 27/10/2026):
 *  - `ig-login-visao-geral.md`: a API não exige Página do Facebook; os valores de `scope` (`instagram_business_basic`, `instagram_business_content_publish`, ...).
 *  - `ig-login-business-login.md`: os quatro endereços (`https://www.instagram.com/oauth/authorize`, `https://api.instagram.com/oauth/access_token`, `https://graph.instagram.com/access_token`,
 *    `https://graph.instagram.com/refresh_access_token`), os parâmetros da autorização (`client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`, `enable_fb_login`, `force_reauth`),
 *    a troca do código (POST: `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`; o código vale 1 hora e uma vez), a troca para longa duração (GET:
 *    `grant_type=ig_exchange_token`, `client_secret`, `access_token`, 60 dias) e a renovação (GET: `grant_type=ig_refresh_token`, `access_token`; o token precisa ter pelo menos 24 horas, estar
 *    válido e a pessoa ter liberado `instagram_business_basic`).
 *  - `ig-login-comecar.md`: `GET graph.instagram.com/<versão>/me?fields=user_id,username,...` (`user_id` é a identificação da conta profissional; `account_type` é `Business` ou `Media_Creator`).
 *
 * O token NUNCA vai para log, mensagem de erro ou retorno de erro: o endereço das chamadas GET leva `access_token`/`client_secret` na query, então o endereço também nunca é escrito em lugar
 * nenhum. Nos testes o `fetch` é simulado; a chamada de verdade recusa rodar dentro do Vitest sem isso.
 */
import { config } from "@/lib/config";
import { conferirQueNaoEhRedeDeVerdade, enderecoDoGraphDaVia, ErroMetaLogin, VERSAO_GRAPH, type TokenDaMeta } from "@/lib/meta-oauth";

const DIALOGO_DO_INSTAGRAM = "https://www.instagram.com/oauth/authorize";
const TOKEN_DO_INSTAGRAM = "https://api.instagram.com/oauth/access_token";

const dialogo = () => (config.metaConexao.simuladorE2E ? `${config.metaConexao.simuladorE2E}/instagram/oauth/authorize` : DIALOGO_DO_INSTAGRAM);
const enderecoDoCodigo = () => (config.metaConexao.simuladorE2E ? `${config.metaConexao.simuladorE2E}/instagram/api/oauth/access_token` : TOKEN_DO_INSTAGRAM);

export { VERSAO_GRAPH };

/** O que a ligação precisa para ler os números (`ig-login-business-login.md`, escopos; `ig-media-insights.md`/`ig-user-insights.md`: `instagram_business_manage_insights`). */
export const PERMISSOES_EXIGIDAS_INSTAGRAM = ["instagram_business_basic", "instagram_business_manage_insights"] as const;
/** Publicar (`publicacao-de-conteudo.md`, coluna do Login do Instagram: `instagram_business_basic` e `instagram_business_content_publish`). Fora das exigidas: sem ela a leitura segue e `publicarLiberado` fica falso. */
export const PERMISSAO_DE_PUBLICAR_INSTAGRAM = "instagram_business_content_publish";
/** Tudo o que o endereço de autorizar pede. */
export const ESCOPOS_DO_INSTAGRAM = [...PERMISSOES_EXIGIDAS_INSTAGRAM, PERMISSAO_DE_PUBLICAR_INSTAGRAM] as const;

/** Os tipos de conta que a API atende (`ig-login-comecar.md`, campo `account_type`): empresa ou criador de conteúdo. A conta pessoal não entra. */
const TIPOS_PROFISSIONAIS = new Set(["business", "media_creator", "creator"]);

/** O endereço de autorizar (`ig-login-business-login.md`, "Etapa 1. Obter autorização"). O `state` é o mesmo da via do Facebook (assinado, igual ao cookie). */
export function urlDoDialogoInstagram(state: string): string {
  const url = new URL(dialogo());
  url.searchParams.set("client_id", config.metaConexao.instagram.appId);
  url.searchParams.set("redirect_uri", config.metaConexao.instagram.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ESCOPOS_DO_INSTAGRAM.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

type CorpoComErro = {
  error?: { message?: string; code?: number; error_subcode?: number };
  // O endereço do código (`api.instagram.com`) devolve o erro neste formato (`ig-login-business-login.md`, "Exemplo de resposta rejeitada").
  error_type?: string;
  code?: number;
  error_message?: string;
} & Record<string, unknown>;

async function pedir<T>(url: URL, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  conferirQueNaoEhRedeDeVerdade();
  let resposta: Response;
  try {
    resposta = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  } catch {
    // Sem a causa nem o endereço: o endereço leva token e segredo na query.
    throw new ErroMetaLogin("Nao foi possivel falar com a Meta (rede ou prazo).");
  }
  let corpo: CorpoComErro | null = null;
  try {
    corpo = (await resposta.json()) as CorpoComErro;
  } catch {
    throw new ErroMetaLogin(`A Meta respondeu ${resposta.status} sem corpo em JSON.`, resposta.status);
  }
  if (!resposta.ok || corpo?.error || corpo?.error_type) {
    const aninhado = corpo?.error ?? {};
    throw new ErroMetaLogin(aninhado.message ?? corpo?.error_message ?? `A Meta respondeu ${resposta.status}.`, aninhado.code ?? corpo?.code, aninhado.error_subcode);
  }
  return corpo as T;
}

/** Os exemplos da documentação mostram `{ "data": [ {...} ] }` e a API devolve o objeto direto; os dois formatos valem. */
function achatar<T extends Record<string, unknown>>(corpo: Record<string, unknown>): T {
  const data = corpo.data;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) return data[0] as T;
  return corpo as T;
}

export type TokenCurtoDoInstagram = { token: string; /** O identificador da pessoa no escopo do aplicativo, como a Meta devolve na troca. */ usuarioId: string | null; permissoes: string[] };

function listaDePermissoes(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.filter((p): p is string => typeof p === "string");
  if (typeof valor === "string") return valor.split(/[,\s]+/).filter(Boolean);
  return [];
}

/** Troca o `code` do retorno pelo token de curta duração (`ig-login-business-login.md`, "Etapa 2"). A `redirect_uri` é a mesma do endereço de autorizar. */
export async function trocarCodigoPorTokenInstagram(codigo: string): Promise<TokenCurtoDoInstagram> {
  const { appId, appSecret, redirectUri } = config.metaConexao.instagram;
  const campos = new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: codigo });
  const corpo = achatar<{ access_token?: unknown; user_id?: unknown; permissions?: unknown }>(
    await pedir<Record<string, unknown>>(new URL(enderecoDoCodigo()), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: campos }),
  );
  if (typeof corpo.access_token !== "string" || corpo.access_token === "") throw new ErroMetaLogin("A Meta nao devolveu o token.");
  const usuarioId = typeof corpo.user_id === "string" || typeof corpo.user_id === "number" ? String(corpo.user_id) : null;
  return { token: corpo.access_token, usuarioId, permissoes: listaDePermissoes(corpo.permissions) };
}

function lerToken(corpo: Record<string, unknown>): TokenDaMeta {
  const dado = achatar<{ access_token?: unknown; expires_in?: unknown }>(corpo);
  if (typeof dado.access_token !== "string" || dado.access_token === "") throw new ErroMetaLogin("A Meta nao devolveu o token.");
  const expira = typeof dado.expires_in === "number" && Number.isFinite(dado.expires_in) && dado.expires_in > 0 ? dado.expires_in : null;
  return { token: dado.access_token, expiraEmSeg: expira };
}

/** Troca o token curto (1 hora) pelo de longa duração (60 dias): `GET graph.instagram.com/access_token?grant_type=ig_exchange_token` (`ig-login-business-login.md`, "Etapa 3"). Só no servidor. */
export async function trocarPorLongaDuracaoInstagram(tokenCurto: string): Promise<TokenDaMeta> {
  const url = new URL(`${config.metaConexao.simuladorE2E ? `${config.metaConexao.simuladorE2E}/graph-ig` : "https://graph.instagram.com"}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.metaConexao.instagram.appSecret);
  url.searchParams.set("access_token", tokenCurto);
  return lerToken(await pedir<Record<string, unknown>>(url));
}

/**
 * Renova o token de longa duração por mais 60 dias: `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` (`ig-login-business-login.md`, "Atualizar um token de longa
 * duração"). Condições da Meta: o token tem pelo menos 24 horas, ainda vale, e a pessoa liberou `instagram_business_basic`. Vencido não renova: a pessoa liga de novo.
 */
export async function renovarTokenInstagram(token: string): Promise<TokenDaMeta> {
  const url = new URL(`${config.metaConexao.simuladorE2E ? `${config.metaConexao.simuladorE2E}/graph-ig` : "https://graph.instagram.com"}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  return lerToken(await pedir<Record<string, unknown>>(url));
}

export type ContaDoLoginInstagram = {
  /** A conta profissional (o `IG_ID` das chamadas `/<IG_ID>/media`, `ig-login-comecar.md`: campo `user_id`). */
  contaId: string;
  nome: string;
  /** O identificador da pessoa no escopo do aplicativo (campo `id`), quando a Meta o devolve. */
  usuarioId: string | null;
  profissional: boolean;
};

/** Quem é a conta do token: `GET graph.instagram.com/<versão>/me?fields=user_id,username,account_type,id` (`ig-login-comecar.md`). */
export async function contaDoTokenInstagram(token: string): Promise<ContaDoLoginInstagram> {
  const url = new URL(`${enderecoDoGraphDaVia("instagram")}/me`);
  url.searchParams.set("fields", "user_id,username,account_type,id");
  url.searchParams.set("access_token", token);
  const corpo = achatar<{ user_id?: unknown; username?: unknown; account_type?: unknown; id?: unknown }>(await pedir<Record<string, unknown>>(url));
  const contaId = typeof corpo.user_id === "string" || typeof corpo.user_id === "number" ? String(corpo.user_id) : typeof corpo.id === "string" ? corpo.id : "";
  if (!contaId) throw new ErroMetaLogin("A Meta nao devolveu a conta do Instagram.");
  const nome = typeof corpo.username === "string" && corpo.username !== "" ? corpo.username : contaId;
  const tipo = typeof corpo.account_type === "string" ? corpo.account_type.toLowerCase() : "";
  return {
    contaId,
    nome,
    usuarioId: typeof corpo.id === "string" || typeof corpo.id === "number" ? String(corpo.id) : null,
    // Sem `account_type` na resposta não dá para afirmar que é pessoal: a Meta nem deixa uma conta pessoal chegar aqui. Só recusa o tipo que ela diz ser outro.
    profissional: tipo === "" || TIPOS_PROFISSIONAIS.has(tipo),
  };
}

/** As permissões exigidas que a pessoa não liberou, e se liberou a de publicar. */
export function conferirPermissoesInstagram(liberadas: string[]): { faltam: string[]; publicar: boolean } {
  const conjunto = new Set(liberadas);
  return { faltam: PERMISSOES_EXIGIDAS_INSTAGRAM.filter((p) => !conjunto.has(p)), publicar: conjunto.has(PERMISSAO_DE_PUBLICAR_INSTAGRAM) };
}
