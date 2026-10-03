/**
 * O "Não achei o meu" (E45, PR 2), contra o Postgres real: o pedido de ramo, o ramo provisório em que a marca espera, e o que o admin faz com
 * ele (encaixar num ramo que existe, ou criar o ramo). Nunca setor novo automático; o provisório que ficou sem marca desliga.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, pedidosDeRamo, user } from "@/db/schema";
import { FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { salvarDadosFixos, salvarDadosFixosComPedido, salvarRamoConta } from "@/servicos/clientes";
import { ErroNicho } from "@/servicos/nichos";
import {
  cancelarPedidoAberto,
  contarPedidosAbertos,
  conferirPedidoAberto,
  encaixarPedido,
  fecharPedidoComSetor,
  listarPedidosAbertos,
  pedidoAbertoDaMarca,
  registrarPedidoDeRamo,
  resolverPedidoComSetorNovo,
} from "@/servicos/pedidos-de-ramo";
import { garantirNichoDoRamo, nichoDoRamo } from "@/servicos/ramos";

import { resetarSchema } from "../../scripts/resetar-schema";

const DADOS = { nome: "[teste] Marca", alcance: "brasil" as const, persona: "negocio" as const };

async function criarMarca(usuarioId: string, nome: string): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${nome}`, email: `${usuarioId}@pedidos.teste` });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${nome}` }).returning();
  return marca.id;
}

async function marcaPorId(id: number) {
  const [marca] = await db().select().from(clientes).where(eq(clientes.id, id));
  return marca;
}

async function setorPorId(id: number) {
  const [setor] = await db().select().from(nichos).where(eq(nichos.id, id));
  return setor;
}

async function jobsDePesquisaDe(nichoId: number): Promise<number> {
  const linhas = await db().execute(sql`select 1 from pgboss.job where name = ${FILAS.pesquisaDeSetor} and data->>'nichoId' = ${String(nichoId)}`);
  return linhas.rows.length;
}

beforeAll(async () => {
  await resetarSchema(db());
  config.regras.setoresNovosPorDia = 1000;
  await garantirBossPronto();
  await db().execute(sql`delete from pgboss.job where name = ${FILAS.pesquisaDeSetor}`);
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("registrarPedidoDeRamo: o pedido e o ramo provisório", () => {
  it("abre o pedido, põe a marca no ramo mais próximo do que ela escreveu (o setor nasce e a pesquisa começa), e guarda o texto", async () => {
    const marca = await criarMarca("pedidos-novo", "Novo");

    const { pedido, setorProvisorioId, limite } = await registrarPedidoDeRamo(marca, "  clínica   veterinária ");

    expect(limite).toBe(false);
    expect(pedido.estado).toBe("aberto");
    expect(pedido.texto).toBe("clínica veterinária");
    const setor = (await nichoDoRamo("veterinaria-e-pet"))!;
    expect(setorProvisorioId).toBe(setor.id);
    expect(pedido.setorProvisorioId).toBe(setor.id);
    const depois = await marcaPorId(marca);
    expect(depois.nichoId).toBe(setor.id);
    expect(depois.ramoOutro).toBe("clínica veterinária");
    expect((await pedidoAbertoDaMarca(marca))?.id).toBe(pedido.id);
    expect(await jobsDePesquisaDe(setor.id)).toBe(1);
  });

  it("é idempotente: o mesmo texto de novo não abre outro pedido, não mexe no setor e não pesquisa de novo", async () => {
    const marca = await criarMarca("pedidos-idempotente", "Idempotente");
    const primeiro = await registrarPedidoDeRamo(marca, "criação de abelhas");
    const setorId = primeiro.setorProvisorioId!;
    const jobsAntes = await jobsDePesquisaDe(setorId);

    const segundo = await registrarPedidoDeRamo(marca, "Criação de abelhas");

    expect(segundo.pedido.id).toBe(primeiro.pedido.id);
    expect(segundo.setorProvisorioId).toBe(setorId);
    expect((await marcaPorId(marca)).nichoId).toBe(setorId);
    expect(await jobsDePesquisaDe(setorId)).toBe(jobsAntes);
    expect(await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.clienteId, marca))).toHaveLength(1);
  });

  it("três registros ao mesmo tempo dão um pedido aberto só (índice único parcial)", async () => {
    const marca = await criarMarca("pedidos-simultaneo", "Simultâneo");
    await Promise.all([1, 2, 3].map(() => registrarPedidoDeRamo(marca, "salão de beleza").catch(() => undefined)));
    const abertos = (await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.clienteId, marca))).filter((p) => p.estado === "aberto");
    expect(abertos).toHaveLength(1);
  });

  it("um texto novo refaz o palpite: a marca muda de setor provisório, e o de antes desliga se ficou sem marca", async () => {
    const marca = await criarMarca("pedidos-texto-novo", "Texto novo");
    const antes = await registrarPedidoDeRamo(marca, "escola de dança");
    const setorAntigo = antes.setorProvisorioId!;

    const depois = await registrarPedidoDeRamo(marca, "oficina de carros");

    const setorNovo = (await nichoDoRamo("oficina-e-pecas"))!;
    expect(depois.setorProvisorioId).toBe(setorNovo.id);
    expect((await marcaPorId(marca)).nichoId).toBe(setorNovo.id);
    expect((await setorPorId(setorAntigo)).ativo).toBe(false);
    // O mesmo pedido, com o texto novo.
    expect(depois.pedido.id).toBe(antes.pedido.id);
    expect(depois.pedido.texto).toBe("oficina de carros");
  });

  it("quando nada casa, o pedido vai aberto sem setor provisório, e a marca fica onde estava (sem setor, se não tinha; no setor dela, se tinha)", async () => {
    const semSetor = await criarMarca("pedidos-nada-casa-a", "Sem setor");
    const resultadoA = await registrarPedidoDeRamo(semSetor, "xyzw abcd");
    expect(resultadoA.setorProvisorioId).toBeNull();
    expect((await marcaPorId(semSetor)).nichoId).toBeNull();
    expect((await marcaPorId(semSetor)).ramoOutro).toBe("xyzw abcd");
    expect(resultadoA.pedido.estado).toBe("aberto");

    const comSetor = await criarMarca("pedidos-nada-casa-b", "Com setor");
    const { nicho } = await garantirNichoDoRamo("contabilidade-e-financas");
    await db().update(clientes).set({ nichoId: nicho.id }).where(eq(clientes.id, comSetor));
    const resultadoB = await registrarPedidoDeRamo(comSetor, "xyzw abcd");
    expect(resultadoB.setorProvisorioId).toBeNull();
    expect((await marcaPorId(comSetor)).nichoId).toBe(nicho.id);
    expect((await setorPorId(nicho.id)).ativo).toBe(true);
  });

  it("o teto de setores novos por dia vale aqui: sem lançar, o pedido vai aberto sem setor provisório, e nenhum setor nasce", async () => {
    const marca = await criarMarca("pedidos-teto", "Teto");
    const nasceramHoje = (await db().select().from(nichos)).filter((n) => n.ramoCatalogo !== null).length;
    config.regras.setoresNovosPorDia = nasceramHoje;
    try {
      const total = (await db().select().from(nichos)).length;
      const { setorProvisorioId, limite, pedido } = await registrarPedidoDeRamo(marca, "escritório de advocacia trabalhista");

      expect(limite).toBe(true);
      expect(setorProvisorioId).toBeNull();
      expect(pedido.estado).toBe("aberto");
      expect((await marcaPorId(marca)).nichoId).toBeNull();
      expect((await db().select().from(nichos)).length).toBe(total);
    } finally {
      config.regras.setoresNovosPorDia = 1000;
    }
  });

  it("o Começar avisa quando o teto segurou o palpite (limiteDeRamosNovos), e só então; com palpite, não", async () => {
    const marca = await criarMarca("pedidos-teto-comecar", "Teto Comecar");
    const nasceramHoje = (await db().select().from(nichos)).filter((n) => n.ramoCatalogo !== null).length;
    config.regras.setoresNovosPorDia = nasceramHoje;
    try {
      const segurado = await salvarDadosFixosComPedido(marca, { ...DADOS, ramoOutro: "escritório de advocacia trabalhista" });
      expect(segurado.limiteDeRamosNovos).toBe(true);
      expect(segurado.cliente.nichoId).toBeNull();
    } finally {
      config.regras.setoresNovosPorDia = 1000;
    }
    const livre = await salvarDadosFixosComPedido(marca, { ...DADOS, ramoOutro: "escritório de advocacia civil" });
    expect(livre.limiteDeRamosNovos).toBe(false);
    expect(livre.cliente.nichoId).not.toBeNull();
    const sem = await salvarDadosFixosComPedido(marca, { ...DADOS, ramoOutro: "xyzw abcd" });
    expect(sem.limiteDeRamosNovos).toBe(false);
  });

  it("texto vazio é recusado, e um texto enorme é cortado (o pedido é uma ou duas frases)", async () => {
    const marca = await criarMarca("pedidos-texto-limites", "Limites");
    await expect(registrarPedidoDeRamo(marca, "   ")).rejects.toBeInstanceOf(ErroNicho);
    const { pedido } = await registrarPedidoDeRamo(marca, "x".repeat(5000));
    expect(pedido.texto.length).toBe(300);
  });
});

describe("salvarDadosFixos e salvarRamoConta com um pedido aberto", () => {
  it("o Começar com 'Não achei o meu' abre o pedido e põe a marca no ramo provisório; salvar de novo igual não muda nada", async () => {
    const marca = await criarMarca("pedidos-comecar", "Começar");

    const cliente = await salvarDadosFixos(marca, { ...DADOS, ramoOutro: "clínica de nutrição" });

    const setor = (await nichoDoRamo("nutricao"))!;
    expect(cliente.nichoId).toBe(setor.id);
    expect(cliente.ramoOutro).toBe("clínica de nutrição");
    const pedido = (await pedidoAbertoDaMarca(marca))!;
    expect(pedido.setorProvisorioId).toBe(setor.id);

    await salvarDadosFixos(marca, { ...DADOS, ramoOutro: "clínica de nutrição" });
    expect((await pedidoAbertoDaMarca(marca))!.id).toBe(pedido.id);
    expect((await marcaPorId(marca)).nichoId).toBe(setor.id);
  });

  it("escolher um ramo da lista depois cancela o pedido, apaga o texto, leva a marca ao setor e desliga o provisório que ficou sem marca", async () => {
    const marca = await criarMarca("pedidos-escolheu-lista", "Escolheu da lista");
    await salvarDadosFixos(marca, { ...DADOS, ramoOutro: "loja de brinquedos educativos" });
    const provisorio = (await marcaPorId(marca)).nichoId!;
    const pedido = (await pedidoAbertoDaMarca(marca))!;

    await salvarDadosFixos(marca, { ...DADOS, ramo: "turismo-e-hospedagem" });

    const depois = await marcaPorId(marca);
    expect(depois.ramoOutro).toBeNull();
    expect(depois.nichoId).toBe((await nichoDoRamo("turismo-e-hospedagem"))!.id);
    expect(await pedidoAbertoDaMarca(marca)).toBeNull();
    const [fechado] = await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.id, pedido.id));
    expect(fechado.estado).toBe("cancelado");
    expect(fechado.resolvidoEm).not.toBeNull();
    expect((await setorPorId(provisorio)).ativo).toBe(false);
  });

  it("trocar de ramo pela Conta também cancela o pedido aberto", async () => {
    const marca = await criarMarca("pedidos-conta-escolheu", "Conta escolheu");
    await registrarPedidoDeRamo(marca, "festa infantil de aniversário");
    expect(await pedidoAbertoDaMarca(marca)).not.toBeNull();

    await salvarRamoConta(marca, "eventos-e-festas");

    expect(await pedidoAbertoDaMarca(marca)).toBeNull();
    expect((await marcaPorId(marca)).ramoOutro).toBeNull();
  });

  it("o texto livre de uma marca que escolhe um ramo da lista no mesmo salvar nunca cria pedido", async () => {
    const marca = await criarMarca("pedidos-lista-direto", "Lista direto");
    await salvarDadosFixos(marca, { ...DADOS, ramo: "danca-e-ioga", ramoOutro: "ignorado" });
    expect(await pedidoAbertoDaMarca(marca)).toBeNull();
    expect((await marcaPorId(marca)).ramoOutro).toBeNull();
  });

  it("cancelarPedidoAberto sem pedido aberto não faz nada nem dá erro", async () => {
    const marca = await criarMarca("pedidos-cancelar-vazio", "Cancelar vazio");
    await expect(cancelarPedidoAberto(marca)).resolves.toBeUndefined();
  });
});

describe("o admin resolve o pedido", () => {
  it("'encaixar em um que existe': a marca vai ao setor do ramo, o pedido fecha como encaixado, o texto livre some, e o setor provisório que ficou sem marca desliga", async () => {
    const marca = await criarMarca("pedidos-encaixar", "Encaixar");
    const { pedido, setorProvisorioId } = await registrarPedidoDeRamo(marca, "fisioterapeuta de pilates");
    const provisorio = (await setorPorId(setorProvisorioId!))!;
    expect(provisorio.ativo).toBe(true);

    await encaixarPedido(pedido.id, "psicologia-e-terapias");

    const destino = (await nichoDoRamo("psicologia-e-terapias"))!;
    const depois = await marcaPorId(marca);
    expect(depois.nichoId).toBe(destino.id);
    expect(depois.ramoOutro).toBeNull();
    const [fechado] = await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.id, pedido.id));
    expect(fechado.estado).toBe("atendido");
    expect(fechado.resolucao).toBe("encaixado");
    expect(fechado.setorFinalId).toBe(destino.id);
    expect(fechado.resolvidoEm).not.toBeNull();
    // O provisório (Fisioterapia e pilates) ficou sem marca: desligou.
    expect((await setorPorId(provisorio.id)).ativo).toBe(false);
    expect(await pedidoAbertoDaMarca(marca)).toBeNull();
  });

  it("o setor provisório que outra marca ainda usa continua ligado depois de resolver", async () => {
    const dona = await criarMarca("pedidos-compartilhado-a", "Dona do pedido");
    const outra = await criarMarca("pedidos-compartilhado-b", "Outra marca");
    const { pedido, setorProvisorioId } = await registrarPedidoDeRamo(dona, "jardineiro paisagista");
    await db().update(clientes).set({ nichoId: setorProvisorioId }).where(eq(clientes.id, outra));

    await encaixarPedido(pedido.id, "decoracao-e-moveis");

    expect((await setorPorId(setorProvisorioId!)).ativo).toBe(true);
    expect((await marcaPorId(outra)).nichoId).toBe(setorProvisorioId);
  });

  it("'criar ramo': a marca vai ao setor novo que o admin criou (feito à mão, sem ramo do catálogo), o pedido fecha como ramo criado, e o provisório desliga", async () => {
    const marca = await criarMarca("pedidos-criar-ramo", "Criar ramo");
    const { pedido, setorProvisorioId } = await registrarPedidoDeRamo(marca, "marmita caseira");
    const [novo] = await db().insert(nichos).values({ slug: "apicultura-do-admin", nome: "Apicultura", termos: ["abelha", "mel", "apiário", "colmeia", "apicultor"] }).returning();

    await conferirPedidoAberto(pedido.id);
    await resolverPedidoComSetorNovo(pedido.id, novo.id);

    expect((await marcaPorId(marca)).nichoId).toBe(novo.id);
    const [fechado] = await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.id, pedido.id));
    expect(fechado.estado).toBe("atendido");
    expect(fechado.resolucao).toBe("ramo_criado");
    expect(fechado.setorFinalId).toBe(novo.id);
    expect((await setorPorId(setorProvisorioId!)).ativo).toBe(false);
    expect((await setorPorId(novo.id)).ativo).toBe(true);
  });

  it("um formulário velho com o mesmo texto de um pedido já atendido não o reabre nem tira a marca do setor que o admin escolheu", async () => {
    const marca = await criarMarca("pedidos-velho", "Formulario velho");
    const { pedido } = await registrarPedidoDeRamo(marca, "fisioterapeuta de pilates");
    await encaixarPedido(pedido.id, "psicologia-e-terapias");
    const destino = (await nichoDoRamo("psicologia-e-terapias"))!;

    const depois = await registrarPedidoDeRamo(marca, "Fisioterapeuta de  pilates");

    expect(depois.pedido.estado).toBe("atendido");
    expect(await pedidoAbertoDaMarca(marca)).toBeNull();
    expect((await marcaPorId(marca)).nichoId).toBe(destino.id);
    expect((await marcaPorId(marca)).ramoOutro).toBeNull();

    // O caminho do formulário velho (salvarDadosFixos grava o texto em ramo_outro antes de o atalho valer) também não deixa o texto para trás.
    await salvarDadosFixos(marca, { ...DADOS, ramoOutro: "fisioterapeuta de pilates" });
    expect(await pedidoAbertoDaMarca(marca)).toBeNull();
    expect((await marcaPorId(marca)).ramoOutro).toBeNull();
    expect((await marcaPorId(marca)).nichoId).toBe(destino.id);

    // Com um texto diferente é um pedido novo, como sempre; e fora do setor final, o mesmo texto também volta a valer.
    const novo = await registrarPedidoDeRamo(marca, "personal trainer");
    expect(novo.pedido.estado).toBe("aberto");
  });

  it("a corrida: o pedido some (a pessoa escolheu da lista) entre a conferência do admin e o fechamento, e a marca não é movida", async () => {
    const marca = await criarMarca("pedidos-corrida", "Corrida");
    const { pedido } = await registrarPedidoDeRamo(marca, "personal trainer");
    const antes = (await marcaPorId(marca)).nichoId;
    const destino = (await garantirNichoDoRamo("psicologia-e-terapias")).nicho;
    await cancelarPedidoAberto(marca);

    await expect(fecharPedidoComSetor(pedido, destino.id, "encaixado")).rejects.toBeInstanceOf(ErroNicho);

    expect((await marcaPorId(marca)).nichoId).toBe(antes);
    const [depois] = await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.id, pedido.id));
    expect(depois.estado).toBe("cancelado");
  });

  it("um pedido já resolvido (ou que não existe) não se resolve de novo, e nada muda", async () => {
    const marca = await criarMarca("pedidos-ja-resolvido", "Já resolvido");
    const { pedido } = await registrarPedidoDeRamo(marca, "estúdio de pilates e yoga");
    await encaixarPedido(pedido.id, "danca-e-ioga");
    const antes = await marcaPorId(marca);

    await expect(encaixarPedido(pedido.id, "nutricao")).rejects.toBeInstanceOf(ErroNicho);
    await expect(resolverPedidoComSetorNovo(pedido.id, antes.nichoId!)).rejects.toBeInstanceOf(ErroNicho);
    await expect(conferirPedidoAberto(pedido.id)).rejects.toBeInstanceOf(ErroNicho);
    await expect(encaixarPedido(999_999, "nutricao")).rejects.toBeInstanceOf(ErroNicho);
    expect((await marcaPorId(marca)).nichoId).toBe(antes.nichoId);
  });

  it("encaixar num ramo cujo setor ainda não existe o faz nascer (e o teto de setores novos por dia vale: estourado, o pedido continua aberto)", async () => {
    const marca = await criarMarca("pedidos-encaixar-teto", "Encaixar com teto");
    const { pedido } = await registrarPedidoDeRamo(marca, "xyzw abcd");
    const nasceramHoje = (await db().select().from(nichos)).filter((n) => n.ramoCatalogo !== null).length;
    config.regras.setoresNovosPorDia = nasceramHoje;
    try {
      await expect(encaixarPedido(pedido.id, "importacao-e-desenvolvimento-de-produto")).rejects.toThrow();
      expect((await pedidoAbertoDaMarca(marca))?.id).toBe(pedido.id);
      expect((await marcaPorId(marca)).nichoId).toBeNull();
    } finally {
      config.regras.setoresNovosPorDia = 1000;
    }
    await encaixarPedido(pedido.id, "importacao-e-desenvolvimento-de-produto");
    expect((await marcaPorId(marca)).nichoId).toBe((await nichoDoRamo("importacao-e-desenvolvimento-de-produto"))!.id);
  });
});

describe("a lista e o número de pedidos abertos", () => {
  it("lista só os abertos, do mais antigo ao mais novo, com a marca e o setor provisório, e o número bate", async () => {
    await db().delete(pedidosDeRamo);
    const a = await criarMarca("pedidos-lista-a", "Lista A");
    const b = await criarMarca("pedidos-lista-b", "Lista B");
    const c = await criarMarca("pedidos-lista-c", "Lista C");
    const pedidoA = (await registrarPedidoDeRamo(a, "clínica de fisioterapia")).pedido;
    const pedidoB = (await registrarPedidoDeRamo(b, "xyzw abcd")).pedido;
    const pedidoC = (await registrarPedidoDeRamo(c, "barbeiro")).pedido;
    await encaixarPedido(pedidoC.id, "cabelo-e-barbearia");

    const lista = await listarPedidosAbertos();

    expect(lista.map((p) => p.id)).toEqual([pedidoA.id, pedidoB.id]);
    expect(lista[0].marca).toEqual({ id: a, nome: "[teste] Lista A" });
    expect(lista[0].texto).toBe("clínica de fisioterapia");
    expect(lista[0].setorProvisorio?.nome).toBe("Fisioterapia e pilates");
    expect(lista[1].setorProvisorio).toBeNull();
    expect(await contarPedidosAbertos()).toBe(2);
  });

  it("a marca que já tinha ramo e nada casou aparece com o ramo em que continua (a lista não diz 'sem temas')", async () => {
    await db().delete(pedidosDeRamo);
    const marca = await criarMarca("pedidos-lista-continua", "Lista continua");
    const { nicho } = await garantirNichoDoRamo("odontologia");
    await db().update(clientes).set({ nichoId: nicho.id }).where(eq(clientes.id, marca));
    await registrarPedidoDeRamo(marca, "xyzw abcd");

    const [item] = await listarPedidosAbertos();
    expect(item.setorProvisorio).toBeNull();
    expect(item.ramoAtual?.id).toBe(nicho.id);
  });

  it("o setor provisório só aparece enquanto a marca está nele (se ela saiu por outro caminho, a lista não o mostra)", async () => {
    await db().delete(pedidosDeRamo);
    const marca = await criarMarca("pedidos-lista-saiu", "Lista saiu");
    await registrarPedidoDeRamo(marca, "personal trainer");
    await db().update(clientes).set({ nichoId: null }).where(eq(clientes.id, marca));

    const [item] = await listarPedidosAbertos();
    expect(item.setorProvisorio).toBeNull();
  });
});

/**
 * A migração de dado da 0056: roda o INSERT do próprio arquivo. As marcas que escolheram "Não achei o meu" antes desta PR (texto em
 * `ramo_outro`, sem setor) viram pedidos abertos, para o admin ver.
 */
describe("migração 0056, os pedidos que já existiam sem pedido", () => {
  const SQL = readFileSync(join(process.cwd(), "drizzle", "0056_pedidos-de-ramo.sql"), "utf8");
  const INSERCOES = SQL.split("--> statement-breakpoint").filter((trecho) => /\bINSERT INTO\b/.test(trecho));

  async function rodar() {
    for (const comando of INSERCOES) await db().execute(sql.raw(comando));
  }

  it("só a marca ativa com texto livre e sem setor entra; rodar de novo não duplica", async () => {
    await db().delete(pedidosDeRamo);
    // As marcas dos testes de cima também guardam texto livre sem setor: só as deste teste valem para a conta.
    await db().update(clientes).set({ ramoOutro: null });
    const antiga = await criarMarca("pedidos-migracao-antiga", "Antiga");
    await db().update(clientes).set({ ramoOutro: "  conserto de bicicletas  " }).where(eq(clientes.id, antiga));
    const comSetor = await criarMarca("pedidos-migracao-com-setor", "Com setor");
    const { nicho } = await garantirNichoDoRamo("imoveis");
    await db().update(clientes).set({ ramoOutro: "texto antigo", nichoId: nicho.id }).where(eq(clientes.id, comSetor));
    const desativada = await criarMarca("pedidos-migracao-desativada", "Desativada");
    await db().update(clientes).set({ ramoOutro: "outro texto", ativo: false }).where(eq(clientes.id, desativada));
    const vazia = await criarMarca("pedidos-migracao-vazia", "Vazia");
    await db().update(clientes).set({ ramoOutro: "   " }).where(eq(clientes.id, vazia));

    expect(INSERCOES).toHaveLength(1);
    await rodar();
    await rodar();

    const pedidos = await db().select().from(pedidosDeRamo);
    expect(pedidos.map((p) => p.clienteId)).toEqual([antiga]);
    expect(pedidos[0].texto).toBe("conserto de bicicletas");
    expect(pedidos[0].estado).toBe("aberto");
    expect(pedidos[0].setorProvisorioId).toBeNull();
  });
});
