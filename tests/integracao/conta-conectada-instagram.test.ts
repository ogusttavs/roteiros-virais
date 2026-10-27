/**
 * E19b, o Instagram ligado direto pelo Login do Instagram (sem Página do Facebook), contra o Postgres local e SEM rede: `api.instagram.com` e `graph.instagram.com` são simulados pelo `fetch`
 * (`lib/meta-instagram-login.ts` recusa rodar dentro do Vitest sem isso). Prova: o começo (endereço do Instagram, state com a via), a volta (código, token curto, longo, permissões, conta, token
 * cifrado, `via = instagram`), conta pessoal, permissão que falta, erro da Meta, só o dono, o "ver como" nunca, o isolamento entre marcas, a renovação por `refresh_access_token`, o aviso por
 * e-mail, a exclusão de dados assinada pelo segredo do Instagram e as duas rotas. A via do Facebook (código antigo) tem os testes dela em `conta-conectada.test.ts`.
 */
import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string }; session: { userId: string } },
  verComo: false,
  logs: [] as unknown[][],
  emails: [] as { para: string; assunto: string; html: string }[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return {
    ...original,
    sessaoDoPainel: async () => estado.sessao,
    recusaDoVerComo: async () => (estado.verComo ? "Desligado no modo ver como." : null),
    modoVerComoLigado: async () => estado.verComo,
  };
});
vi.mock("@/lib/log", () => {
  const guardar = (...args: unknown[]) => void estado.logs.push(args);
  return { logger: { info: guardar, warn: guardar, error: guardar, debug: guardar, trace: guardar, fatal: guardar } };
});
vi.mock("@/lib/email", () => ({
  enviarEmail: async (m: { para: string; assunto: string; html: string }) => {
    estado.emails.push(m);
  },
  ErroEmail: class ErroEmail extends Error {},
}));

import { db, getPool } from "@/db";
import { clientes, contasConectadas, exclusoesMeta, membrosMarca, nichos, user } from "@/db/schema";
import { config } from "@/lib/config";
import { criarState, lerState, NOME_COOKIE_STATE_META } from "@/lib/meta-oauth";
import { cifrarToken, contextoDoToken, decifrarToken } from "@/lib/meta-token";
import {
  concluirLigacao,
  contaLigadaDaMarca,
  contaParaLeitura,
  contaParaPublicar,
  desligarConta,
  iniciarLigacao,
  renovarContasLigadas,
  tratarExclusaoDaMeta,
} from "@/servicos/conta-conectada";
import { textosLigacao } from "@/textos/conta-conectada";

import { resetarSchema } from "../../scripts/resetar-schema";

const { GET: conectar } = await import("@/app/api/meta/conectar/route");
const { GET: retorno } = await import("@/app/api/meta/retorno/route");
const { POST: exclusao } = await import("@/app/api/meta/exclusao/route");

const SEGREDO_IG = "segredo-do-app-do-instagram-da-suite";
const SEGREDO_FB = "segredo-do-app-do-facebook-da-suite";
const TOKEN_CURTO = "IGQ-CURTO-NUNCA-NO-BANCO";
const TOKENS = [TOKEN_CURTO, "IGQ-LONGO-A", "IGQ-LONGO-B", "IGQ-RENOVADO", "IGQ-LONGO-C"];
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let marcaA: number;
let marcaB: number;

// ---------------------------------------------------------------------------
// O Instagram simulado
// ---------------------------------------------------------------------------

type Cenario = {
  longo?: string;
  renovado?: string;
  expiresIn?: number | null;
  igId?: string;
  username?: string;
  tipoDeConta?: string;
  permissoes?: string[] | string;
  /** Qual etapa responde com erro. */
  erro?: { etapa: "codigo" | "longo" | "renovacao" | "usuario"; codigo: number };
  renovacaoExpiraEm?: number;
};
const chamadas: { host: string; caminho: string; metodo: string; parametros: Record<string, string> }[] = [];

const TODAS = ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"];

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function instalarInstagram(c: Cenario = {}): void {
  mockFetch.mockImplementation(async (entrada: URL | string, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const parametros: Record<string, string> = Object.fromEntries(url.searchParams);
    if (init?.body instanceof URLSearchParams) Object.assign(parametros, Object.fromEntries(init.body));
    const caminho = url.pathname.replace("/v26.0/", "/").replace(/^\//, "");
    chamadas.push({ host: url.host, caminho, metodo: init?.method ?? "GET", parametros });
    if (url.host === "www.facebook.com" || url.host === "graph.facebook.com") return json({ error: { message: "o Facebook nao devia ser chamado", code: 1 } }, 400);
    const etapa = url.host === "api.instagram.com" ? "codigo" : caminho === "access_token" ? "longo" : caminho === "refresh_access_token" ? "renovacao" : caminho === "me" ? "usuario" : "outra";
    if (c.erro?.etapa === etapa) return json({ error: { message: `erro simulado em ${etapa} ${parametros.access_token ?? ""} ${parametros.code ?? ""}`, code: c.erro.codigo, type: "OAuthException" } }, 400);
    if (etapa === "codigo") return json({ access_token: TOKEN_CURTO, user_id: "9001", permissions: c.permissoes ?? TODAS });
    if (etapa === "longo") return json({ access_token: c.longo ?? "IGQ-LONGO-A", token_type: "bearer", ...(c.expiresIn === null ? {} : { expires_in: c.expiresIn ?? 5183944 }) });
    if (etapa === "renovacao") return json({ access_token: c.renovado ?? "IGQ-RENOVADO", token_type: "bearer", expires_in: c.renovacaoExpiraEm ?? 5183944 });
    if (etapa === "usuario") return json({ user_id: c.igId ?? "ig-a", username: c.username ?? "contaa", account_type: c.tipoDeConta ?? "BUSINESS", id: "9001" });
    return json({ error: { message: "caminho desconhecido", code: 100 } }, 404);
  });
}

function oFacebookFoiChamado(): boolean {
  return chamadas.some((x) => x.host.includes("facebook.com"));
}

function entrar(usuarioId: string | null, papel = "cliente"): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: papel }, session: { userId: usuarioId } } : null;
}

function volta(usuarioId: string | null, clienteId: number, extra: Partial<Parameters<typeof concluirLigacao>[0]> = {}, agora = new Date(), via: "instagram" | "facebook" = "instagram") {
  const state = criarState({ c: clienteId, u: usuarioId ?? "ninguem", v: via }, agora);
  return { codigo: "codigo-da-meta", erroDaMeta: null, state, stateDoCookie: state, usuarioId, ...extra };
}

async function linhas() {
  return db().select().from(contasConectadas);
}

async function inserirAtiva(o: { clienteId: number; contaId: string; token: string; expiraEm?: Date | null; via?: "instagram" | "facebook"; metaUsuarioId?: string; conectadaEm?: Date; erro?: string | null }) {
  const [linha] = await db()
    .insert(contasConectadas)
    .values({
      clienteId: o.clienteId,
      plataforma: "instagram",
      via: o.via ?? "instagram",
      contaId: o.contaId,
      nome: `conta-${o.contaId}`,
      metaUsuarioId: o.metaUsuarioId ?? `meta-${o.clienteId}`,
      estado: "ativa",
      publicarLiberado: true,
      tokenCifrado: cifrarToken(o.token, contextoDoToken(o.clienteId, "instagram", o.contaId)),
      tokenExpiraEm: o.expiraEm === undefined ? new Date("2026-12-01T00:00:00Z") : o.expiraEm,
      conectadaEm: o.conectadaEm ?? new Date("2026-10-01T00:00:00Z"),
      erro: o.erro ?? null,
    })
    .returning();
  return linha;
}

function signedRequest(userId: string, segredo: string): string {
  const corpo = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: 1 }), "utf8").toString("base64url");
  return `${createHmac("sha256", segredo).update(corpo).digest("base64url")}.${corpo}`;
}

function pedidoDeExclusao(signed: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/meta/exclusao", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signed }).toString(),
  });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "conta-conectada-ig", nome: "Conta conectada IG", termos: [] }).returning();
  await db().insert(user).values([
    { id: "ig-dono-a", name: "Dono A", email: "ig-dono-a@exemplo.teste", role: "cliente" },
    { id: "ig-membro-a", name: "Membro A", email: "ig-membro-a@exemplo.teste", role: "cliente" },
    { id: "ig-dono-b", name: "Dono B", email: "ig-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "ig-dono-a", nome: "[teste] Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "ig-dono-b", nome: "[teste] Marca B", nichoId: nicho.id }).returning();
  marcaA = a.id;
  marcaB = b.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "ig-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "ig-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "ig-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(contasConectadas);
  await db().delete(exclusoesMeta);
  mockFetch.mockReset();
  chamadas.length = 0;
  estado.logs.length = 0;
  estado.emails.length = 0;
  estado.sessao = null;
  estado.verComo = false;
  // A via do Instagram ligada, e a do Facebook (código antigo) desligada, como em produção.
  config.metaConexao.tokenChave = Buffer.alloc(32, 11).toString("base64");
  config.metaConexao.instagram.appId = "990602627938098";
  config.metaConexao.instagram.appSecret = SEGREDO_IG;
  config.metaConexao.instagram.redirectUri = "http://localhost:3000/api/meta/retorno";
  config.metaConexao.instagram.ativa = true;
  config.metaConexao.viaFacebookLigada = false;
  config.metaConexao.ativa = true;
  config.metaConexao.appSecret = SEGREDO_FB;
});

afterEach(() => {
  // Em nenhum teste um token pode ter ido parar em log nem em e-mail.
  const tudo = JSON.stringify([estado.logs, estado.emails]);
  for (const token of TOKENS) expect(tudo, `o token ${token} apareceu em log ou e-mail`).not.toContain(token);
  expect(tudo).not.toContain(SEGREDO_IG);
  expect(tudo).not.toContain("codigo-da-meta");
});

afterAll(async () => {
  await getPool().end();
});

// ---------------------------------------------------------------------------
// O começo
// ---------------------------------------------------------------------------

describe("iniciarLigacao pela via do Instagram", () => {
  it("o dono recebe o endereço de autorizar do Instagram, com os escopos e o state assinado que carrega a via", async () => {
    const r = await iniciarLigacao("ig-dono-a", marcaA);
    expect("url" in r).toBe(true);
    if (!("url" in r)) return;
    const url = new URL(r.url);
    expect(url.hostname).toBe("www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("990602627938098");
    expect(url.searchParams.get("scope")).toContain("instagram_business_content_publish");
    expect(url.searchParams.get("state")).toBe(r.state);
    const lido = lerState(r.state, r.state);
    expect(lido.ok && lido.carga).toMatchObject({ c: marcaA, u: "ig-dono-a", v: "instagram" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("quem só é membro, quem não é da marca e o dono de outra marca são recusados", async () => {
    expect(await iniciarLigacao("ig-membro-a", marcaA)).toEqual({ recusa: "sem-acesso" });
    expect(await iniciarLigacao("ig-dono-b", marcaA)).toEqual({ recusa: "sem-acesso" });
    expect(await iniciarLigacao("ninguem", marcaA)).toEqual({ recusa: "sem-acesso" });
  });

  it("sem os dados do app do Instagram, e com a via do Facebook desligada, ninguém começa", async () => {
    config.metaConexao.instagram.ativa = false;
    expect(await iniciarLigacao("ig-dono-a", marcaA)).toEqual({ recusa: "nao-configurada" });
  });

  it("com a via do Instagram desligada e a do Facebook ligada de propósito, o diálogo é o do Facebook (a via antiga continua existindo, só desligada por padrão)", async () => {
    config.metaConexao.instagram.ativa = false;
    config.metaConexao.viaFacebookLigada = true;
    config.metaConexao.appId = "1078374371332982";
    config.metaConexao.loginConfigId = "config-da-suite";
    const r = await iniciarLigacao("ig-dono-a", marcaA);
    expect("url" in r && new URL(r.url).hostname).toBe("www.facebook.com");
    config.metaConexao.viaFacebookLigada = false;
  });
});

// ---------------------------------------------------------------------------
// A volta
// ---------------------------------------------------------------------------

describe("concluirLigacao pela via do Instagram", () => {
  it("liga: código, token curto, token longo e a conta; guarda cifrado, com a via, sem Página, com a publicação liberada", async () => {
    instalarInstagram();
    const agora = new Date("2026-10-27T12:00:00Z");
    expect(await concluirLigacao(volta("ig-dono-a", marcaA, {}, agora), agora)).toEqual({ resultado: "ligada" });

    const [linha] = await linhas();
    expect(linha).toMatchObject({ clienteId: marcaA, via: "instagram", plataforma: "instagram", contaId: "ig-a", nome: "contaa", paginaId: null, paginaNome: null, estado: "ativa", publicarLiberado: true, metaUsuarioId: "9001", conectadoPor: "ig-dono-a" });
    expect(linha.tokenExpiraEm?.getTime()).toBe(agora.getTime() + 5183944 * 1000);
    // Cifrado: o texto do token não está no banco, e decifra de volta com o contexto da marca.
    for (const token of TOKENS) expect(linha.tokenCifrado).not.toContain(token);
    expect(decifrarToken(linha.tokenCifrado, contextoDoToken(marcaA, "instagram", "ig-a"))).toBe("IGQ-LONGO-A");

    // As chamadas: só o Instagram, na ordem, e a troca do código com o segredo do app do Instagram no corpo.
    expect(chamadas.map((x) => `${x.host} ${x.caminho}`)).toEqual(["api.instagram.com oauth/access_token", "graph.instagram.com access_token", "graph.instagram.com me"]);
    expect(chamadas[0]).toMatchObject({ metodo: "POST", parametros: { client_id: "990602627938098", client_secret: SEGREDO_IG, grant_type: "authorization_code", code: "codigo-da-meta" } });
    expect(chamadas[1].parametros).toMatchObject({ grant_type: "ig_exchange_token", client_secret: SEGREDO_IG, access_token: TOKEN_CURTO });
    expect(chamadas[2].parametros.access_token).toBe("IGQ-LONGO-A");
    expect(oFacebookFoiChamado()).toBe(false);
  });

  it("sem a permissão de publicar a conta liga igual, com publicarLiberado falso e a leitura funcionando", async () => {
    instalarInstagram({ permissoes: ["instagram_business_basic", "instagram_business_manage_insights"] });
    expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "ligada" });
    expect((await linhas())[0].publicarLiberado).toBe(false);
    expect(await contaParaLeitura(marcaA)).not.toBeNull();
    expect(await contaParaPublicar(marcaA)).toEqual({ recusa: "sem-permissao" });
  });

  it("as permissões vindas em texto separado por vírgula também valem", async () => {
    instalarInstagram({ permissoes: "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish" });
    expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "ligada" });
  });

  it("faltando a de números, nada é ligado e o token longo nem é pedido", async () => {
    instalarInstagram({ permissoes: ["instagram_business_basic"] });
    expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "permissao" });
    expect(await linhas()).toHaveLength(0);
    expect(chamadas.map((x) => x.caminho)).toEqual(["oauth/access_token"]);
  });

  it("conta pessoal: nada é ligado e a frase diz como trocar para profissional", async () => {
    instalarInstagram({ tipoDeConta: "PERSONAL" });
    expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "conta-pessoal" });
    expect(await linhas()).toHaveLength(0);
    expect(textosLigacao.retorno["conta-pessoal"]).toContain("Mudar para conta profissional");
  });

  it("criador de conteúdo (Media_Creator) é profissional e liga", async () => {
    instalarInstagram({ tipoDeConta: "Media_Creator" });
    expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "ligada" });
  });

  it("erro da Meta em qualquer etapa: 'falhou', nada gravado, e nem o código, nem o token, nem o segredo nos logs (conferido no afterEach)", async () => {
    for (const etapa of ["codigo", "longo", "usuario"] as const) {
      instalarInstagram({ erro: { etapa, codigo: 400 } });
      expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "falhou" });
      expect(await linhas()).toHaveLength(0);
    }
  });

  it("a pessoa cancelou no Instagram: 'cancelou', e a Meta nem é chamada", async () => {
    instalarInstagram();
    expect(await concluirLigacao(volta("ig-dono-a", marcaA, { codigo: null, erroDaMeta: "access_denied" }))).toEqual({ resultado: "cancelou" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("state ausente, diferente do cookie, adulterado ou vencido: recusa, sem chamar a Meta", async () => {
    instalarInstagram();
    const bom = volta("ig-dono-a", marcaA);
    expect(await concluirLigacao({ ...bom, stateDoCookie: null })).toEqual({ resultado: "sem-acesso" });
    expect(await concluirLigacao({ ...bom, stateDoCookie: `${bom.state}x` })).toEqual({ resultado: "sem-acesso" });
    const adulterado = `${(bom.state ?? "").slice(0, -3)}AAA`;
    expect(await concluirLigacao({ ...bom, state: adulterado, stateDoCookie: adulterado })).toEqual({ resultado: "sem-acesso" });
    const velho = volta("ig-dono-a", marcaA, {}, new Date("2026-10-01T00:00:00Z"));
    expect(await concluirLigacao(velho, new Date("2026-10-27T00:00:00Z"))).toEqual({ resultado: "venceu" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("outra sessão que a que abriu o diálogo, quem deixou de ser dono, e o membro: recusa", async () => {
    instalarInstagram();
    expect(await concluirLigacao({ ...volta("ig-dono-a", marcaA), usuarioId: "ig-dono-b" })).toEqual({ resultado: "sem-acesso" });
    expect(await concluirLigacao({ ...volta("ig-dono-a", marcaA), usuarioId: null })).toEqual({ resultado: "sem-acesso" });
    expect(await concluirLigacao(volta("ig-membro-a", marcaA))).toEqual({ resultado: "sem-acesso" });
    // O dono de uma marca com o state de OUTRA marca: o state diz marca B, mas ele não é dono dela.
    expect(await concluirLigacao(volta("ig-dono-a", marcaB))).toEqual({ resultado: "sem-acesso" });
    expect(await linhas()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("um state aberto pela via do Facebook, com a do Facebook desligada, não liga nada", async () => {
    instalarInstagram();
    expect(await concluirLigacao(volta("ig-dono-a", marcaA, {}, new Date(), "facebook"))).toEqual({ resultado: "nao-configurada" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("o mesmo Instagram já ligado em outra marca: 'ja-ligada', sem mexer em nada", async () => {
    instalarInstagram({ igId: "ig-compartilhada" });
    expect(await concluirLigacao(volta("ig-dono-a", marcaA))).toEqual({ resultado: "ligada" });
    expect(await concluirLigacao(volta("ig-dono-b", marcaB))).toEqual({ resultado: "ja-ligada" });
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0].clienteId).toBe(marcaA);
  });

  it("ligar de novo troca a conta da marca (a anterior some, com o token), sem duplicar", async () => {
    instalarInstagram({ igId: "ig-velha", longo: "IGQ-LONGO-B" });
    await concluirLigacao(volta("ig-dono-a", marcaA));
    instalarInstagram({ igId: "ig-nova", longo: "IGQ-LONGO-C" });
    await concluirLigacao(volta("ig-dono-a", marcaA));
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0].contaId).toBe("ig-nova");
  });
});

// ---------------------------------------------------------------------------
// Isolamento entre marcas
// ---------------------------------------------------------------------------

describe("o acesso de uma marca nunca é lido por outra", () => {
  it("leitura e publicação filtram pela marca, e devolvem a via", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A" });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "IGQ-LONGO-B" });
    const a = await contaParaLeitura(marcaA);
    const b = await contaParaLeitura(marcaB);
    expect(a).toMatchObject({ igId: "ig-a", token: "IGQ-LONGO-A", via: "instagram" });
    expect(b).toMatchObject({ igId: "ig-b", token: "IGQ-LONGO-B", via: "instagram" });
    const pa = await contaParaPublicar(marcaA);
    expect("conta" in pa && pa.conta).toMatchObject({ igId: "ig-a", token: "IGQ-LONGO-A", via: "instagram" });
    expect((await contaLigadaDaMarca(marcaB))?.contaId).toBe("ig-b");
    expect(JSON.stringify(await contaLigadaDaMarca(marcaA))).not.toContain("IGQ-LONGO");
    expect(await contaParaLeitura(99999)).toBeNull();
  });

  it("o token cifrado copiado para a linha de outra marca não decifra: a conta fica marcada como ilegível, nunca devolve o acesso da outra", async () => {
    const a = await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A" });
    await db().delete(contasConectadas).where(eq(contasConectadas.id, a.id));
    const { id: _descartado, ...copiaSemId } = a;
    void _descartado;
    await db().insert(contasConectadas).values({ ...copiaSemId, clienteId: marcaB, contaId: "ig-b" });
    expect(await contaParaLeitura(marcaB)).toBeNull();
    expect((await contaLigadaDaMarca(marcaB))?.erro).toBe(textosLigacao.erroDaConta.ilegivel);
  });

  it("conta ligada por uma via que este ambiente não tem ligada não é lida nem publicada (e não é marcada com erro)", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", via: "facebook" });
    expect(await contaParaLeitura(marcaA)).toBeNull();
    expect(await contaParaPublicar(marcaA)).toEqual({ recusa: "nao-configurada" });
    expect((await contaLigadaDaMarca(marcaA))?.erro).toBeNull();
  });

  it("desligar apaga a linha e o token; só o dono desliga", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A" });
    expect(await desligarConta("ig-membro-a", marcaA)).toEqual({ ok: false, apagadas: 0 });
    expect(await desligarConta("ig-dono-b", marcaA)).toEqual({ ok: false, apagadas: 0 });
    expect(await linhas()).toHaveLength(1);
    expect(await desligarConta("ig-dono-a", marcaA)).toEqual({ ok: true, apagadas: 1 });
    expect(await linhas()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A renovação
// ---------------------------------------------------------------------------

describe("renovarContasLigadas pela via do Instagram", () => {
  const agora = new Date("2026-11-20T12:00:00Z");

  it("renova com refresh_access_token (nunca com ig_exchange_token), guarda o token novo cifrado e a nova validade, e limpa o erro", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", expiraEm: new Date("2026-11-30T00:00:00Z"), erro: textosLigacao.erroDaConta.naoRenovou });
    instalarInstagram({ renovado: "IGQ-RENOVADO", renovacaoExpiraEm: 5000000 });
    const resumo = await renovarContasLigadas(agora);
    expect(resumo).toMatchObject({ avaliadas: 1, renovadas: 1, falhas: 0, avisos: 0 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ host: "graph.instagram.com", caminho: "refresh_access_token", parametros: { grant_type: "ig_refresh_token", access_token: "IGQ-LONGO-A" } });
    expect(chamadas[0].parametros).not.toHaveProperty("client_secret");
    const [linha] = await linhas();
    expect(decifrarToken(linha.tokenCifrado, contextoDoToken(marcaA, "instagram", "ig-a"))).toBe("IGQ-RENOVADO");
    expect(linha.tokenCifrado).not.toContain("IGQ-RENOVADO");
    expect(linha.tokenExpiraEm?.getTime()).toBe(agora.getTime() + 5000000 * 1000);
    expect(linha).toMatchObject({ erro: null, renovadaEm: agora });
  });

  it("não renova o que ainda tem folga, nem a conta cujo acesso a Meta já recusou", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", expiraEm: new Date("2027-01-15T00:00:00Z") });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "IGQ-LONGO-B", expiraEm: new Date("2026-11-25T00:00:00Z"), erro: textosLigacao.erroDaConta.recusada });
    instalarInstagram();
    const resumo = await renovarContasLigadas(agora);
    expect(resumo.avaliadas).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a Meta recusa (190): a conta ganha a frase de ligar de novo e o dono recebe UM e-mail, sem token", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", expiraEm: new Date("2026-11-24T00:00:00Z") });
    instalarInstagram({ erro: { etapa: "renovacao", codigo: 190 } });
    const resumo = await renovarContasLigadas(agora);
    expect(resumo).toMatchObject({ avaliadas: 1, renovadas: 0, falhas: 1, avisos: 1 });
    expect((await linhas())[0].erro).toBe(textosLigacao.erroDaConta.recusada);
    expect(estado.emails).toHaveLength(1);
    expect(estado.emails[0].para).toBe("ig-dono-a@exemplo.teste");
    await renovarContasLigadas(new Date(agora.getTime() + 3_600_000));
    expect(estado.emails).toHaveLength(1);
  });

  it("acesso que já venceu não tenta renovar: marca como vencido e avisa", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", expiraEm: new Date("2026-11-10T00:00:00Z") });
    instalarInstagram();
    await renovarContasLigadas(agora);
    expect(mockFetch).not.toHaveBeenCalled();
    expect((await linhas())[0].erro).toBe(textosLigacao.erroDaConta.venceu);
    expect(estado.emails).toHaveLength(1);
  });

  it("sem os dados do app do Instagram neste ambiente, a conta dessa via não é tocada nem marcada", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", expiraEm: new Date("2026-11-24T00:00:00Z") });
    config.metaConexao.instagram.ativa = false;
    instalarInstagram();
    const resumo = await renovarContasLigadas(agora);
    expect(resumo.avaliadas).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect((await linhas())[0].erro).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A exclusão de dados
// ---------------------------------------------------------------------------

describe("o aviso de exclusão de dados do aplicativo do Instagram", () => {
  it("assinado com o segredo do Instagram, apaga a ligação pela identificação da pessoa ou da conta", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", metaUsuarioId: "9001" });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "IGQ-LONGO-B", metaUsuarioId: "9002" });
    const r = await tratarExclusaoDaMeta(signedRequest("9001", SEGREDO_IG));
    expect(r?.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect((await linhas()).map((l) => l.contaId)).toEqual(["ig-b"]);
    // Pela identificação da CONTA profissional (o `user_id` da API do Instagram), também.
    await tratarExclusaoDaMeta(signedRequest("ig-b", SEGREDO_IG));
    expect(await linhas()).toHaveLength(0);
  });

  it("assinatura com outro segredo é recusada, e nada é apagado", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", metaUsuarioId: "9001" });
    expect(await tratarExclusaoDaMeta(signedRequest("9001", "segredo-errado"))).toBeNull();
    expect(await linhas()).toHaveLength(1);
  });

  it("a rota: com o segredo do Instagram passa (200); com assinatura ruim, 400; sem nenhum segredo configurado, 503", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "IGQ-LONGO-A", metaUsuarioId: "9001" });
    expect((await exclusao(pedidoDeExclusao(signedRequest("9001", "errado")))).status).toBe(400);
    const ok = await exclusao(pedidoDeExclusao(signedRequest("9001", SEGREDO_IG)));
    expect(ok.status).toBe(200);
    expect(await linhas()).toHaveLength(0);
    config.metaConexao.appSecret = "";
    config.metaConexao.instagram.appSecret = "";
    expect((await exclusao(pedidoDeExclusao(signedRequest("9001", SEGREDO_IG)))).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// As rotas
// ---------------------------------------------------------------------------

describe("as rotas /api/meta/conectar e /api/meta/retorno pela via do Instagram", () => {
  function pedidoDeRetorno(consulta: Record<string, string>, cookieDeState?: string): NextRequest {
    const url = new URL("http://localhost:3000/api/meta/retorno");
    for (const [k, v] of Object.entries(consulta)) url.searchParams.set(k, v);
    return new NextRequest(url, { headers: cookieDeState ? { cookie: `${NOME_COOKIE_STATE_META}=${encodeURIComponent(cookieDeState)}` } : {} });
  }

  it("conectar leva o dono ao Instagram com o cookie do state; o retorno com esse state liga a conta; o cookie some", async () => {
    instalarInstagram();
    entrar("ig-dono-a");
    const r = await conectar();
    expect(r.status).toBe(307);
    const destino = new URL(r.headers.get("location")!);
    expect(destino.hostname).toBe("www.instagram.com");
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain("Path=/api/meta");
    const state = destino.searchParams.get("state")!;

    const volta2 = await retorno(pedidoDeRetorno({ code: "codigo-da-meta", state }, state));
    expect(new URL(volta2.headers.get("location")!).searchParams.get("instagram")).toBe("ligada");
    expect(volta2.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await linhas())[0]).toMatchObject({ via: "instagram", contaId: "ig-a" });
  });

  it("conectar: sem sessão /entrar; o membro e o 'ver como' voltam com 'sem-acesso', sem cookie e sem falar com a Meta", async () => {
    entrar(null);
    expect(new URL((await conectar()).headers.get("location")!).pathname).toBe("/entrar");
    entrar("ig-membro-a");
    const membro = await conectar();
    expect(new URL(membro.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    expect(membro.headers.get("set-cookie")).toBeNull();
    entrar("ig-dono-a");
    estado.verComo = true;
    const verComo = await conectar();
    expect(new URL(verComo.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    expect(verComo.headers.get("set-cookie")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retorno: no 'ver como', sem o cookie ou por outra sessão, nada é ligado", async () => {
    instalarInstagram();
    const state = criarState({ c: marcaA, u: "ig-dono-a", v: "instagram" });
    entrar("ig-dono-a");
    estado.verComo = true;
    expect(new URL((await retorno(pedidoDeRetorno({ code: "c", state }, state))).headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    estado.verComo = false;
    expect(new URL((await retorno(pedidoDeRetorno({ code: "c", state }))).headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    entrar("ig-dono-b");
    expect(new URL((await retorno(pedidoDeRetorno({ code: "c", state }, state))).headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    expect(await linhas()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retorno: a pessoa cancelou (error=access_denied) volta com 'cancelou'", async () => {
    entrar("ig-dono-a");
    const state = criarState({ c: marcaA, u: "ig-dono-a", v: "instagram" });
    const r = await retorno(pedidoDeRetorno({ error: "access_denied", error_reason: "user_denied", state }, state));
    expect(new URL(r.headers.get("location")!).searchParams.get("instagram")).toBe("cancelou");
  });
});
