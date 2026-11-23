/**
 * E63 PR 1: o cadastro sozinho, no servidor. Contra o Postgres local, sem rede e sem e-mail de verdade (fora de produção o e-mail cai no log). A chave `CADASTRO_ABERTO` liga e desliga
 * dentro de cada teste.
 */
import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

import { LIMITES_DO_CADASTRO, TETO_DO_TESTE } from "@/config/cadastro";
import { RAMOS_DO_CATALOGO } from "@/config/ramos";
import { db, getPool } from "@/db";
import { assinaturas, cadastrosProprios, clientes, confirmacoesDeEmail, edicoes, geracoesIA, membrosMarca, nichos, preferenciasUsuario, roteiros, setoresDeCadastro, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { criarLimitador } from "@/lib/limite-de-taxa";
import { cadastrarConta, confirmarEmail, reenviarConfirmacao } from "@/servicos/cadastro";
import { barreiraDoCadastro } from "@/servicos/cadastro-travas";
import { criarMarca, darAcesso, ErroCliente, salvarDadosFixosComPedido } from "@/servicos/clientes";
import { ErroLimiteDeSetores, setorParaAMarca } from "@/servicos/ramos";
import { roteirosDoCliente } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  process.env.CADASTRO_ABERTO = "1";
});

afterEach(() => {
  delete process.env.CADASTRO_ABERTO;
  vi.restoreAllMocks();
});

let sequencia = 0;
/** Um cadastro bom, com e-mail novo a cada chamada. */
function dadosBons(sobre: Record<string, unknown> = {}) {
  sequencia += 1;
  return { nome: "Ana Souza", negocio: `Padaria ${sequencia}`, email: `ana${sequencia}@cadastro.teste`, senha: "SenhaBoa123", aceite: true, ...sobre };
}
/** Sem trava por IP, para os testes que não são do limite. */
const opcoes = () => ({ ip: "1.1.1.1", limitador: criarLimitador({ janelaMs: 1000, maximo: 10_000 }), avisar: async () => undefined });

async function criar(sobre: Record<string, unknown> = {}) {
  const dados = dadosBons(sobre);
  const r = await cadastrarConta(dados, opcoes());
  if (!r.ok) throw new Error(`cadastro recusado: ${JSON.stringify(r)}`);
  return { ...r, dados };
}

/** O código do link, lido do e-mail simulado no log. */
async function codigoDoEmail(acao: () => Promise<unknown>): Promise<string> {
  const textos: string[] = [];
  vi.spyOn(console, "log").mockImplementation((m: unknown) => void textos.push(String(m)));
  await acao();
  const tudo = textos.join("\n");
  const achado = /codigo=([A-Za-z0-9_-]+)/.exec(tudo);
  if (!achado) throw new Error("o e-mail de confirmar nao saiu");
  return achado[1];
}

describe("com a chave desligada nada muda", () => {
  it("o cadastro responde fechado e nenhum usuário nasce", async () => {
    delete process.env.CADASTRO_ABERTO;
    const r = await cadastrarConta(dadosBons({ email: "fechado@cadastro.teste" }), opcoes());
    expect(r).toEqual({ ok: false, motivo: "fechado" });
    expect(await db().select().from(user).where(eq(user.email, "fechado@cadastro.teste"))).toHaveLength(0);
  });

  it("qualquer valor que não seja 1 também fecha", async () => {
    process.env.CADASTRO_ABERTO = "true";
    expect(await cadastrarConta(dadosBons(), opcoes())).toEqual({ ok: false, motivo: "fechado" });
  });

  it("o endpoint do better-auth continua fechado mesmo com a chave ligada", async () => {
    const r = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "direto@cadastro.teste", password: "SenhaBoa123", name: "Direto" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await db().select().from(user).where(eq(user.email, "direto@cadastro.teste"))).toHaveLength(0);
  });
});

describe("criar a conta", () => {
  it("nasce a conta, a marca, a dona como única membro, os termos aceitos com a versão e o e-mail por confirmar", async () => {
    const avisar = vi.fn(async () => undefined);
    const dados = dadosBons({ email: "Maria@Cadastro.Teste", negocio: "Doces da Maria" });
    const r = await cadastrarConta(dados, { ...opcoes(), avisar });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [u] = await db().select().from(user).where(eq(user.id, r.usuarioId));
    expect(u).toMatchObject({ email: "maria@cadastro.teste", name: "Ana Souza", emailVerified: false, role: "cliente" });
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, r.clienteId));
    expect(marca.nome).toBe("Doces da Maria");
    expect(await db().select().from(membrosMarca).where(eq(membrosMarca.clienteId, r.clienteId))).toMatchObject([{ usuarioId: r.usuarioId, papel: "dono" }]);
    const [pref] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, r.usuarioId));
    expect(pref.aceitouTermosEm).toBeInstanceOf(Date);
    const [cad] = await db().select().from(cadastrosProprios).where(eq(cadastrosProprios.usuarioId, r.usuarioId));
    expect(cad.termosVersao).toMatch(/^2026-/);
    // O aviso ao admin leva só o nome do negócio e o e-mail.
    expect(avisar).toHaveBeenCalledWith("Doces da Maria", "maria@cadastro.teste");
  });

  it("a senha escolhida entra pelo login de sempre", async () => {
    const { dados } = await criar();
    const r = await auth.api.signInEmail({ body: { email: dados.email, password: dados.senha }, headers: new Headers() });
    expect(r.user.email).toBe(dados.email);
  });

  it("recusa o que é inválido, campo a campo, sem criar nada", async () => {
    const r = await cadastrarConta({ nome: "", negocio: "", email: "nao-e-email", senha: "curta", aceite: false }, opcoes());
    expect(r).toMatchObject({ ok: false, motivo: "campos" });
    if (r.ok || r.motivo !== "campos") return;
    expect(Object.keys(r.erros).sort()).toEqual(["aceite", "email", "negocio", "nome", "senha"]);
  });

  it("recusa o e-mail descartável", async () => {
    const r = await cadastrarConta(dadosBons({ email: "alguem@mailinator.com" }), opcoes());
    expect(r).toMatchObject({ ok: false, motivo: "campos", erros: { email: expect.stringContaining("temporário") } });
    expect(await db().select().from(user).where(eq(user.email, "alguem@mailinator.com"))).toHaveLength(0);
  });

  it("o mesmo e-mail não cria duas contas, nem com outra caixa", async () => {
    const { dados } = await criar({ email: "unico@cadastro.teste" });
    expect(await cadastrarConta(dadosBons({ email: dados.email }), opcoes())).toEqual({ ok: false, motivo: "jaExiste" });
    expect(await cadastrarConta(dadosBons({ email: "UNICO@cadastro.teste" }), opcoes())).toEqual({ ok: false, motivo: "jaExiste" });
    const [{ total }] = await db().select({ total: count() }).from(user).where(eq(user.email, "unico@cadastro.teste"));
    expect(total).toBe(1);
  });

  it("dois pedidos ao mesmo tempo com o mesmo e-mail criam uma conta só", async () => {
    const email = "corrida@cadastro.teste";
    const resultados = await Promise.all([cadastrarConta(dadosBons({ email }), opcoes()), cadastrarConta(dadosBons({ email }), opcoes())]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, motivo: "jaExiste" }]);
    const [{ total }] = await db().select({ total: count() }).from(user).where(eq(user.email, email));
    expect(total).toBe(1);
    // E a conta perdedora não deixou marca solta: o que a transação desfez não existe.
    const donos = await db().select().from(cadastrosProprios);
    const marcasDeCadastro = await db().select({ id: clientes.id }).from(clientes).innerJoin(cadastrosProprios, eq(cadastrosProprios.clienteId, clientes.id));
    expect(marcasDeCadastro.length).toBe(donos.length);
  });

  it("limita os pedidos por IP", async () => {
    const limitador = criarLimitador(LIMITES_DO_CADASTRO.porIp);
    const ip = "9.9.9.9";
    for (let i = 0; i < LIMITES_DO_CADASTRO.porIp.maximo; i += 1) {
      const r = await cadastrarConta({ nome: "" }, { ip, limitador, avisar: async () => undefined });
      expect(r).toMatchObject({ motivo: "campos" });
    }
    expect(await cadastrarConta(dadosBons(), { ip, limitador, avisar: async () => undefined })).toEqual({ ok: false, motivo: "limite" });
    // Outro endereço não é afetado.
    expect(await cadastrarConta({ nome: "" }, { ip: "8.8.8.8", limitador, avisar: async () => undefined })).toMatchObject({ motivo: "campos" });
  });

  it("limita as contas novas por hora no sistema todo", async () => {
    const agora = new Date(Date.now() - 5 * 60 * 60 * 1000); // cinco horas atras: as contas do teste nao entram na hora de verdade dos outros testes
    for (let i = 0; i < LIMITES_DO_CADASTRO.contasPorHora; i += 1) {
      const dados = dadosBons();
      const [u] = await db().insert(user).values({ id: `hora-${i}-${sequencia}`, name: "Pessoa", email: dados.email, emailVerified: false }).returning();
      const marca = await criarMarca({ nome: `Hora ${i}`, nichoId: null });
      await db().insert(cadastrosProprios).values({ usuarioId: u.id, clienteId: marca.id, termosVersao: "x", criadoEm: agora });
    }
    expect(await cadastrarConta(dadosBons(), { ...opcoes(), agora })).toEqual({ ok: false, motivo: "cheio" });
  });
});

describe("o e-mail por confirmar", () => {
  it("sem confirmar, a marca está barrada; confirmado, passa", async () => {
    const { clienteId, usuarioId } = await criar();
    expect(await barreiraDoCadastro({ clienteId, cortesia: false })).toEqual({ tipo: "email" });
    // Cortesia não tira a trava do e-mail.
    expect(await barreiraDoCadastro({ clienteId, cortesia: true })).toEqual({ tipo: "email" });
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, usuarioId));
    expect(await barreiraDoCadastro({ clienteId, cortesia: false })).toBeNull();
  });

  it("o link confirma uma vez só", async () => {
    let usuarioId = "";
    const codigo = await codigoDoEmail(async () => {
      usuarioId = (await criar()).usuarioId;
    });
    expect(await confirmarEmail(codigo)).toEqual({ ok: true, usuarioId });
    const [u] = await db().select().from(user).where(eq(user.id, usuarioId));
    expect(u.emailVerified).toBe(true);
    expect(await confirmarEmail(codigo)).toEqual({ ok: false, motivo: "usado" });
  });

  it("dois cliques ao mesmo tempo confirmam uma vez", async () => {
    const codigo = await codigoDoEmail(async () => void (await criar()));
    const r = await Promise.all([confirmarEmail(codigo), confirmarEmail(codigo)]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });

  it("o link vence em 24 horas e um código errado não confirma nada", async () => {
    let usuarioId = "";
    const codigo = await codigoDoEmail(async () => {
      usuarioId = (await criar()).usuarioId;
    });
    const depoisDoPrazo = new Date(Date.now() + LIMITES_DO_CADASTRO.validadeDoLinkMs + 1000);
    expect(await confirmarEmail(codigo, depoisDoPrazo)).toEqual({ ok: false, motivo: "expirado" });
    expect(await confirmarEmail("codigo-que-nao-existe")).toEqual({ ok: false, motivo: "invalido" });
    expect(await confirmarEmail("")).toEqual({ ok: false, motivo: "invalido" });
    const [u] = await db().select().from(user).where(eq(user.id, usuarioId));
    expect(u.emailVerified).toBe(false);
  });

  it("o código não fica no banco, só o hash", async () => {
    const codigo = await codigoDoEmail(async () => void (await criar()));
    expect(await db().select().from(confirmacoesDeEmail).where(eq(confirmacoesDeEmail.codigoHash, codigo))).toHaveLength(0);
  });

  it("o reenvio espera um minuto e para no teto do dia", async () => {
    const { usuarioId } = await criar();
    const base = Date.now();
    // O primeiro envio foi o do cadastro, agora.
    expect(await reenviarConfirmacao(usuarioId, new Date(base + 10_000))).toEqual({ ok: false, motivo: "esperar" });
    let ultimo = base;
    // Quatro reenvios cabem (o do cadastro é o primeiro dos cinco), cada um um minuto depois.
    for (let i = 1; i < LIMITES_DO_CADASTRO.enviosPorDia; i += 1) {
      ultimo = base + i * 61_000;
      expect(await reenviarConfirmacao(usuarioId, new Date(ultimo))).toEqual({ ok: true });
    }
    expect(await reenviarConfirmacao(usuarioId, new Date(ultimo + 61_000))).toEqual({ ok: false, motivo: "limite" });
    // Um dia depois, volta a poder.
    expect(await reenviarConfirmacao(usuarioId, new Date(base + 25 * 60 * 60 * 1000))).toEqual({ ok: true });
  });

  it("quem já confirmou não recebe outro link", async () => {
    const { usuarioId } = await criar();
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, usuarioId));
    expect(await reenviarConfirmacao(usuarioId, new Date(Date.now() + 120_000))).toEqual({ ok: false, motivo: "jaConfirmado" });
  });
});

describe("quem já existe continua entrando", () => {
  it("a conta que o admin criou, com e-mail por confirmar, entra com a senha e não tem barreira nenhuma", async () => {
    const marca = await criarMarca({ nome: "Marca do admin", nichoId: null });
    const r = await darAcesso(marca.id, "Cliente Antigo", "antigo@cadastro.teste");
    expect(r.tipo).toBe("convite");
    if (r.tipo !== "convite") return;
    const [u] = await db().select().from(user).where(eq(user.email, "antigo@cadastro.teste"));
    expect(u.emailVerified).toBe(false);
    const entrou = await auth.api.signInEmail({ body: { email: "antigo@cadastro.teste", password: r.senha }, headers: new Headers() });
    expect(entrou.user.id).toBe(u.id);
    expect(await barreiraDoCadastro({ clienteId: marca.id, cortesia: false })).toBeNull();
    expect(await barreiraDoCadastro({ clienteId: marca.id, cortesia: false, gasto: "roteiro" })).toBeNull();
  });

  it("com a chave desligada, a conta de cadastro próprio que já existe continua barrada até confirmar", async () => {
    const { clienteId } = await criar();
    delete process.env.CADASTRO_ABERTO;
    expect(await barreiraDoCadastro({ clienteId, cortesia: false })).toEqual({ tipo: "email" });
  });

  it("o admin não dá acesso a um e-mail que criou conta sozinho e ainda não confirmou", async () => {
    const { dados } = await criar({ email: "pre-registrado@cadastro.teste" });
    const marca = await criarMarca({ nome: "Marca da vítima", nichoId: null });
    await expect(darAcesso(marca.id, "Vítima", dados.email)).rejects.toBeInstanceOf(ErroCliente);
    expect(await db().select().from(membrosMarca).where(eq(membrosMarca.clienteId, marca.id))).toHaveLength(0);
  });
});

describe("o teto do teste", () => {
  async function marcaConfirmada() {
    const { clienteId, usuarioId } = await criar();
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, usuarioId));
    return clienteId;
  }
  async function roteirosDe(clienteId: number, quantos: number) {
    await db()
      .insert(roteiros)
      .values(
        Array.from({ length: quantos }, () => ({
          clienteId,
          data: "2026-11-23",
          tema: "tema",
          origem: "livre" as const,
          objetivo: "engajamento" as const,
          conteudo: {} as never,
        })),
      );
  }

  it("10 roteiros: o décimo primeiro é barrado, o resto não", async () => {
    const id = await marcaConfirmada();
    await roteirosDe(id, TETO_DO_TESTE.roteiros - 1);
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false, gasto: "roteiro" })).toBeNull();
    await roteirosDe(id, 1);
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false, gasto: "roteiro" })).toEqual({ tipo: "teto", qual: "roteiros" });
    // Outra ação (sem ser criar roteiro) segue, e a edição também.
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false })).toBeNull();
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false, gasto: "edicao" })).toBeNull();
  });

  it("3 edições: a quarta é barrada; a que falhou não conta", async () => {
    const id = await marcaConfirmada();
    await roteirosDe(id, 1);
    const [roteiro] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.clienteId, id));
    const nova = (estado: "pronta" | "falhou") => ({ clienteId: id, roteiroId: roteiro.id, tamanhoBytes: 10, tipoDoArquivo: "video/mp4", estado });
    await db().insert(edicoes).values([nova("pronta"), nova("pronta"), nova("falhou")]);
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false, gasto: "edicao" })).toBeNull();
    await db().insert(edicoes).values(nova("pronta"));
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false, gasto: "edicao" })).toEqual({ tipo: "teto", qual: "edicoes" });
  });

  it("US$ 4 de IA no total: barra qualquer ação, e a transcrição das edições conta", async () => {
    const id = await marcaConfirmada();
    const gerar = (custo: string) => ({ tarefa: "teste", versaoPrompt: "1", modelo: "mock", clienteId: id, entradas: {}, custoUsd: custo });
    await db().insert(geracoesIA).values(gerar("3.500000"));
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false })).toBeNull();
    await db().insert(geracoesIA).values(gerar("0.500000"));
    expect(await barreiraDoCadastro({ clienteId: id, cortesia: false })).toEqual({ tipo: "teto", qual: "uso" });

    const outro = await marcaConfirmada();
    await roteirosDe(outro, 1);
    const [roteiro] = await db().select({ id: roteiros.id }).from(roteiros).where(eq(roteiros.clienteId, outro));
    await db().insert(edicoes).values({ clienteId: outro, roteiroId: roteiro.id, tamanhoBytes: 10, tipoDoArquivo: "video/mp4", estado: "pronta", custoTranscricaoUsd: "4.000000" });
    expect(await barreiraDoCadastro({ clienteId: outro, cortesia: false })).toEqual({ tipo: "teto", qual: "uso" });
  });

  it("a assinatura paga e a cortesia tiram o teto; o teste grátis (trialing) não", async () => {
    const paga = await marcaConfirmada();
    const teste = await marcaConfirmada();
    const cortesia = await marcaConfirmada();
    for (const id of [paga, teste, cortesia]) await roteirosDe(id, TETO_DO_TESTE.roteiros);
    const assinatura = (clienteId: number, status: "active" | "trialing") => ({
      clienteId,
      status,
      stripeClienteId: `cus_${clienteId}`,
      stripeAssinaturaId: `sub_${clienteId}`,
      ultimoEventoEm: new Date(),
    });
    await db().insert(assinaturas).values([assinatura(paga, "active"), assinatura(teste, "trialing")]);
    expect(await barreiraDoCadastro({ clienteId: paga, cortesia: false, gasto: "roteiro" })).toBeNull();
    expect(await barreiraDoCadastro({ clienteId: teste, cortesia: false, gasto: "roteiro" })).toEqual({ tipo: "teto", qual: "roteiros" });
    expect(await barreiraDoCadastro({ clienteId: cortesia, cortesia: true, gasto: "roteiro" })).toBeNull();
  });

  it("a marca nova não vê nada de outra marca", async () => {
    const a = await marcaConfirmada();
    const b = await marcaConfirmada();
    await roteirosDe(a, 2);
    expect(await roteirosDoCliente(b)).toHaveLength(0);
    expect(await roteirosDoCliente(a)).toHaveLength(2);
    // O teto de uma marca não conta o uso da outra.
    await roteirosDe(a, TETO_DO_TESTE.roteiros);
    expect(await barreiraDoCadastro({ clienteId: b, cortesia: false, gasto: "roteiro" })).toBeNull();
  });
});

describe("ramo novo de cadastro próprio", () => {
  /** Ramos do catálogo que ainda não têm setor. */
  async function ramosSemSetor(quantos: number): Promise<string[]> {
    const existentes = new Set((await db().select({ r: nichos.ramoCatalogo }).from(nichos)).map((n) => n.r));
    return RAMOS_DO_CATALOGO.filter((r) => !existentes.has(r.slug)).slice(0, quantos).map((r) => r.slug);
  }

  it("só os dois primeiros ramos novos do dia nascem; o terceiro espera o admin, e o admin não tem esse teto", async () => {
    const [um, dois, tres, quatro] = await ramosSemSetor(4);
    const marcas = [] as number[];
    for (let i = 0; i < 4; i += 1) marcas.push((await criar()).clienteId);

    await setorParaAMarca(null, um, marcas[0]);
    await setorParaAMarca(null, dois, marcas[1]);
    await expect(setorParaAMarca(null, tres, marcas[2])).rejects.toBeInstanceOf(ErroLimiteDeSetores);
    expect(await db().select().from(nichos).where(eq(nichos.ramoCatalogo, tres))).toHaveLength(0);
    expect(await db().select().from(setoresDeCadastro)).toHaveLength(LIMITES_DO_CADASTRO.ramosNovosPorDia);

    // Quem não é de cadastro próprio (conta do admin) segue pelo teto de sempre.
    const doAdmin = await criarMarca({ nome: "Do admin", nichoId: null });
    await expect(setorParaAMarca(null, quatro, doAdmin.id)).resolves.toMatchObject({ trocou: true });
    // Um ramo que já tem setor não gasta o teto: a marca de cadastro entra nele.
    await expect(setorParaAMarca(null, um, marcas[3])).resolves.toMatchObject({ trocou: true });
  });

  it("escolher da lista um ramo novo depois do teto vira pedido de ramo, e a pessoa lê que está sendo preparado", async () => {
    // O teto do dia já foi usado no teste anterior (as 24 horas contam do banco).
    const [livre] = await ramosSemSetor(1);
    const { clienteId } = await criar();
    const r = await salvarDadosFixosComPedido(clienteId, {
      nome: "Marca",
      alcance: "brasil",
      persona: "negocio",
      ramo: livre,
    });
    expect(r.limiteDeRamosNovos).toBe(true);
    expect(r.ramoEmPreparo).toBe(true);
    expect(r.cliente.nichoId).toBeNull();
    expect(r.cliente.ramoOutro).toBeTruthy();
    expect(await db().select().from(nichos).where(eq(nichos.ramoCatalogo, livre))).toHaveLength(0);
    const [{ total }] = await db().select({ total: count() }).from(setoresDeCadastro);
    expect(total).toBe(LIMITES_DO_CADASTRO.ramosNovosPorDia);
  });
});

describe("a Server Action de criar conta", () => {
  it("cria, entra na conta e manda ao briefing; fechada, devolve a frase", async () => {
    const { criarContaAction } = await import("@/app/cadastro/acoes");
    const dados = dadosBons({ email: "acao@cadastro.teste" });
    expect(await criarContaAction(dados)).toEqual({ ok: true, destino: "/comecar" });
    expect(await db().select().from(user).where(eq(user.email, "acao@cadastro.teste"))).toHaveLength(1);
    delete process.env.CADASTRO_ABERTO;
    expect(await criarContaAction(dadosBons())).toMatchObject({ ok: false, erro: expect.stringContaining("ainda não está aberto") });
  });
});
