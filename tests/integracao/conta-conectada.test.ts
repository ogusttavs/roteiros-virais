/**
 * E19 PR 1, o Instagram ligado pela própria pessoa, contra o Postgres local e SEM rede: a Graph API é simulada pelo `fetch` (nenhum teste fala com a Meta de verdade; `lib/meta-oauth.ts`
 * recusa rodar dentro do Vitest sem isso). Prova: o fluxo (state, código, token de longa duração, permissões, descoberta da conta), o token cifrado no banco, só o dono, o "ver como"
 * nunca, o isolamento entre marcas (o token de uma nunca é lido por outra, nem copiado de linha), a escolha entre várias contas, desligar apaga o token, a renovação com o aviso, o
 * callback de exclusão de dados e as três rotas.
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
  falharEmail: false,
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
    if (estado.falharEmail) throw new Error("o provedor de e-mail caiu");
    estado.emails.push(m);
  },
  ErroEmail: class ErroEmail extends Error {},
}));

import { db, getPool } from "@/db";
import { clientes, contasConectadas, exclusoesMeta, membrosMarca, metricasVideoCliente, nichos, user, videosCliente } from "@/db/schema";
import { config } from "@/lib/config";
import { criarState, NOME_COOKIE_STATE_META, VALIDADE_DO_STATE_MS } from "@/lib/meta-oauth";
import { cifrarToken, contextoDoToken } from "@/lib/meta-token";
import {
  candidatasDaMarca,
  concluirLigacao,
  contaLigadaDaMarca,
  contaParaLeitura,
  desligarConta,
  escolherConta,
  iniciarLigacao,
  renovarContasLigadas,
  statusDaExclusao,
  tratarExclusaoDaMeta,
  VALIDADE_DA_ESCOLHA_MS,
} from "@/servicos/conta-conectada";
import { textosLigacao } from "@/textos/conta-conectada";

import { resetarSchema } from "../../scripts/resetar-schema";

const { GET: conectar } = await import("@/app/api/meta/conectar/route");
const { GET: retorno } = await import("@/app/api/meta/retorno/route");
const { POST: exclusao } = await import("@/app/api/meta/exclusao/route");
const { desligarInstagramAction, escolherInstagramAction } = await import("@/app/(painel)/(completo)/conta/instagram-acoes");

const SEGREDO_DO_APP = "segredo-do-app-da-suite";
const TOKEN_CURTO = "EAA-CURTO-NUNCA-NO-BANCO";
const TOKENS = [TOKEN_CURTO, "EAA-LONGO-A", "EAA-LONGO-B", "EAA-LONGO-NOVO", "EAA-LONGO-C", "EAA-RENOVADO"];
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let marcaA: number;
let marcaB: number;
let marcaC: number;

// ---------------------------------------------------------------------------
// A Meta simulada
// ---------------------------------------------------------------------------

type ContaMeta = { pageId: string; pageName: string; igId: string; username: string };
type Cenario = {
  longo?: string;
  expiresIn?: number | null;
  metaUsuario?: string;
  permissoesLiberadas?: string[];
  contas?: ContaMeta[];
  /** Qual etapa responde com erro da Graph API. */
  erro?: { etapa: "codigo" | "longo" | "usuario" | "permissoes" | "contas"; codigo: number };
};
const chamadas: { caminho: string; parametros: Record<string, string> }[] = [];

const TODAS_AS_PERMISSOES = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "public_profile"];

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function instalarMeta(c: Cenario = {}): void {
  mockFetch.mockImplementation(async (entrada: URL | string) => {
    const url = new URL(String(entrada));
    const parametros = Object.fromEntries(url.searchParams);
    const caminho = url.pathname.replace("/v26.0/", "");
    chamadas.push({ caminho, parametros });
    const etapa = caminho === "oauth/access_token" ? (parametros.grant_type === "fb_exchange_token" ? "longo" : "codigo") : caminho === "me" ? "usuario" : caminho === "me/permissions" ? "permissoes" : "contas";
    if (c.erro?.etapa === etapa) return json({ error: { message: `erro simulado em ${etapa}`, code: c.erro.codigo } }, 400);
    if (etapa === "codigo") return json({ access_token: TOKEN_CURTO, token_type: "bearer", expires_in: 3600 });
    if (etapa === "longo") return json({ access_token: c.longo ?? "EAA-LONGO-A", token_type: "bearer", ...(c.expiresIn === null ? {} : { expires_in: c.expiresIn ?? 5183944 }) });
    if (etapa === "usuario") return json({ id: c.metaUsuario ?? "meta-pessoa-a" });
    if (etapa === "permissoes") return json({ data: (c.permissoesLiberadas ?? TODAS_AS_PERMISSOES).map((permission) => ({ permission, status: "granted" })) });
    const contas = c.contas ?? [{ pageId: "pg-a", pageName: "Pagina A", igId: "ig-a", username: "contaa" }];
    return json({
      data: contas.map((x) => ({ id: x.pageId, name: x.pageName, instagram_business_account: { id: x.igId, username: x.username } })),
    });
  });
}

function aMetaFoiChamada(): boolean {
  return mockFetch.mock.calls.length > 0;
}

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

function entrar(usuarioId: string | null, papel = "cliente"): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: papel }, session: { userId: usuarioId } } : null;
}

/** O retorno do diálogo como a Meta o entrega: o state assinado (igual ao cookie), o código, e a pessoa da sessão. */
function volta(usuarioId: string | null, clienteId: number, extra: Partial<Parameters<typeof concluirLigacao>[0]> = {}, agora = new Date()) {
  const state = criarState({ c: clienteId, u: usuarioId ?? "ninguem" }, agora);
  return { codigo: "codigo-da-meta", erroDaMeta: null, state, stateDoCookie: state, usuarioId, ...extra };
}

async function linhas() {
  return db().select().from(contasConectadas);
}

async function inserirAtiva(o: { clienteId: number; contaId: string; token: string; expiraEm?: Date | null; metaUsuarioId?: string; conectadaEm?: Date; renovadaEm?: Date | null; erro?: string | null }) {
  const [linha] = await db()
    .insert(contasConectadas)
    .values({
      clienteId: o.clienteId,
      plataforma: "instagram",
      contaId: o.contaId,
      nome: `conta-${o.contaId}`,
      metaUsuarioId: o.metaUsuarioId ?? `meta-${o.clienteId}`,
      estado: "ativa",
      tokenCifrado: cifrarToken(o.token, contextoDoToken(o.clienteId, "instagram", o.contaId)),
      tokenExpiraEm: o.expiraEm === undefined ? new Date("2026-12-01T00:00:00Z") : o.expiraEm,
      conectadaEm: o.conectadaEm ?? new Date("2026-10-01T00:00:00Z"),
      renovadaEm: o.renovadaEm ?? null,
      erro: o.erro ?? null,
    })
    .returning();
  return linha;
}

function pedidoDeExclusao(signed: string | null): NextRequest {
  return new NextRequest("http://localhost:3000/api/meta/exclusao", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: signed === null ? "" : new URLSearchParams({ signed_request: signed }).toString(),
  });
}

function signedRequest(userId: string, segredo = SEGREDO_DO_APP): string {
  const corpo = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: 1 }), "utf8").toString("base64url");
  return `${createHmac("sha256", segredo).update(corpo).digest("base64url")}.${corpo}`;
}

beforeAll(async () => {
  await resetarSchema(db());
  config.metaConexao.appId = "1078374371332982";
  config.metaConexao.appSecret = SEGREDO_DO_APP;
  config.metaConexao.loginConfigId = "config-da-suite";
  config.metaConexao.tokenChave = Buffer.alloc(32, 11).toString("base64");
  config.metaConexao.redirectUri = "http://localhost:3000/api/meta/retorno";
  config.metaConexao.ativa = true;

  const [nicho] = await db().insert(nichos).values({ slug: "conta-conectada-teste", nome: "Conta conectada teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "cc-dono-a", name: "Dono A", email: "cc-dono-a@exemplo.teste", role: "cliente" },
    { id: "cc-membro-a", name: "Membro A", email: "cc-membro-a@exemplo.teste", role: "cliente" },
    { id: "cc-dono-b", name: "Dono B", email: "cc-dono-b@exemplo.teste", role: "cliente" },
    { id: "cc-dono-c", name: "Dono C", email: "cc-dono-c@exemplo.teste", role: "cliente" },
    { id: "cc-fora", name: "Fora", email: "cc-fora@exemplo.teste", role: "cliente" },
    { id: "cc-admin", name: "Admin", email: "cc-admin@exemplo.teste", role: "admin" },
  ]);
  const perfis = (instagram: string) => ({ instagram, tiktok: null, youtube: null });
  const [a] = await db().insert(clientes).values({ usuarioId: "cc-dono-a", nome: "[teste] Marca A", nichoId: nicho.id, perfis: perfis("@ContaA") }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "cc-dono-b", nome: "[teste] Marca B", nichoId: nicho.id, perfis: perfis("contab") }).returning();
  const [c] = await db().insert(clientes).values({ usuarioId: "cc-dono-c", nome: "[teste] Marca C", nichoId: nicho.id, perfis: perfis("contac") }).returning();
  marcaA = a.id;
  marcaB = b.id;
  marcaC = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "cc-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "cc-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "cc-dono-b", clienteId: marcaB, papel: "dono" },
    { usuarioId: "cc-dono-c", clienteId: marcaC, papel: "dono" },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(metricasVideoCliente);
  await db().delete(videosCliente);
  await db().delete(contasConectadas);
  await db().delete(exclusoesMeta);
  mockFetch.mockReset();
  chamadas.length = 0;
  estado.logs.length = 0;
  estado.emails.length = 0;
  estado.falharEmail = false;
  estado.sessao = null;
  estado.verComo = false;
  config.metaConexao.ativa = true;
  config.metaConexao.appSecret = SEGREDO_DO_APP;
});

afterEach(() => {
  // Em nenhum teste um token pode ter ido parar em log nem em e-mail.
  const tudo = JSON.stringify([estado.logs, estado.emails]);
  for (const token of TOKENS) expect(tudo, `o token ${token} apareceu em log ou e-mail`).not.toContain(token);
});

afterAll(async () => {
  await getPool().end();
});

// ---------------------------------------------------------------------------
// O começo
// ---------------------------------------------------------------------------

describe("iniciarLigacao", () => {
  it("o dono recebe o endereco do dialogo da Meta com o state assinado", async () => {
    const r = await iniciarLigacao("cc-dono-a", marcaA);
    expect("url" in r).toBe(true);
    if (!("url" in r)) return;
    const url = new URL(r.url);
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("state")).toBe(r.state);
    expect(url.searchParams.get("config_id")).toBe("config-da-suite");
  });

  it("quem so e membro (nao dono), quem nao e da marca e o dono de outra marca sao recusados", async () => {
    expect(await iniciarLigacao("cc-membro-a", marcaA)).toEqual({ recusa: "sem-acesso" });
    expect(await iniciarLigacao("cc-fora", marcaA)).toEqual({ recusa: "sem-acesso" });
    expect(await iniciarLigacao("cc-dono-b", marcaA)).toEqual({ recusa: "sem-acesso" });
  });

  it("com a ligacao desligada no ambiente (faltam os dados do aplicativo), recusa", async () => {
    config.metaConexao.ativa = false;
    expect(await iniciarLigacao("cc-dono-a", marcaA)).toEqual({ recusa: "nao-configurada" });
  });
});

// ---------------------------------------------------------------------------
// A volta
// ---------------------------------------------------------------------------

describe("concluirLigacao: o caminho feliz", () => {
  it("troca o codigo pelo token curto, depois pelo de longa duracao, confere as permissoes, acha a conta e a liga, com o token CIFRADO", async () => {
    instalarMeta({ longo: "EAA-LONGO-A", expiresIn: 5183944 });
    const agora = new Date("2026-10-22T12:00:00Z");

    const r = await concluirLigacao(volta("cc-dono-a", marcaA, {}, agora), agora);

    expect(r).toEqual({ resultado: "ligada" });
    // A ordem das chamadas: codigo, longa duracao, permissoes, usuario, contas. O token curto so vai na troca; o longo, nas demais.
    expect(chamadas.map((c) => c.caminho)).toEqual(["oauth/access_token", "oauth/access_token", "me/permissions", "me", "me/accounts"]);
    expect(chamadas[0].parametros).toMatchObject({ code: "codigo-da-meta", client_secret: SEGREDO_DO_APP, redirect_uri: "http://localhost:3000/api/meta/retorno" });
    expect(chamadas[1].parametros).toMatchObject({ grant_type: "fb_exchange_token", fb_exchange_token: TOKEN_CURTO });
    for (const c of chamadas.slice(2)) expect(c.parametros.access_token).toBe("EAA-LONGO-A");

    const [linha] = await linhas();
    expect(linha).toMatchObject({ clienteId: marcaA, plataforma: "instagram", contaId: "ig-a", nome: "contaa", paginaId: "pg-a", paginaNome: "Pagina A", metaUsuarioId: "meta-pessoa-a", estado: "ativa", conectadoPor: "cc-dono-a" });
    expect(linha.tokenExpiraEm?.getTime()).toBe(agora.getTime() + 5183944 * 1000);
    // O token no banco e o texto cifrado: nao contem o token, nem o curto, e so decifra para a mesma dona.
    expect(linha.tokenCifrado).not.toContain("EAA-LONGO-A");
    expect(linha.tokenCifrado).not.toContain(TOKEN_CURTO);
    expect(linha.tokenCifrado.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(linha)).not.toContain("EAA-LONGO-A");
    expect((await contaParaLeitura(marcaA, agora))?.token).toBe("EAA-LONGO-A");
  });

  it("a Meta nao diz a validade: a validade fica nula (nao se inventa)", async () => {
    instalarMeta({ expiresIn: null });
    await concluirLigacao(volta("cc-dono-a", marcaA));
    const [linha] = await linhas();
    expect(linha.tokenExpiraEm).toBeNull();
  });

  it("ligar de novo (mesma marca) troca a conta e o token: so existe uma ativa por marca, e o token antigo some", async () => {
    instalarMeta({ longo: "EAA-LONGO-A" });
    await concluirLigacao(volta("cc-dono-a", marcaA));
    instalarMeta({ longo: "EAA-LONGO-NOVO", contas: [{ pageId: "pg-n", pageName: "Pagina Nova", igId: "ig-novo", username: "contanova" }] });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "ligada" });
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0].contaId).toBe("ig-novo");
    expect((await contaParaLeitura(marcaA))?.token).toBe("EAA-LONGO-NOVO");
  });

  it("a conta ligada aparece para a marca sem o token, e para mais ninguem", async () => {
    instalarMeta();
    await concluirLigacao(volta("cc-dono-a", marcaA));
    const vista = await contaLigadaDaMarca(marcaA);
    expect(vista).toMatchObject({ contaId: "ig-a", nome: "contaa", paginaNome: "Pagina A", erro: null });
    expect(Object.keys(vista ?? {})).not.toContain("tokenCifrado");
    expect(JSON.stringify(vista)).not.toContain("v1.");
    expect(await contaLigadaDaMarca(marcaB)).toBeNull();
    expect(await contaLigadaDaMarca(marcaC)).toBeNull();
  });
});

describe("concluirLigacao: o que recusa antes de falar com a Meta", () => {
  it("sem o cookie do navegador (quem nao abriu o dialogo aqui), recusa e nao chama a Meta", async () => {
    instalarMeta();
    const r = await concluirLigacao(volta("cc-dono-a", marcaA, { stateDoCookie: null }));
    expect(r).toEqual({ resultado: "sem-acesso" });
    expect(aMetaFoiChamada()).toBe(false);
    expect(await linhas()).toHaveLength(0);
  });

  it("state de outra tentativa no cookie recusa", async () => {
    instalarMeta();
    const outro = criarState({ c: marcaA, u: "cc-dono-a" });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA, { stateDoCookie: outro }))).toEqual({ resultado: "sem-acesso" });
    expect(aMetaFoiChamada()).toBe(false);
  });

  it("state inventado (sem a assinatura) recusa", async () => {
    instalarMeta();
    const falso = `${Buffer.from(JSON.stringify({ c: marcaA, u: "cc-dono-a", n: "x", e: Date.now() + 1e6 })).toString("base64url")}.${"0".repeat(64)}`;
    expect(await concluirLigacao(volta("cc-dono-a", marcaA, { state: falso, stateDoCookie: falso }))).toEqual({ resultado: "sem-acesso" });
    expect(aMetaFoiChamada()).toBe(false);
  });

  it("state vencido (mais de dez minutos) diz que venceu", async () => {
    instalarMeta();
    const criado = new Date("2026-10-22T12:00:00Z");
    const depois = new Date(criado.getTime() + VALIDADE_DO_STATE_MS + 1000);
    expect(await concluirLigacao(volta("cc-dono-a", marcaA, {}, criado), depois)).toEqual({ resultado: "venceu" });
    expect(aMetaFoiChamada()).toBe(false);
  });

  it("outra pessoa na sessao (o state foi aberto pelo dono, a volta chega pela sessao de outro) recusa", async () => {
    instalarMeta();
    const state = criarState({ c: marcaA, u: "cc-dono-a" });
    const r = await concluirLigacao({ codigo: "c", erroDaMeta: null, state, stateDoCookie: state, usuarioId: "cc-dono-b" });
    expect(r).toEqual({ resultado: "sem-acesso" });
    expect(aMetaFoiChamada()).toBe(false);
    expect(await linhas()).toHaveLength(0);
  });

  it("sem sessao recusa", async () => {
    instalarMeta();
    expect(await concluirLigacao(volta(null, marcaA))).toEqual({ resultado: "sem-acesso" });
    expect(aMetaFoiChamada()).toBe(false);
  });

  it("quem abriu o dialogo mas nao e mais dono da marca (ou nunca foi) recusa", async () => {
    instalarMeta();
    // O state e legitimo (assinado, igual ao cookie, da propria sessao), mas a pessoa e so membro da marca.
    expect(await concluirLigacao(volta("cc-membro-a", marcaA))).toEqual({ resultado: "sem-acesso" });
    // E o dono de B nao liga na marca A, mesmo com o state da A assinado em nome dele.
    expect(await concluirLigacao(volta("cc-dono-b", marcaA))).toEqual({ resultado: "sem-acesso" });
    expect(aMetaFoiChamada()).toBe(false);
    expect(await linhas()).toHaveLength(0);
  });

  it("ligacao desligada no ambiente recusa", async () => {
    config.metaConexao.ativa = false;
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "nao-configurada" });
  });
});

describe("concluirLigacao: o que a Meta devolve", () => {
  it("a pessoa cancelou: diz que cancelou, nao troca nada e nao grava", async () => {
    instalarMeta();
    const r = await concluirLigacao(volta("cc-dono-a", marcaA, { codigo: null, erroDaMeta: "access_denied" }));
    expect(r).toEqual({ resultado: "cancelou" });
    expect(aMetaFoiChamada()).toBe(false);
    expect(await linhas()).toHaveLength(0);
  });

  it("sem codigo (e sem erro) falha, sem chamar a Meta", async () => {
    instalarMeta();
    expect(await concluirLigacao(volta("cc-dono-a", marcaA, { codigo: null }))).toEqual({ resultado: "falhou" });
    expect(aMetaFoiChamada()).toBe(false);
  });

  it("faltou uma das quatro permissoes: recusa, e nada e gravado", async () => {
    instalarMeta({ permissoesLiberadas: ["instagram_basic", "pages_show_list", "pages_read_engagement"] });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "permissao" });
    expect(await linhas()).toHaveLength(0);
  });

  it("E56: a permissao de publicar nao e exigida para ligar, mas fica guardada: sem ela a conta liga (so le), com ela a conta guarda que pode publicar", async () => {
    instalarMeta();
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "ligada" });
    expect((await linhas())[0].publicarLiberado).toBe(false);
    expect((await contaLigadaDaMarca(marcaA))?.publicarLiberado).toBe(false);

    instalarMeta({ permissoesLiberadas: [...TODAS_AS_PERMISSOES, "instagram_content_publish"] });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "ligada" });
    expect((await linhas())[0].publicarLiberado).toBe(true);
    expect((await contaLigadaDaMarca(marcaA))?.publicarLiberado).toBe(true);
  });

  it("E56: a candidata escolhida entre varias herda se a pessoa liberou a publicacao", async () => {
    instalarMeta({
      permissoesLiberadas: [...TODAS_AS_PERMISSOES, "instagram_content_publish"],
      contas: [
        { pageId: "pg-1", pageName: "Pagina 1", igId: "ig-1", username: "outra1" },
        { pageId: "pg-2", pageName: "Pagina 2", igId: "ig-2", username: "outra2" },
      ],
    });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "escolher" });
    expect((await linhas()).every((l) => l.publicarLiberado)).toBe(true);
    await escolherConta("cc-dono-a", marcaA, "ig-2");
    const [ativa] = await linhas();
    expect(ativa).toMatchObject({ contaId: "ig-2", estado: "ativa", publicarLiberado: true });
  });

  it("nenhuma Pagina com Instagram profissional ligado: avisa", async () => {
    instalarMeta({ contas: [] });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "sem-instagram" });
    expect(await linhas()).toHaveLength(0);
  });

  it("a Meta recusa a troca do codigo, a troca por longa duracao ou qualquer etapa: falha, nada gravado, e o log nao leva token", async () => {
    for (const etapa of ["codigo", "longo", "usuario", "permissoes", "contas"] as const) {
      mockFetch.mockReset();
      instalarMeta({ erro: { etapa, codigo: 190 } });
      expect(await concluirLigacao(volta("cc-dono-a", marcaA)), etapa).toEqual({ resultado: "falhou" });
      expect(await linhas(), etapa).toHaveLength(0);
    }
  });

  it("a Meta ecoa o codigo e o token na mensagem de erro: o log guarda a frase sem eles", async () => {
    mockFetch.mockImplementation(async (entrada: URL | string) => {
      const url = new URL(String(entrada));
      if (url.searchParams.get("grant_type") !== "fb_exchange_token") return json({ access_token: TOKEN_CURTO, expires_in: 3600 });
      return json({ error: { message: `Invalid token ${TOKEN_CURTO} for code codigo-da-meta`, code: 190 } }, 400);
    });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "falhou" });
    const log = JSON.stringify(estado.logs);
    expect(log).toContain("[oculto]");
    expect(log).not.toContain(TOKEN_CURTO);
    expect(log).not.toContain("codigo-da-meta");
  });

  it("falha de rede: falha sem gravar", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "falhou" });
    expect(await linhas()).toHaveLength(0);
  });

  it("o Instagram ja esta ligado a OUTRA marca: recusa, e a ligacao da outra continua intacta", async () => {
    instalarMeta({ longo: "EAA-LONGO-B", metaUsuario: "meta-pessoa-b", contas: [{ pageId: "pg-x", pageName: "X", igId: "ig-compartilhada", username: "contab" }] });
    expect(await concluirLigacao(volta("cc-dono-b", marcaB))).toEqual({ resultado: "ligada" });
    instalarMeta({ longo: "EAA-LONGO-A", metaUsuario: "meta-pessoa-a", contas: [{ pageId: "pg-x", pageName: "X", igId: "ig-compartilhada", username: "contab" }] });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "ja-ligada" });
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0].clienteId).toBe(marcaB);
    expect((await contaParaLeitura(marcaB))?.token).toBe("EAA-LONGO-B");
    expect(await contaParaLeitura(marcaA)).toBeNull();
  });
});

describe("concluirLigacao: mais de uma conta nas Paginas liberadas", () => {
  const duas: ContaMeta[] = [
    { pageId: "pg-1", pageName: "Pagina 1", igId: "ig-1", username: "contaa" },
    { pageId: "pg-2", pageName: "Pagina 2", igId: "ig-2", username: "outraconta" },
  ];

  it("uma delas bate com o Instagram da marca (sem '@' nem caixa): liga essa", async () => {
    instalarMeta({ contas: duas });
    expect(await concluirLigacao(volta("cc-dono-a", marcaA))).toEqual({ resultado: "ligada" });
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({ contaId: "ig-1", estado: "ativa" });
  });

  it("nenhuma bate: guarda as duas como candidatas (token cifrado), nenhuma ativa, e a curva ainda nao le", async () => {
    instalarMeta({ longo: "EAA-LONGO-C", contas: duas });
    expect(await concluirLigacao(volta("cc-dono-c", marcaC))).toEqual({ resultado: "escolher" });
    const todas = await linhas();
    expect(todas.map((l) => [l.contaId, l.estado]).sort()).toEqual([
      ["ig-1", "escolher"],
      ["ig-2", "escolher"],
    ]);
    expect(todas.every((l) => !l.tokenCifrado.includes("EAA-LONGO-C"))).toBe(true);
    expect(await contaLigadaDaMarca(marcaC)).toBeNull();
    expect(await contaParaLeitura(marcaC)).toBeNull();
    expect((await candidatasDaMarca(marcaC)).map((c) => c.contaId)).toEqual(["ig-1", "ig-2"]);
  });

  it("escolher: a escolhida vira ativa e a outra some; so o dono escolhe; escolher conta que nao e candidata nao faz nada", async () => {
    instalarMeta({ longo: "EAA-LONGO-C", contas: duas });
    await concluirLigacao(volta("cc-dono-c", marcaC));

    expect(await escolherConta("cc-membro-a", marcaC, "ig-2")).toEqual({ resultado: "sem-acesso" });
    expect(await escolherConta("cc-dono-a", marcaC, "ig-2")).toEqual({ resultado: "sem-acesso" });
    expect(await escolherConta("cc-dono-c", marcaC, "ig-que-nao-veio")).toEqual({ resultado: "venceu" });
    expect((await linhas()).every((l) => l.estado === "escolher")).toBe(true);

    expect(await escolherConta("cc-dono-c", marcaC, "ig-2")).toEqual({ resultado: "ligada" });
    const todas = await linhas();
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({ contaId: "ig-2", estado: "ativa" });
    expect((await contaParaLeitura(marcaC))?.token).toBe("EAA-LONGO-C");
  });

  it("a escolha vence em 30 minutos", async () => {
    instalarMeta({ contas: duas });
    const agora = new Date("2026-10-22T12:00:00Z");
    await concluirLigacao(volta("cc-dono-c", marcaC, {}, agora), agora);
    const depois = new Date(agora.getTime() + VALIDADE_DA_ESCOLHA_MS + 1000);
    expect(await candidatasDaMarca(marcaC, depois)).toHaveLength(0);
    expect(await escolherConta("cc-dono-c", marcaC, "ig-1", depois)).toEqual({ resultado: "venceu" });
  });

  it("as candidatas de uma marca nunca aparecem para outra", async () => {
    instalarMeta({ contas: duas });
    await concluirLigacao(volta("cc-dono-c", marcaC));
    expect(await candidatasDaMarca(marcaA)).toHaveLength(0);
    expect(await candidatasDaMarca(marcaB)).toHaveLength(0);
    // E o dono de outra marca nao escolhe a conta candidata da marca C.
    expect(await escolherConta("cc-dono-b", marcaC, "ig-1")).toEqual({ resultado: "sem-acesso" });
  });
});

// ---------------------------------------------------------------------------
// Desligar
// ---------------------------------------------------------------------------

describe("desligar", () => {
  it("apaga a linha inteira, o token junto; so da marca da pessoa", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A" });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B" });
    expect(await desligarConta("cc-dono-a", marcaA)).toEqual({ ok: true, apagadas: 1 });
    const restantes = await linhas();
    expect(restantes.map((l) => l.clienteId)).toEqual([marcaB]);
    expect(await contaParaLeitura(marcaA)).toBeNull();
    expect((await contaParaLeitura(marcaB))?.token).toBe("EAA-LONGO-B");
  });

  it("quem nao e dono nao desliga (membro, de fora, dono de outra marca): nada e apagado", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A" });
    for (const quem of ["cc-membro-a", "cc-fora", "cc-dono-b"]) {
      expect(await desligarConta(quem, marcaA), quem).toEqual({ ok: false, apagadas: 0 });
    }
    expect(await linhas()).toHaveLength(1);
  });

  it("a acao do painel: o dono desliga pela sessao; o 'ver como' nunca; sem sessao nao", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A" });

    estado.verComo = true;
    entrar("cc-dono-a");
    expect((await desligarInstagramAction()).ok).toBe(false);
    expect(await linhas()).toHaveLength(1);

    estado.verComo = false;
    entrar(null);
    expect((await desligarInstagramAction()).ok).toBe(false);
    expect(await linhas()).toHaveLength(1);

    entrar("cc-membro-a");
    expect((await desligarInstagramAction()).ok).toBe(false);
    expect(await linhas()).toHaveLength(1);

    entrar("cc-dono-a");
    expect(await desligarInstagramAction()).toEqual({ ok: true, dado: { apagadas: 1 } });
    expect(await linhas()).toHaveLength(0);
  });

  it("a acao de escolher: o 'ver como' nunca, e o dono escolhe pela sessao", async () => {
    instalarMeta({ contas: [{ pageId: "p1", pageName: "P1", igId: "ig-1", username: "x1" }, { pageId: "p2", pageName: "P2", igId: "ig-2", username: "x2" }] });
    await concluirLigacao(volta("cc-dono-c", marcaC));
    estado.verComo = true;
    entrar("cc-dono-c");
    expect((await escolherInstagramAction("ig-1")).ok).toBe(false);
    estado.verComo = false;
    expect(await escolherInstagramAction("ig-1")).toEqual({ ok: true, dado: { contaId: "ig-1" } });
    expect((await linhas()).map((l) => l.estado)).toEqual(["ativa"]);
  });
});

// ---------------------------------------------------------------------------
// Isolamento entre marcas
// ---------------------------------------------------------------------------

describe("isolamento entre marcas", () => {
  it("cada marca le o seu proprio acesso; a que nao ligou nao recebe nada; o token de uma nunca sai pela outra", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A" });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B" });
    expect(await contaParaLeitura(marcaA)).toMatchObject({ igId: "ig-a", token: "EAA-LONGO-A" });
    expect(await contaParaLeitura(marcaB)).toMatchObject({ igId: "ig-b", token: "EAA-LONGO-B" });
    expect(await contaParaLeitura(marcaC)).toBeNull();
    expect(await contaLigadaDaMarca(marcaC)).toBeNull();
    expect((await contaLigadaDaMarca(marcaA))?.contaId).toBe("ig-a");
    expect((await contaLigadaDaMarca(marcaB))?.contaId).toBe("ig-b");
  });

  it("valor cifrado copiado da linha de uma marca para a de outra NAO decifra (o contexto amarra o token a marca e a conta)", async () => {
    const a = await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A" });
    const b = await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B" });
    // Alguem (ou um bug) copia o token cifrado de A para a linha de B.
    await db().update(contasConectadas).set({ tokenCifrado: a.tokenCifrado }).where(eq(contasConectadas.id, b.id));
    expect(await contaParaLeitura(marcaB)).toBeNull();
    const [depois] = await db().select().from(contasConectadas).where(eq(contasConectadas.id, b.id));
    expect(depois.erro).toBe(textosLigacao.erroDaConta.ilegivel);
    // A de A continua lendo normalmente.
    expect((await contaParaLeitura(marcaA))?.token).toBe("EAA-LONGO-A");
  });

  it("sem a ligacao configurada neste processo (falta a chave), a conta nao e lida e, principalmente, NAO e marcada com erro; com a chave de volta, volta a ler", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A" });
    config.metaConexao.ativa = false;
    expect(await contaParaLeitura(marcaA)).toBeNull();
    expect((await linhas())[0].erro).toBeNull();
    config.metaConexao.ativa = true;
    expect((await contaParaLeitura(marcaA))?.token).toBe("EAA-LONGO-A");
  });

  it("a mesma conta do Instagram nao fica ativa em duas marcas (indice unico)", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-comum", token: "EAA-LONGO-A" });
    await expect(inserirAtiva({ clienteId: marcaB, contaId: "ig-comum", token: "EAA-LONGO-B" })).rejects.toThrow();
  });

  it("conta vencida nao e lida; acesso que a Meta ja recusou so volta a ser tentado depois de ligar de novo", async () => {
    const agora = new Date("2026-10-22T12:00:00Z");
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: new Date(agora.getTime() - 1000) });
    expect(await contaParaLeitura(marcaA, agora)).toBeNull();
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B", erro: textosLigacao.erroDaConta.recusada });
    expect(await contaParaLeitura(marcaB, agora)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A renovação
// ---------------------------------------------------------------------------

describe("renovarContasLigadas", () => {
  const agora = new Date("2026-10-22T06:20:00Z");
  const em = (dias: number) => new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);

  it("renova a que vence em menos de 15 dias (a mesma troca por longa duracao, com o token atual), troca o token e a validade; nao mexe na que ainda tem folga", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: em(10) });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B", expiraEm: em(40) });
    instalarMeta({ longo: "EAA-RENOVADO", expiresIn: 5183944 });

    const resumo = await renovarContasLigadas(agora);

    expect(resumo).toMatchObject({ avaliadas: 1, renovadas: 1, falhas: 0, avisos: 0 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].parametros).toMatchObject({ grant_type: "fb_exchange_token", fb_exchange_token: "EAA-LONGO-A" });
    expect((await contaParaLeitura(marcaA, agora))?.token).toBe("EAA-RENOVADO");
    const [a] = (await linhas()).filter((l) => l.clienteId === marcaA);
    expect(a.tokenExpiraEm?.getTime()).toBe(agora.getTime() + 5183944 * 1000);
    expect(a.renovadaEm?.getTime()).toBe(agora.getTime());
    expect((await contaParaLeitura(marcaB, agora))?.token).toBe("EAA-LONGO-B");
  });

  it("sem validade conhecida, renova a cada 30 dias", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: null, conectadaEm: em(-31) });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B", expiraEm: null, conectadaEm: em(-31), renovadaEm: em(-2) });
    instalarMeta({ longo: "EAA-RENOVADO", expiresIn: null });
    const resumo = await renovarContasLigadas(agora);
    expect(resumo.renovadas).toBe(1);
    expect((await contaParaLeitura(marcaA, agora))?.token).toBe("EAA-RENOVADO");
    expect((await contaParaLeitura(marcaB, agora))?.token).toBe("EAA-LONGO-B");
  });

  it("a Meta recusa o acesso (190): guarda a frase de ligar de novo, avisa o DONO por e-mail uma vez so, e a curva para de tentar essa conta", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: em(10) });
    instalarMeta({ erro: { etapa: "longo", codigo: 190 } });

    const primeira = await renovarContasLigadas(agora);
    expect(primeira).toMatchObject({ falhas: 1, avisos: 1, renovadas: 0 });
    const [linha] = await linhas();
    expect(linha.erro).toBe(textosLigacao.erroDaConta.recusada);
    expect(linha.avisadaEm).not.toBeNull();
    expect(estado.emails).toHaveLength(1);
    expect(estado.emails[0].para).toBe("cc-dono-a@exemplo.teste");
    expect(estado.emails[0].assunto).toBe(textosLigacao.emailAviso.assunto);
    expect(estado.emails[0].html).toContain("[teste] Marca A");
    expect(await contaParaLeitura(marcaA, agora)).toBeNull();

    // No dia seguinte nao tenta de novo (a Meta ja disse que nao vale) e nao manda de novo.
    mockFetch.mockClear();
    const segunda = await renovarContasLigadas(new Date(agora.getTime() + 24 * 60 * 60 * 1000));
    expect(segunda).toMatchObject({ avaliadas: 0, avisos: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(estado.emails).toHaveLength(1);
  });

  it("falha passageira (rede) com muita folga: guarda a frase mas NAO avisa ainda; falha com menos de 7 dias: avisa", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: em(12) });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B", expiraEm: em(5) });
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    const resumo = await renovarContasLigadas(agora);
    expect(resumo).toMatchObject({ falhas: 2, avisos: 1 });
    const porMarca = new Map((await linhas()).map((l) => [l.clienteId, l]));
    expect(porMarca.get(marcaA)?.erro).toBe(textosLigacao.erroDaConta.naoRenovou);
    expect(porMarca.get(marcaA)?.avisadaEm).toBeNull();
    expect(porMarca.get(marcaB)?.avisadaEm).not.toBeNull();
    expect(estado.emails.map((e) => e.para)).toEqual(["cc-dono-b@exemplo.teste"]);
    // Uma conta que ainda nao foi recusada pela Meta continua legivel para a curva (a falha foi so da renovacao).
    expect((await contaParaLeitura(marcaA, agora))?.token).toBe("EAA-LONGO-A");
  });

  it("conta que ja venceu: guarda 'venceu', avisa uma vez, nao tenta renovar (token vencido nao troca)", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: em(-1) });
    instalarMeta();
    const resumo = await renovarContasLigadas(agora);
    expect(resumo).toMatchObject({ avaliadas: 1, renovadas: 0, avisos: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
    const [linha] = await linhas();
    expect(linha.erro).toBe(textosLigacao.erroDaConta.venceu);
  });

  it("o e-mail de aviso que falha desfaz a marca (nao fica 'avisada' sem ter sido), e no dia seguinte tenta de novo", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: em(-1) });
    estado.falharEmail = true;
    const primeira = await renovarContasLigadas(agora);
    expect(primeira.avisos).toBe(0);
    expect((await linhas())[0].avisadaEm).toBeNull();

    estado.falharEmail = false;
    const segunda = await renovarContasLigadas(new Date(agora.getTime() + 24 * 60 * 60 * 1000));
    expect(segunda.avisos).toBe(1);
    expect((await linhas())[0].avisadaEm).not.toBeNull();
    expect(estado.emails).toHaveLength(1);
  });

  it("apaga as candidatas que ninguem escolheu em 30 minutos", async () => {
    instalarMeta({ contas: [{ pageId: "p1", pageName: "P1", igId: "ig-1", username: "x1" }, { pageId: "p2", pageName: "P2", igId: "ig-2", username: "x2" }] });
    const comeco = new Date("2026-10-22T05:00:00Z");
    await concluirLigacao(volta("cc-dono-c", marcaC, {}, comeco), comeco);
    expect(await linhas()).toHaveLength(2);
    const resumo = await renovarContasLigadas(agora);
    expect(resumo.candidatasApagadas).toBe(2);
    expect(await linhas()).toHaveLength(0);
  });

  it("com a ligacao desligada no ambiente (sem a chave) nao tenta decifrar nem marca erro", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: em(1) });
    config.metaConexao.ativa = false;
    const resumo = await renovarContasLigadas(agora);
    expect(resumo.avaliadas).toBe(0);
    expect((await linhas())[0].erro).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A exclusão de dados
// ---------------------------------------------------------------------------

describe("o aviso de exclusao de dados da Meta", () => {
  async function criarVideoComMedidas(clienteId: number, idExterno: string) {
    const [video] = await db().insert(videosCliente).values({ clienteId, plataforma: "instagram", url: `https://www.instagram.com/reel/${idExterno}/`, idExterno, metaMediaId: `media-${idExterno}` }).returning();
    await db().insert(metricasVideoCliente).values([
      { videoClienteId: video.id, views: 10, fonte: "meta" },
      { videoClienteId: video.id, views: 20, fonte: "apify" },
    ]);
    return video;
  }

  it("apaga a ligacao (e o token) de quem pediu e as medidas lidas pela Meta das marcas dele; nao toca na outra marca nem nas medidas do Apify", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", metaUsuarioId: "meta-pessoa-a" });
    await inserirAtiva({ clienteId: marcaB, contaId: "ig-b", token: "EAA-LONGO-B", metaUsuarioId: "meta-pessoa-b" });
    const videoA = await criarVideoComMedidas(marcaA, "CA");
    const videoB = await criarVideoComMedidas(marcaB, "CB");

    const r = await tratarExclusaoDaMeta(signedRequest("meta-pessoa-a"));

    expect(r?.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect(r?.url).toBe(`${config.appUrl}/dados/exclusao?codigo=${r?.confirmation_code}`);
    expect((await linhas()).map((l) => l.clienteId)).toEqual([marcaB]);
    const medidas = await db().select().from(metricasVideoCliente);
    expect(medidas.filter((m) => m.videoClienteId === videoA.id).map((m) => m.fonte)).toEqual(["apify"]);
    expect(medidas.filter((m) => m.videoClienteId === videoB.id).map((m) => m.fonte).sort()).toEqual(["apify", "meta"]);
    const [va] = await db().select().from(videosCliente).where(eq(videosCliente.id, videoA.id));
    const [vb] = await db().select().from(videosCliente).where(eq(videosCliente.id, videoB.id));
    expect(va.metaMediaId).toBeNull();
    expect(vb.metaMediaId).toBe("media-CB");
    expect(await statusDaExclusao(r!.confirmation_code)).toMatchObject({ ligacoesApagadas: 1 });
  });

  it("pessoa sem ligacao: atende do mesmo jeito (codigo, nada a apagar) e nao mexe em ninguem", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", metaUsuarioId: "meta-pessoa-a" });
    const r = await tratarExclusaoDaMeta(signedRequest("meta-desconhecida"));
    expect(r).not.toBeNull();
    expect(await linhas()).toHaveLength(1);
    expect(await statusDaExclusao(r!.confirmation_code)).toMatchObject({ ligacoesApagadas: 0 });
  });

  it("assinatura que nao bate: nao atende, nao apaga, nao registra pedido", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", metaUsuarioId: "meta-pessoa-a" });
    expect(await tratarExclusaoDaMeta(signedRequest("meta-pessoa-a", "segredo-de-outro"))).toBeNull();
    expect(await tratarExclusaoDaMeta(null)).toBeNull();
    expect(await tratarExclusaoDaMeta("lixo")).toBeNull();
    expect(await linhas()).toHaveLength(1);
    expect(await db().select().from(exclusoesMeta)).toHaveLength(0);
  });

  it("o status so responde por codigo no formato certo e que existe", async () => {
    expect(await statusDaExclusao("abc")).toBeNull();
    expect(await statusDaExclusao("0123456789abcdef")).toBeNull();
    expect(await statusDaExclusao("' or 1=1 --")).toBeNull();
  });

  it("a rota: 200 com url e confirmation_code; 400 com assinatura errada ou sem signed_request; 503 sem o segredo do aplicativo", async () => {
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", metaUsuarioId: "meta-pessoa-a" });

    const ruim = await exclusao(pedidoDeExclusao(signedRequest("meta-pessoa-a", "outro-segredo")));
    expect(ruim.status).toBe(400);
    expect(await linhas()).toHaveLength(1);

    const sem = await exclusao(pedidoDeExclusao(null));
    expect(sem.status).toBe(400);

    const certo = await exclusao(pedidoDeExclusao(signedRequest("meta-pessoa-a")));
    expect(certo.status).toBe(200);
    const corpo = (await certo.json()) as { url: string; confirmation_code: string };
    expect(corpo.url).toContain("/dados/exclusao?codigo=");
    expect(corpo.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect(await linhas()).toHaveLength(0);

    config.metaConexao.appSecret = "";
    const semSegredo = await exclusao(pedidoDeExclusao(signedRequest("meta-pessoa-a")));
    expect(semSegredo.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// As rotas do começo e da volta
// ---------------------------------------------------------------------------

describe("as rotas /api/meta/conectar e /api/meta/retorno", () => {
  function pedidoDeRetorno(consulta: Record<string, string>, cookieDeState?: string): NextRequest {
    const url = new URL("http://localhost:3000/api/meta/retorno");
    for (const [k, v] of Object.entries(consulta)) url.searchParams.set(k, v);
    return new NextRequest(url, { headers: cookieDeState ? { cookie: `${NOME_COOKIE_STATE_META}=${encodeURIComponent(cookieDeState)}` } : {} });
  }

  it("conectar: o dono e levado ao dialogo da Meta, com o cookie do state (HttpOnly, SameSite=Lax, so em /api/meta)", async () => {
    entrar("cc-dono-a");
    const r = await conectar();
    expect(r.status).toBe(307);
    const destino = new URL(r.headers.get("location")!);
    expect(destino.hostname).toBe("www.facebook.com");
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toContain(`${NOME_COOKIE_STATE_META}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/api/meta");
    // O state do endereco e o do cookie.
    expect(decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="))).toBe(destino.searchParams.get("state"));
  });

  it("conectar: sem sessao vai para /entrar; o membro (nao dono) e o 'ver como' voltam a /conta com 'sem-acesso' e sem cookie", async () => {
    entrar(null);
    expect(new URL((await conectar()).headers.get("location")!).pathname).toBe("/entrar");

    entrar("cc-membro-a");
    const membro = await conectar();
    expect(new URL(membro.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    expect(membro.headers.get("set-cookie")).toBeNull();

    entrar("cc-dono-a");
    estado.verComo = true;
    const verComo = await conectar();
    expect(new URL(verComo.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");
    expect(verComo.headers.get("set-cookie")).toBeNull();
  });

  it("conectar: com a ligacao desligada no ambiente volta a /conta com 'nao-configurada'", async () => {
    entrar("cc-dono-a");
    config.metaConexao.ativa = false;
    const r = await conectar();
    expect(new URL(r.headers.get("location")!).searchParams.get("instagram")).toBe("nao-configurada");
  });

  it("retorno: state e cookie certos, sessao certa: liga, volta a /conta?instagram=ligada e apaga o cookie", async () => {
    instalarMeta();
    entrar("cc-dono-a");
    const state = criarState({ c: marcaA, u: "cc-dono-a" });
    const r = await retorno(pedidoDeRetorno({ code: "codigo-da-meta", state }, state));
    const destino = new URL(r.headers.get("location")!);
    expect(destino.pathname).toBe("/conta");
    expect(destino.searchParams.get("instagram")).toBe("ligada");
    expect(r.headers.get("set-cookie")).toContain(`${NOME_COOKIE_STATE_META}=;`);
    expect((await linhas())[0]).toMatchObject({ clienteId: marcaA, contaId: "ig-a" });
    // O destino nunca repete o codigo nem o token.
    expect(destino.toString()).not.toContain("codigo-da-meta");
  });

  it("retorno: sem o cookie, ou pela sessao de outra pessoa, ou no 'ver como': nao liga", async () => {
    instalarMeta();
    const state = criarState({ c: marcaA, u: "cc-dono-a" });

    entrar("cc-dono-a");
    const semCookie = await retorno(pedidoDeRetorno({ code: "c", state }));
    expect(new URL(semCookie.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");

    entrar("cc-dono-b");
    const outraPessoa = await retorno(pedidoDeRetorno({ code: "c", state }, state));
    expect(new URL(outraPessoa.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");

    entrar("cc-dono-a");
    estado.verComo = true;
    const verComo = await retorno(pedidoDeRetorno({ code: "c", state }, state));
    expect(new URL(verComo.headers.get("location")!).searchParams.get("instagram")).toBe("sem-acesso");

    expect(aMetaFoiChamada()).toBe(false);
    expect(await linhas()).toHaveLength(0);
  });

  it("retorno: a pessoa cancelou na Meta (error=access_denied) volta com 'cancelou'", async () => {
    entrar("cc-dono-a");
    const state = criarState({ c: marcaA, u: "cc-dono-a" });
    const r = await retorno(pedidoDeRetorno({ error: "access_denied", error_reason: "user_denied", state }, state));
    expect(new URL(r.headers.get("location")!).searchParams.get("instagram")).toBe("cancelou");
  });
});

// ---------------------------------------------------------------------------
// O portão da cobrança (E22) nas rotas e ações da conta ligada
// ---------------------------------------------------------------------------

describe("o portao da cobranca (COBRANCA_ATIVA)", () => {
  const cobrancaOriginal = config.cobranca.ativa;
  beforeEach(() => {
    config.cobranca.ativa = true;
  });
  afterEach(async () => {
    config.cobranca.ativa = cobrancaOriginal;
    await db().update(clientes).set({ cortesia: false });
  });

  it("conectar: marca sem assinatura e sem cortesia recebe 402 e nenhum cookie; com cortesia segue para o dialogo", async () => {
    entrar("cc-dono-a");
    const barrada = await conectar();
    expect(barrada.status).toBe(402);
    expect(barrada.headers.get("set-cookie")).toBeNull();

    await db().update(clientes).set({ cortesia: true }).where(eq(clientes.id, marcaA));
    const liberada = await conectar();
    expect(liberada.status).toBe(307);
    expect(new URL(liberada.headers.get("location")!).hostname).toBe("www.facebook.com");
  });

  it("escolher e barrada (vai para /assinar); desligar NUNCA e barrada: apagar o acesso e da pessoa, pague ou nao", async () => {
    instalarMeta({ contas: [{ pageId: "p1", pageName: "P1", igId: "ig-1", username: "x1" }, { pageId: "p2", pageName: "P2", igId: "ig-2", username: "x2" }] });
    config.cobranca.ativa = false;
    await concluirLigacao(volta("cc-dono-c", marcaC));
    config.cobranca.ativa = true;
    entrar("cc-dono-c");
    await expect(escolherInstagramAction("ig-1")).rejects.toThrow();
    expect((await linhas()).every((l) => l.estado === "escolher")).toBe(true);

    expect(await desligarInstagramAction()).toEqual({ ok: true, dado: { apagadas: 2 } });
    expect(await linhas()).toHaveLength(0);
  });

  it("o retorno da Meta e a exclusao de dados continuam funcionando sem assinatura (livres, com motivo no verificador)", async () => {
    instalarMeta();
    entrar("cc-dono-a");
    const state = criarState({ c: marcaA, u: "cc-dono-a" });
    const url = new URL("http://localhost:3000/api/meta/retorno");
    url.searchParams.set("code", "c");
    url.searchParams.set("state", state);
    const r = await retorno(new NextRequest(url, { headers: { cookie: `${NOME_COOKIE_STATE_META}=${encodeURIComponent(state)}` } }));
    expect(new URL(r.headers.get("location")!).searchParams.get("instagram")).toBe("ligada");

    const e = await exclusao(pedidoDeExclusao(signedRequest("meta-pessoa-a")));
    expect(e.status).toBe(200);
    expect(await linhas()).toHaveLength(0);
  });

  it("a renovacao continua para marca sem assinatura (a ligacao nao se perde num mes sem pagar)", async () => {
    const agora = new Date("2026-10-22T06:20:00Z");
    await inserirAtiva({ clienteId: marcaA, contaId: "ig-a", token: "EAA-LONGO-A", expiraEm: new Date(agora.getTime() + 5 * 24 * 60 * 60 * 1000) });
    instalarMeta({ longo: "EAA-RENOVADO" });
    const resumo = await renovarContasLigadas(agora);
    expect(resumo.renovadas).toBe(1);
    expect((await contaParaLeitura(marcaA, agora))?.token).toBe("EAA-RENOVADO");
  });
});
