/**
 * E22 PR 2, o item 0 do comentário do #185, contra o Postgres local e sem rede (a porta do Stripe é a simulada):
 *  (a) o portão também nas Server Actions e nas rotas /api (não só no layout), e nada muda com a cobrança desligada;
 *  (b) um Checkout aberto por marca;
 *  (d) apagar uma marca cancela a assinatura no Stripe antes, e se o Stripe falhar a marca fica.
 * O item (c), a configuração própria do portal, é do adaptador do Stripe e está em `src/lib/stripe-porta-real.test.ts` e `scripts/stripe-preparar.test.ts`.
 */
import { count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

import { db, getPool } from "@/db";
import { assinaturas, briefings, checkoutsStripe, clientes, geracoesIA, membrosMarca, nichos, user } from "@/db/schema";
import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { chamadasSimuladas, fecharSessaoSimulada, limparSessoesSimuladas, usarPortaStripe, type PortaStripe } from "@/lib/stripe";
import { ErroAssinatura, frasesDaAssinatura, iniciarAssinatura, tratarEventoDoStripe } from "@/servicos/assinatura";
import { apagarMarca, ErroApagarMarca } from "@/servicos/apagar-marca";

import { resetarSchema } from "../../scripts/resetar-schema";
import { eventoDeAssinatura, SEGUNDOS } from "../fixtures/stripe-eventos";

const { salvarRedePrincipalAction } = await import("@/app/(painel)/(completo)/hoje/acoes");
const { gerarVersoesAction } = await import("@/app/(painel)/(completo)/criar/objetivo/acoes");
const { avaliarTemaAction } = await import("@/app/(painel)/(completo)/criar/tema-livre/acoes");
const { gerarRoteiroMomentoAction } = await import("@/app/(painel)/(completo)/hoje/momento/acoes");
const { pedirPesquisaAction } = await import("@/app/(painel)/(completo)/criar/pesquisa/acoes");
const { avaliarRespostaAction: avaliarRespostaDoBriefing } = await import("@/app/(painel)/(completo)/briefing/acoes");
const { reprovarERescreverAction } = await import("@/app/(painel)/(completo)/roteiros/[id]/acoes");
const { favoritarAction } = await import("@/app/(painel)/(completo)/referencias/acoes");
const { salvarRascunhoAction: salvarRascunhoDoOnboarding } = await import("@/app/comecar/acoes");
const { organizarFalaBriefingAction } = await import("@/app/(painel)/_briefing/acoes");
const { POST: transcrever } = await import("@/app/api/transcrever/route");
const { GET: pdf } = await import("@/app/api/roteiros/[id]/pdf/route");
const { GET: imagem } = await import("@/app/api/roteiros/[id]/imagem/route");
const { GET: clientePorId } = await import("@/app/api/clientes/[id]/route");

let marcaA: number; // dono as-t-dono-a
let marcaB: number; // dono as-t-dono-b
let marcaC: number; // dono as-t-dono-c, briefing incompleto

const agoraS = () => Math.floor(Date.now() / 1000);

function sessaoDe(id: string) {
  return { user: { id, role: "cliente", email: `${id}@exemplo.teste`, name: id }, session: { id: `s-${id}`, userId: id } } as never;
}
function entrarComo(id: string) {
  vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(id));
}
/** O erro de redirecionamento do Next carrega o destino no `digest`. */
function ehRedirectParaAssinar(erro: unknown): boolean {
  const digest = (erro as { digest?: string } | null)?.digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") && digest.includes("/assinar");
}
async function resultado(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    (v) => v,
    (e) => e,
  );
}
async function darAssinaturaQueVale(clienteId: number, assinaturaId: string) {
  await tratarEventoDoStripe(
    eventoDeAssinatura("customer.subscription.created", { clienteId, assinaturaId, clienteStripeId: `cus_${assinaturaId}`, criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 90 * SEGUNDOS.DIA }),
  );
}
async function gastosDeIA(): Promise<number> {
  const [r] = await db().select({ n: count() }).from(geracoesIA);
  return r.n;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "travas-teste", nome: "Travas teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "as-t-dono-a", name: "Dono A", email: "as-t-dono-a@exemplo.teste", role: "cliente" },
    { id: "as-t-dono-b", name: "Dono B", email: "as-t-dono-b@exemplo.teste", role: "cliente" },
    { id: "as-t-dono-c", name: "Dono C", email: "as-t-dono-c@exemplo.teste", role: "cliente" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "as-t-dono-a", nome: "[teste] Travas A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "as-t-dono-b", nome: "[teste] Travas B", nichoId: nicho.id }).returning();
  const [c] = await db().insert(clientes).values({ usuarioId: "as-t-dono-c", nome: "[teste] Travas C", nichoId: nicho.id }).returning();
  marcaA = a.id;
  marcaB = b.id;
  marcaC = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "as-t-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "as-t-dono-b", clienteId: marcaB, papel: "dono" },
    { usuarioId: "as-t-dono-c", clienteId: marcaC, papel: "dono" },
  ]);
  // A e B têm o briefing completo (passaram do onboarding); C ainda está nele.
  await db().insert(briefings).values([
    { clienteId: marcaA, completo: true },
    { clienteId: marcaB, completo: true },
    { clienteId: marcaC, completo: false },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(checkoutsStripe);
  await db().delete(assinaturas);
  await db().update(clientes).set({ cortesia: false });
  limparSessoesSimuladas();
  chamadasSimuladas.length = 0;
  usarPortaStripe();
  entrarComo("as-t-dono-a");
});

afterEach(() => {
  config.cobranca.ativa = false;
  usarPortaStripe();
});

afterAll(async () => {
  await getPool().end();
});

// ---------------------------------------------------------------------------
// (a) o portão nas Server Actions e nas rotas
// ---------------------------------------------------------------------------

/** As ações do painel completo que gastam IA, pesquisa ou transcrição, chamadas com argumentos de mentira: o portão tem de recusar ANTES de olhar os argumentos. */
const ACOES_QUE_GASTAM: Array<[string, () => Promise<unknown>]> = [
  ["gerarVersoesAction (roteiro)", () => gerarVersoesAction("tema_livre" as never, "alcance" as never)],
  ["avaliarTemaAction (nota do tema)", () => avaliarTemaAction("um tema qualquer")],
  ["gerarRoteiroMomentoAction (roteiro do momento)", () => gerarRoteiroMomentoAction({} as never)],
  ["pedirPesquisaAction (pesquisa na hora)", () => pedirPesquisaAction({} as never)],
  ["avaliarRespostaAction do Briefing (nota da resposta)", () => avaliarRespostaDoBriefing("p1", "uma resposta")],
  ["reprovarERescreverAction (reescrever o roteiro)", () => reprovarERescreverAction(1, [] as never)],
  ["organizarFalaBriefingAction (IA sobre a fala)", () => organizarFalaBriefingAction("p1", "texto falado")],
  ["avaliarRespostaAction do onboarding, com o briefing completo", () => avaliarRespostaDoBriefing("p1", "x")],
];

describe("(a) a cobrança ligada: a marca sem assinatura é barrada nas Server Actions antes de gastar", () => {
  beforeEach(() => {
    config.cobranca.ativa = true;
  });

  for (const [nome, chamar] of ACOES_QUE_GASTAM) {
    it(`${nome} leva para /assinar e não gasta IA`, async () => {
      const antes = await gastosDeIA();
      const r = await resultado(chamar());
      expect(ehRedirectParaAssinar(r), String(r)).toBe(true);
      expect(await gastosDeIA()).toBe(antes);
    });
  }

  it("as ações do onboarding (/comecar) são barradas quando o briefing já está completo", async () => {
    const r = await resultado(salvarRascunhoDoOnboarding("p1", "texto"));
    expect(ehRedirectParaAssinar(r)).toBe(true);
  });

  it("a marca com o briefing incompleto segue no onboarding sem assinar (a pessoa vê valor antes de pagar)", async () => {
    entrarComo("as-t-dono-c");
    const r = await resultado(salvarRascunhoDoOnboarding("p1", "texto"));
    expect(ehRedirectParaAssinar(r)).toBe(false);
  });

  it("uma ação de leitura livre (a espera do roteiro) não é barrada", async () => {
    const { roteiroRecenteDesdeAction } = await import("@/app/(painel)/(completo)/hoje/acoes");
    await expect(roteiroRecenteDesdeAction(Date.now())).resolves.toBeNull();
  });

  it("com assinatura que vale, segue", async () => {
    await darAssinaturaQueVale(marcaA, "sub_vale");
    await expect(salvarRedePrincipalAction("instagram")).resolves.toBeUndefined();
  });

  it("com cortesia, segue", async () => {
    await db().update(clientes).set({ cortesia: true }).where(eq(clientes.id, marcaA));
    await expect(salvarRedePrincipalAction("instagram")).resolves.toBeUndefined();
  });

  it("a assinatura de uma marca não libera a outra", async () => {
    await darAssinaturaQueVale(marcaA, "sub_so_a");
    entrarComo("as-t-dono-b");
    expect(ehRedirectParaAssinar(await resultado(salvarRedePrincipalAction("instagram")))).toBe(true);
  });

  it("assinatura vencida (cancelada) volta a ser barrada", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marcaA, assinaturaId: "sub_acabou", criadoEm: agoraS() }));
    expect(ehRedirectParaAssinar(await resultado(salvarRedePrincipalAction("instagram")))).toBe(true);
  });

  it("uma ação que só marca favorito também é barrada (a regra vale para o painel inteiro, não só para o que gasta)", async () => {
    expect(ehRedirectParaAssinar(await resultado(favoritarAction(1)))).toBe(true);
  });
});

describe("(a) a cobrança desligada: nada muda para quem usa hoje", () => {
  it("as mesmas ações, na marca sem assinatura, não vão para /assinar", async () => {
    expect(config.cobranca.ativa).toBe(false);
    for (const [nome, chamar] of ACOES_QUE_GASTAM) {
      const r = await resultado(chamar());
      expect(ehRedirectParaAssinar(r), nome).toBe(false);
    }
    await expect(salvarRedePrincipalAction("instagram")).resolves.toBeUndefined();
    expect(ehRedirectParaAssinar(await resultado(salvarRascunhoDoOnboarding("p1", "texto")))).toBe(false);
  });
});

function pedidoDeAudio(): NextRequest {
  // Corpo que não é formulário: se o portão deixar passar, a rota responde 400 por causa do corpo, nunca 402.
  return new NextRequest("http://localhost:3000/api/transcrever", { method: "POST", body: "nao e um formulario", headers: { "content-type": "text/plain" } });
}
const paramsDoRoteiro = { params: Promise.resolve({ id: "999999" }) };

describe("(a) as rotas /api do painel", () => {
  it("com a cobrança ligada e sem assinatura: transcrição, PDF, imagem e dados da marca respondem 402, e a frase explica", async () => {
    config.cobranca.ativa = true;
    const respostas = [
      await transcrever(pedidoDeAudio()),
      await pdf(new Request("http://localhost:3000/api/roteiros/999999/pdf"), paramsDoRoteiro),
      await imagem(new Request("http://localhost:3000/api/roteiros/999999/imagem"), paramsDoRoteiro),
      await clientePorId(new Request("http://localhost:3000/api/clientes/1"), { params: Promise.resolve({ id: String(marcaA) }) }),
    ];
    for (const r of respostas) {
      expect(r.status).toBe(402);
      expect((await r.json()).erro).toMatch(/assinatura/i);
    }
  });

  it("com assinatura que vale, as rotas seguem para o que sempre fizeram", async () => {
    config.cobranca.ativa = true;
    await darAssinaturaQueVale(marcaA, "sub_rotas");
    expect((await transcrever(pedidoDeAudio())).status).toBe(400);
    expect((await pdf(new Request("http://localhost:3000/api/roteiros/999999/pdf"), paramsDoRoteiro)).status).toBe(404);
    expect((await clientePorId(new Request("http://localhost:3000/api/clientes/1"), { params: Promise.resolve({ id: String(marcaA) }) })).status).toBe(200);
  });

  it("a transcrição do briefing em andamento (antes do pagamento) segue livre mesmo com a cobrança ligada", async () => {
    config.cobranca.ativa = true;
    entrarComo("as-t-dono-c");
    expect((await transcrever(pedidoDeAudio())).status).toBe(400);
  });

  it("com a cobrança desligada, as rotas respondem como sempre (400, 404 e 200), nunca 402", async () => {
    expect(config.cobranca.ativa).toBe(false);
    expect((await transcrever(pedidoDeAudio())).status).toBe(400);
    expect((await pdf(new Request("http://localhost:3000/api/roteiros/999999/pdf"), paramsDoRoteiro)).status).toBe(404);
    expect((await imagem(new Request("http://localhost:3000/api/roteiros/999999/imagem"), paramsDoRoteiro)).status).toBe(404);
    expect((await clientePorId(new Request("http://localhost:3000/api/clientes/1"), { params: Promise.resolve({ id: String(marcaA) }) })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// (b) um Checkout aberto por marca
// ---------------------------------------------------------------------------

describe("(b) um Checkout aberto por marca", () => {
  const donoA = { id: "as-t-dono-a", email: "as-t-dono-a@exemplo.teste" };
  const donoB = { id: "as-t-dono-b", email: "as-t-dono-b@exemplo.teste" };
  const criacoes = () => chamadasSimuladas.filter((c) => c.metodo === "criarCheckout").length;

  it("o segundo clique reaproveita a sessão aberta do primeiro: o mesmo endereço, uma só sessão criada", async () => {
    const primeiro = await iniciarAssinatura(donoA, { id: marcaA });
    const segundo = await iniciarAssinatura(donoA, { id: marcaA });
    expect(segundo.url).toBe(primeiro.url);
    expect(criacoes()).toBe(1);
    expect(await db().select().from(checkoutsStripe)).toHaveLength(1);
  });

  it("dois cliques ao mesmo tempo (duas abas) também criam uma sessão só", async () => {
    const [x, y, z] = await Promise.all([iniciarAssinatura(donoA, { id: marcaA }), iniciarAssinatura(donoA, { id: marcaA }), iniciarAssinatura(donoA, { id: marcaA })]);
    expect(new Set([x.url, y.url, z.url]).size).toBe(1);
    expect(criacoes()).toBe(1);
  });

  it("sessão que já não está aberta (paga, expirada) não é reaproveitada: abre outra e a marca guarda a nova", async () => {
    const primeiro = await iniciarAssinatura(donoA, { id: marcaA });
    const [guardada] = await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, marcaA));
    fecharSessaoSimulada(guardada.stripeSessaoId);
    const segundo = await iniciarAssinatura(donoA, { id: marcaA });
    expect(segundo.url).not.toBe(primeiro.url);
    expect(criacoes()).toBe(2);
    const linhas = await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, marcaA));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].stripeSessaoId).not.toBe(guardada.stripeSessaoId);
  });

  it("cada marca tem a sua sessão: a de uma nunca é entregue à outra", async () => {
    const a = await iniciarAssinatura(donoA, { id: marcaA });
    const b = await iniciarAssinatura(donoB, { id: marcaB });
    expect(a.url).not.toBe(b.url);
    expect(criacoes()).toBe(2);
  });

  it("se a sessão guardada for de outra marca (dado estragado), não é entregue: abre uma nova", async () => {
    const b = await iniciarAssinatura(donoB, { id: marcaB });
    const [daB] = await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, marcaB));
    await db().insert(checkoutsStripe).values({ clienteId: marcaA, stripeSessaoId: daB.stripeSessaoId });
    const a = await iniciarAssinatura(donoA, { id: marcaA });
    expect(a.url).not.toBe(b.url);
  });

  it("só o dono começa, e quem já tem assinatura que vale não abre sessão nenhuma", async () => {
    await darAssinaturaQueVale(marcaA, "sub_b");
    await expect(iniciarAssinatura(donoA, { id: marcaA })).rejects.toThrow(frasesDaAssinatura.jaAssinada);
    expect(criacoes()).toBe(0);
  });

  it("o Stripe falhar ao criar não deixa linha guardada", async () => {
    const porta: PortaStripe = {
      precoDoPlano: async () => ({ id: "price_x" }),
      criarCheckout: async () => {
        throw new Error("rede caiu");
      },
      sessaoAberta: async () => null,
      expirarSessao: async () => undefined,
      criarPortal: async () => ({ url: "x" }),
      cancelarAssinatura: async () => undefined,
    };
    usarPortaStripe(porta);
    await expect(iniciarAssinatura(donoA, { id: marcaA })).rejects.toBeInstanceOf(ErroAssinatura);
    expect(await db().select().from(checkoutsStripe)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (d) apagar a marca cancela a assinatura antes
// ---------------------------------------------------------------------------

describe("(d) apagar uma marca com assinatura cancela no Stripe antes", () => {
  let nichoId: number;
  let n = 0;

  /** Uma marca nova, sem nenhum histórico (o banco só deixa apagar assim), com o dono. */
  async function marcaDescartavel(): Promise<number> {
    n += 1;
    const [x] = await db().select({ id: nichos.id }).from(nichos).limit(1);
    nichoId = x.id;
    const [m] = await db().insert(clientes).values({ nome: `[teste] Descartavel ${n}`, nichoId }).returning();
    return m.id;
  }

  it("cancela cada assinatura que ainda não acabou, fecha o Checkout aberto, e só então apaga a marca", async () => {
    const id = await marcaDescartavel();
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: id, assinaturaId: "sub_viva", clienteStripeId: "cus_d", criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 90 * SEGUNDOS.DIA }));
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: id, assinaturaId: "sub_velha", clienteStripeId: "cus_d", criadoEm: agoraS() }));
    await db().insert(checkoutsStripe).values({ clienteId: id, stripeSessaoId: "cs_aberta_da_marca" });
    chamadasSimuladas.length = 0;

    const r = await apagarMarca(id);

    expect(r.assinaturasCanceladas).toBe(1);
    // A ordem importa: o Checkout aberto fecha primeiro, depois a assinatura; a já cancelada não é tocada de novo.
    expect(chamadasSimuladas.map((c) => `${c.metodo}:${String(c.pedido)}`)).toEqual(["expirarSessao:cs_aberta_da_marca", "cancelarAssinatura:sub_viva"]);
    expect(await db().select().from(clientes).where(eq(clientes.id, id))).toHaveLength(0);
    expect(await db().select().from(assinaturas).where(eq(assinaturas.clienteId, id))).toHaveLength(0);
  });

  it("se o Stripe falhar, a marca NÃO é apagada e a assinatura continua registrada", async () => {
    const id = await marcaDescartavel();
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: id, assinaturaId: "sub_teimosa", clienteStripeId: "cus_t", criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 90 * SEGUNDOS.DIA }));
    const porta: PortaStripe = {
      precoDoPlano: async () => null,
      criarCheckout: async () => ({ url: "x", sessaoId: "y" }),
      sessaoAberta: async () => null,
      expirarSessao: async () => undefined,
      criarPortal: async () => ({ url: "x" }),
      cancelarAssinatura: async () => {
        throw new Error("Stripe fora do ar");
      },
    };
    usarPortaStripe(porta);

    const erro = await apagarMarca(id).catch((e) => e);

    expect(erro).toBeInstanceOf(ErroAssinatura);
    expect(erro.message).toBe(frasesDaAssinatura.naoCancelou);
    expect(await db().select().from(clientes).where(eq(clientes.id, id))).toHaveLength(1);
    expect(await db().select().from(assinaturas).where(eq(assinaturas.clienteId, id))).toHaveLength(1);
  });

  it("marca com histórico que o banco protege (briefing): o banco recusa e NADA é cancelado no Stripe", async () => {
    const id = await marcaDescartavel();
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: id, assinaturaId: "sub_com_historico", clienteStripeId: "cus_h", criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 90 * SEGUNDOS.DIA }));
    await db().insert(briefings).values({ clienteId: id, completo: true });
    chamadasSimuladas.length = 0;

    await expect(apagarMarca(id)).rejects.toThrow();

    expect(chamadasSimuladas.filter((c) => c.metodo === "cancelarAssinatura")).toHaveLength(0);
    expect(await db().select().from(clientes).where(eq(clientes.id, id))).toHaveLength(1);
  });

  it("marca que nunca assinou: apaga sem falar com o Stripe nenhuma vez", async () => {
    const id = await marcaDescartavel();
    chamadasSimuladas.length = 0;
    const r = await apagarMarca(id);
    expect(r.assinaturasCanceladas).toBe(0);
    expect(chamadasSimuladas).toHaveLength(0);
    expect(await db().select().from(clientes).where(eq(clientes.id, id))).toHaveLength(0);
  });

  it("marca que não existe: erro claro, nada chamado", async () => {
    await expect(apagarMarca(987654)).rejects.toBeInstanceOf(ErroApagarMarca);
    expect(chamadasSimuladas).toHaveLength(0);
  });
});
