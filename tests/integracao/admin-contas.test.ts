/**
 * O admin de contas (E46 PR 1), contra o Postgres real: a lista de Contas com o tipo, o ramo, as pessoas e os últimos 7 dias; as trocas que antes exigiam o banco
 * (ramo, tipo, rede principal, público, roteiros por dia), cada uma com a linha no registro; e os números do Início.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { alteracoesDoAdmin, briefings, clientes, execucoesJob, geracoesIA, membrosMarca, nichos, roteiros, session, user } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { alteracoesDaConta, listarContasAdmin, usoDosUltimosDias } from "@/servicos/admin-contas";
import { inicioDoAdmin } from "@/servicos/admin-inicio";
import { trocarPlanoDaConta, trocarPublicoDaConta, trocarRamoDaConta, trocarRedeDaConta, trocarTipoDaConta } from "@/servicos/admin-trocas";
import { ErroCliente, garantirSessaoAdmin } from "@/servicos/clientes";
import { garantirNichoDoRamo } from "@/servicos/ramos";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 24 * 60 * 60 * 1000;
let adminId: string;
let contaA: number;
let contaB: number;

async function criarUsuario(id: string, nome: string): Promise<void> {
  await db().insert(user).values({ id, name: nome, email: `${id}@admin-contas.teste` });
}

function roteiroBase(clienteId: number, dia: string, status: "gerado" | "gravado" | "postado") {
  return {
    clienteId,
    data: dia,
    tema: `tema ${dia}`,
    origem: "livre" as const,
    objetivo: "reconhecimento" as never,
    conteudo: { gancho: "g", corpo: [], fechamento: "f", chamadaFinal: "c" } as never,
    status,
  };
}

beforeAll(async () => {
  await resetarSchema(db());
  await criarUsuario("ac-admin", "Admin de teste");
  adminId = "ac-admin";
  await criarUsuario("ac-ana", "Ana Prado");
  await criarUsuario("ac-bruno", "Bruno Cardoso");

  const { nicho: dentistas } = await garantirNichoDoRamo("confeitaria-e-padaria");
  const [a] = await db().insert(clientes).values({ nome: "[teste] Conta A", nichoId: dentistas.id, tipo: "negocio", alcance: "brasil" }).returning();
  const [b] = await db().insert(clientes).values({ nome: "[teste] Conta B", nichoId: dentistas.id, tipo: "pessoa", alcance: "local", regiao: "Campinas" }).returning();
  contaA = a.id;
  contaB = b.id;
  // Bruno entra nas duas contas; Ana só na A.
  await db().insert(membrosMarca).values([
    { usuarioId: "ac-ana", clienteId: contaA, papel: "dono" },
    { usuarioId: "ac-bruno", clienteId: contaA, papel: "membro" },
    { usuarioId: "ac-bruno", clienteId: contaB, papel: "dono" },
  ]);
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("listarContasAdmin", () => {
  it("traz o tipo, o ramo, as pessoas de cada conta (uma pessoa em duas contas aparece nas duas) e o briefing", async () => {
    await db().insert(briefings).values({ clienteId: contaA, completo: true, notaGeral: "8.84", respostas: {} });
    await db().insert(briefings).values({ clienteId: contaB, completo: false, respostas: { P1: "algo", P2: "outra coisa", P3: "" } });

    const lista = await listarContasAdmin();
    const a = lista.find((c) => c.id === contaA)!;
    const b = lista.find((c) => c.id === contaB)!;

    expect(a.tipo).toBe("negocio");
    expect(b.tipo).toBe("pessoa");
    expect(a.ramoNome).not.toBeNull();
    expect(a.quemTemAcesso.map((p) => p.nome).sort()).toEqual(["Ana Prado", "Bruno Cardoso"]);
    expect(b.quemTemAcesso.map((p) => p.nome)).toEqual(["Bruno Cardoso"]);
    expect(a.briefingEstado).toEqual({ tipo: "pronto", nota: 8.84, abaixo: false });
    expect(b.briefingEstado).toEqual({ tipo: "incompleto", respondidas: 2 });
  });

  it("os últimos 7 dias: gravou, gerou roteiro, só entrou e nada; Usando e Parou saem deles", async () => {
    const hoje = new Date();
    const dia = (atras: number) => hojeISO(new Date(hoje.getTime() - atras * DIA));
    await db().insert(roteiros).values([roteiroBase(contaA, dia(0), "gravado"), roteiroBase(contaA, dia(2), "gerado")]);
    // Ana entrou há 1 dia (sessão).
    await db().insert(session).values({ id: "ac-s1", token: "ac-t1", userId: "ac-ana", expiresAt: new Date(hoje.getTime() + DIA), updatedAt: new Date(hoje.getTime() - DIA) });

    const a = (await listarContasAdmin()).find((c) => c.id === contaA)!;
    const estados = a.ultimos7.map((d) => d.estado);
    expect(a.ultimos7).toHaveLength(7);
    expect(estados[6]).toBe("gravou");
    expect(estados[5]).toBe("entrou");
    expect(estados[4]).toBe("gerou");
    expect(a.usando).toBe(true);
    expect(a.parou).toBe(false);
    expect(a.nuncaEntrou).toBe(false);

    // A sessão de um admin (que passa por todas as contas) nunca conta como entrada de conta nenhuma.
    await db().insert(user).values({ id: "ac-admin-membro", name: "Admin membro", email: "ac-admin-membro@admin-contas.teste", role: "admin" });
    await db().insert(membrosMarca).values({ usuarioId: "ac-admin-membro", clienteId: contaB, papel: "membro" });
    await db().insert(session).values({ id: "ac-s2", token: "ac-t2", userId: "ac-admin-membro", expiresAt: new Date(hoje.getTime() + DIA), updatedAt: hoje });
    // Conta nova sem uso ainda não "parou": nunca começou.
    const novaSemUso = (await listarContasAdmin()).find((c) => c.id === contaB)!;
    expect(novaSemUso.parou).toBe(false);
    expect(novaSemUso.nuncaEntrou).toBe(true);
    await db().update(clientes).set({ criadoEm: new Date(hoje.getTime() - 10 * DIA) }).where(eq(clientes.id, contaB));
    const b = (await listarContasAdmin()).find((c) => c.id === contaB)!;
    expect(b.ultimos7.every((d) => d.estado === "nada")).toBe(true);
    expect(b.parou).toBe(true);
    expect(b.nuncaEntrou).toBe(true);
  });

  it("o dia a dia da página da conta conta o que foi escrito, gravado e postado", async () => {
    const uso = await usoDosUltimosDias(contaA, 14);
    expect(uso).toHaveLength(14);
    const hoje = uso[uso.length - 1];
    expect(hoje.escritos).toBe(1);
    expect(hoje.gravados).toBe(1);
    expect(hoje.postados).toBe(0);
  });
});

describe("as trocas do admin deixam registro", () => {
  it("trocar o ramo: o briefing e os roteiros ficam, o ramo muda e a linha diz quem, antes e depois", async () => {
    const [antes] = await db().select().from(clientes).where(eq(clientes.id, contaA));
    const roteirosAntes = await db().select().from(roteiros).where(eq(roteiros.clienteId, contaA));

    const { mudou } = await trocarRamoDaConta(contaA, "restaurante-e-lanchonete", adminId);

    const [depois] = await db().select().from(clientes).where(eq(clientes.id, contaA));
    expect(mudou).toBe(true);
    expect(depois.nichoId).not.toBe(antes.nichoId);
    const [briefing] = await db().select().from(briefings).where(eq(briefings.clienteId, contaA));
    expect(briefing.completo).toBe(true);
    expect(await db().select().from(roteiros).where(eq(roteiros.clienteId, contaA))).toHaveLength(roteirosAntes.length);
    const registro = await alteracoesDaConta(contaA);
    expect(registro[0]).toMatchObject({ campo: "ramo", porUsuarioId: adminId, porNome: "Admin de teste" });
    expect(registro[0].depois).toMatch(/restaurante/i);
    expect(registro[0].antes).not.toBeNull();
  });

  it("escolher o mesmo ramo não troca nada nem registra", async () => {
    const antes = (await alteracoesDaConta(contaA)).length;
    const { mudou } = await trocarRamoDaConta(contaA, "restaurante-e-lanchonete", adminId);
    expect(mudou).toBe(false);
    expect(await alteracoesDaConta(contaA)).toHaveLength(antes);
  });

  it("trocar o tipo apaga o briefing (as perguntas mudam) e registra; pedir o tipo que já tem não registra", async () => {
    await trocarTipoDaConta(contaA, "pessoa", adminId);
    const [depois] = await db().select().from(clientes).where(eq(clientes.id, contaA));
    expect(depois.tipo).toBe("pessoa");
    const [briefing] = await db().select().from(briefings).where(eq(briefings.clienteId, contaA));
    expect(briefing.completo).toBe(false);
    const registro = await alteracoesDaConta(contaA);
    expect(registro[0]).toMatchObject({ campo: "tipo", antes: "Empresa (briefing e contexto da marca apagados)", depois: "Pessoal" });

    const total = registro.length;
    await trocarTipoDaConta(contaA, "pessoa", adminId);
    expect(await alteracoesDaConta(contaA)).toHaveLength(total);
  });

  it("trocar a rede principal e o público registram com o antes e o depois em palavras", async () => {
    await trocarRedeDaConta(contaB, "tiktok", adminId);
    await trocarPublicoDaConta(contaB, { alcance: "brasil" }, adminId);
    const registro = await alteracoesDaConta(contaB);
    const rede = registro.find((r) => r.campo === "rede_principal")!;
    const publico = registro.find((r) => r.campo === "publico")!;
    expect(rede).toMatchObject({ antes: null, depois: "TikTok" });
    expect(publico).toMatchObject({ antes: "Local, em Campinas", depois: "Brasil todo" });
    const [conta] = await db().select().from(clientes).where(eq(clientes.id, contaB));
    expect(conta.redePrincipal).toBe("tiktok");
    expect(conta.alcance).toBe("brasil");
    expect(conta.regiao).toBeNull();
  });

  it("público local sem a região é recusado e nada é gravado nem registrado", async () => {
    const antes = (await alteracoesDaConta(contaB)).length;
    await expect(trocarPublicoDaConta(contaB, { alcance: "local", regiao: "  " }, adminId)).rejects.toThrow();
    expect(await alteracoesDaConta(contaB)).toHaveLength(antes);
    const [conta] = await db().select().from(clientes).where(eq(clientes.id, contaB));
    expect(conta.alcance).toBe("brasil");
  });

  it("trocar os roteiros por dia registra; uma rede que não existe é recusada", async () => {
    await trocarPlanoDaConta(contaB, "sem_limite", adminId);
    const registro = await alteracoesDaConta(contaB);
    expect(registro[0]).toMatchObject({ campo: "roteiros_por_dia", antes: "um por dia", depois: "sem limite" });
    await expect(trocarRedeDaConta(contaB, "orkut", adminId)).rejects.toBeInstanceOf(ErroCliente);
  });

  it("conta que não existe é recusada, e quem não é admin não passa pela sessão do admin", async () => {
    await expect(trocarTipoDaConta(999999, "pessoa", adminId)).rejects.toBeInstanceOf(ErroCliente);
    expect(() => garantirSessaoAdmin({ user: { role: "cliente" } })).toThrow();
    expect(() => garantirSessaoAdmin(null)).toThrow();
    expect(() => garantirSessaoAdmin({ user: { role: "admin" } })).not.toThrow();
  });

  it("o registro de uma conta nunca mostra o de outra", async () => {
    const deA = await alteracoesDaConta(contaA);
    const deB = await alteracoesDaConta(contaB);
    expect(deA.every((r) => r.clienteId === contaA)).toBe(true);
    expect(deB.every((r) => r.clienteId === contaB)).toBe(true);
    const [{ total }] = await db().select({ total: sql<number>`count(*)::int` }).from(alteracoesDoAdmin);
    expect(total).toBe(deA.length + deB.length);
  });
});

describe("inicioDoAdmin", () => {
  it("os números batem com o banco: contas, produto, dinheiro e erros", async () => {
    const agora = new Date();
    await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "0", modelo: "mock", entradas: {}, clienteId: contaA, custoUsd: "1.500000", avaliacao: "reprovado", motivosAvaliacao: ["muito_longo"] } as never);
    await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "0", modelo: "mock", entradas: {}, clienteId: contaA, custoUsd: "0.500000", avaliacao: "reprovado", motivosAvaliacao: ["muito_longo", "nao_e_assim_que_eu_falo"] } as never);
    await db().insert(execucoesJob).values({ nome: "coleta-youtube", status: "erro", erro: "a cota acabou", iniciadoEm: new Date(agora.getTime() - 60_000), terminadoEm: agora });

    const inicio = await inicioDoAdmin(agora);

    expect(inicio.contas.ativas).toBe(2);
    expect(inicio.contas.pararam).toBe(1);
    expect(inicio.contas.novasNaSemana).toBe(1);
    expect(inicio.contas.briefingIncompleto).toBe(2);
    expect(inicio.produto.escritos).toBe(2);
    expect(inicio.produto.gravados).toBe(1);
    expect(inicio.produto.postados).toBe(0);
    expect(inicio.produto.reprovados).toBe(2);
    expect(inicio.produto.motivoMaisComum?.vezes).toBe(2);
    expect(inicio.dinheiro.saiuHojeUsd).toBeCloseTo(2, 5);
    // Os 30 dias vão até ontem (como em Custos): o gasto de hoje fica só em "saiu hoje".
    expect(inicio.dinheiro.saiu30dUsd).toBeCloseTo(0, 5);
    expect(inicio.erros.hoje).toBe(1);
    // O erro da busca é de todos os ramos: aparece uma vez em rotinas e não marca ramo nenhum como problema.
    expect(inicio.madrugada.rotinas.busca).toBe("erro");
    expect(inicio.madrugada.comProblema.every((l) => l.temas.atrasado)).toBe(true);
    expect(inicio.erros.recentes[0]).toMatchObject({ nome: "coleta-youtube", continua: true });
  });

  it("um erro que uma execução boa seguiu aparece como resolvido", async () => {
    await db().insert(execucoesJob).values({ nome: "coleta-youtube", status: "ok", iniciadoEm: new Date(), terminadoEm: new Date() });
    const inicio = await inicioDoAdmin();
    expect(inicio.erros.recentes.find((e) => e.nome === "coleta-youtube")?.continua).toBe(false);
  });

  it("os ramos ativos entram na madrugada, e o ramo sem tema depois das 8h é problema", async () => {
    const [ramo] = await db().select().from(nichos).where(eq(nichos.ativo, true)).limit(1);
    // Meio-dia no Brasil: o tema já devia existir.
    const meioDia = new Date(`${hojeISO()}T15:00:00Z`);
    const inicio = await inicioDoAdmin(meioDia);
    expect(inicio.madrugada.totalDeRamos).toBeGreaterThan(0);
    const linha = inicio.madrugada.linhas.find((l) => l.nichoId === ramo.id);
    expect(linha).toBeDefined();
    expect(linha!.temas.atrasado).toBe(true);
    expect(inicio.madrugada.comProblema.length).toBeGreaterThan(0);
    // De madrugada (04:00), ainda não é problema.
    const cedo = await inicioDoAdmin(new Date(`${hojeISO()}T07:00:00Z`));
    expect(cedo.madrugada.linhas.find((l) => l.nichoId === ramo.id)!.temas.atrasado).toBe(false);
  });
});
