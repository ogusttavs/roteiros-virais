/**
 * Do ramo do catálogo ao setor (E45, PR 1), contra o Postgres real: o setor do ramo nasce quando a primeira marca o escolhe (e só
 * então), duas escolhas ao mesmo tempo caem no mesmo setor, um setor parado volta, a migração de dado encaixa os cinco setores que já
 * existiam sem depender de id, e a marca que troca de ramo não mexe em nenhuma outra.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RAMOS_DO_CATALOGO } from "@/config/ramos";
import { db, getPool } from "@/db";
import { briefings, clientes, nichos, user } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import { salvarDadosFixos, salvarRamoConta } from "@/servicos/clientes";
import { ErroNicho } from "@/servicos/nichos";
import { garantirNichoDoRamo, nichoDoRamo, ramoAtualDoCliente, termosDoRamo } from "@/servicos/ramos";

import { resetarSchema } from "../../scripts/resetar-schema";

async function jobsDePesquisaDe(nichoId: number): Promise<number> {
  const linhas = await db().execute(
    sql`select 1 from pgboss.job where name = ${FILAS.pesquisaDeSetor} and data->>'nichoId' = ${String(nichoId)}`,
  );
  return linhas.rows.length;
}

async function criarMarca(usuarioId: string, nome: string): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${nome}`, email: `${usuarioId}@ramos.teste` });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${nome}` }).returning();
  return marca.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  // O `resetarSchema` não derruba o schema do pg-boss: os jobs de pesquisa de setor de outras rodadas (com ids de setor repetidos) ficam lá.
  await db().execute(sql`delete from pgboss.job where name = ${FILAS.pesquisaDeSetor}`);
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("termosDoRamo", () => {
  it("os 44 ramos dão de 5 a 12 termos, sem repetição, com o nome primeiro (o que a coleta busca)", () => {
    for (const ramo of RAMOS_DO_CATALOGO) {
      const termos = termosDoRamo(ramo);
      expect(termos.length, ramo.slug).toBeGreaterThanOrEqual(5);
      expect(termos.length, ramo.slug).toBeLessThanOrEqual(12);
      expect(termos[0], ramo.slug).toBe(ramo.nome);
      const semAcento = termos.map((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
      expect(new Set(semAcento).size, ramo.slug).toBe(termos.length);
      for (const termo of termos) expect(termo, ramo.slug).not.toMatch(/[.,]$/);
    }
  });
});

describe("garantirNichoDoRamo", () => {
  it("o setor de um ramo sem conta não existe; a primeira escolha o cria, com os dados do catálogo, e começa a pesquisa de setor", async () => {
    expect(await nichoDoRamo("odontologia")).toBeNull();

    const { nicho, criado, reativado } = await garantirNichoDoRamo("odontologia");

    expect(criado).toBe(true);
    expect(reativado).toBe(false);
    expect(nicho.slug).toBe("odontologia");
    expect(nicho.nome).toBe("Odontologia");
    expect(nicho.ramoCatalogo).toBe("odontologia");
    expect(nicho.ativo).toBe(true);
    expect(nicho.termos.length).toBeGreaterThanOrEqual(5);
    expect(await jobsDePesquisaDe(nicho.id)).toBe(1);
  });

  it("a segunda escolha do mesmo ramo cai no mesmo setor e não pesquisa de novo", async () => {
    const primeiro = await garantirNichoDoRamo("nutricao");
    const segundo = await garantirNichoDoRamo("nutricao");

    expect(segundo.criado).toBe(false);
    expect(segundo.nicho.id).toBe(primeiro.nicho.id);
    expect(await jobsDePesquisaDe(primeiro.nicho.id)).toBe(1);
  });

  it("cinco pessoas escolhendo o mesmo ramo novo ao mesmo tempo: um setor só, uma pesquisa só", async () => {
    const resultados = await Promise.all(Array.from({ length: 5 }, () => garantirNichoDoRamo("advocacia")));

    expect(new Set(resultados.map((r) => r.nicho.id)).size).toBe(1);
    expect(resultados.filter((r) => r.criado)).toHaveLength(1);
    const linhas = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "advocacia"));
    expect(linhas).toHaveLength(1);
    expect(await jobsDePesquisaDe(linhas[0].id)).toBe(1);
  });

  it("um setor parado (sem conta) volta a ser pesquisado quando uma marca escolhe o ramo, sem enfileirar a pesquisa de novo", async () => {
    const [parado] = await db()
      .insert(nichos)
      .values({ slug: "maquiagem-parado", nome: "Maquiagem parado", ramoCatalogo: "maquiagem-e-cosmeticos", ativo: false })
      .returning();

    const { nicho, criado, reativado } = await garantirNichoDoRamo("maquiagem-e-cosmeticos");

    expect(nicho.id).toBe(parado.id);
    expect(criado).toBe(false);
    expect(reativado).toBe(true);
    expect(nicho.ativo).toBe(true);
    expect(await jobsDePesquisaDe(parado.id)).toBe(0);
  });

  it("um setor que o admin fez à mão com o mesmo endereço, sem ramo, fica intacto: o setor novo ganha um sufixo", async () => {
    const [aMao] = await db().insert(nichos).values({ slug: "imoveis", nome: "Imóveis do admin" }).returning();

    const { nicho, criado } = await garantirNichoDoRamo("imoveis");

    expect(criado).toBe(true);
    expect(nicho.id).not.toBe(aMao.id);
    expect(nicho.slug).toBe("imoveis-catalogo");
    expect(nicho.ramoCatalogo).toBe("imoveis");
    const [intacto] = await db().select().from(nichos).where(eq(nichos.id, aMao.id));
    expect(intacto.ramoCatalogo).toBeNull();
    expect(intacto.nome).toBe("Imóveis do admin");
  });

  it("um ramo que não existe no catálogo é recusado, e nada é criado", async () => {
    const antes = await db().select().from(nichos);
    await expect(garantirNichoDoRamo("ramo-inventado")).rejects.toBeInstanceOf(ErroNicho);
    expect(await db().select().from(nichos)).toHaveLength(antes.length);
  });
});

describe("salvarDadosFixos com o ramo do catálogo", () => {
  const DADOS = { nome: "[teste] Marca", alcance: "brasil" as const, persona: "negocio" as const };

  it("grava o setor do ramo, e o texto livre do 'outro' vai embora (nunca os dois)", async () => {
    const clienteId = await criarMarca("ramos-dados-fixos", "Dados fixos");
    await db().update(clientes).set({ ramoOutro: "algo que eu escrevi antes" }).where(eq(clientes.id, clienteId));

    const cliente = await salvarDadosFixos(clienteId, { ...DADOS, ramo: "fisioterapia-e-pilates", ramoOutro: "ignorado" });

    const setor = await nichoDoRamo("fisioterapia-e-pilates");
    expect(setor).not.toBeNull();
    expect(cliente.nichoId).toBe(setor!.id);
    expect(cliente.ramoOutro).toBeNull();
  });

  it("sem o ramo novo, o setor que a marca já tinha (feito à mão) continua valendo: a tela só o mostra como o ramo atual", async () => {
    const clienteId = await criarMarca("ramos-dados-fixos-legado", "Legado");
    const [aMao] = await db().insert(nichos).values({ slug: "setor-a-mao-dados-fixos", nome: "Setor à mão" }).returning();

    const cliente = await salvarDadosFixos(clienteId, { ...DADOS, nichoId: aMao.id });

    expect(cliente.nichoId).toBe(aMao.id);
  });

  it("recusa quando não há ramo do catálogo, nem setor, nem texto livre", async () => {
    const clienteId = await criarMarca("ramos-dados-fixos-vazio", "Vazio");
    await expect(salvarDadosFixos(clienteId, DADOS)).rejects.toThrow();
  });

  it("um ramo que não existe no catálogo é recusado e a marca não muda", async () => {
    const clienteId = await criarMarca("ramos-dados-fixos-falso", "Falso");
    await expect(salvarDadosFixos(clienteId, { ...DADOS, ramo: "ramo-inventado" })).rejects.toBeInstanceOf(ErroNicho);
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(marca.nichoId).toBeNull();
  });
});

describe("salvarRamoConta, trocar o ramo pela Conta", () => {
  it("troca só o ramo: o briefing, o nome e o resto da marca continuam, e a troca de uma marca não mexe em outra", async () => {
    const marcaA = await criarMarca("ramos-troca-a", "Marca A");
    const marcaB = await criarMarca("ramos-troca-b", "Marca B");
    const { nicho: confeitaria } = await garantirNichoDoRamo("confeitaria-e-padaria");
    await db().update(clientes).set({ nichoId: confeitaria.id }).where(eq(clientes.id, marcaA));
    await db().update(clientes).set({ nichoId: confeitaria.id }).where(eq(clientes.id, marcaB));
    await db().insert(briefings).values({ clienteId: marcaA, completo: true, perfil: { resumo: "o briefing de A" } as never });

    const { cliente, mudou } = await salvarRamoConta(marcaA, "restaurante-e-lanchonete");

    const restaurante = await nichoDoRamo("restaurante-e-lanchonete");
    expect(mudou).toBe(true);
    expect(cliente.nichoId).toBe(restaurante!.id);
    expect(cliente.nome).toBe("[teste] Marca A");
    const [briefingA] = await db().select().from(briefings).where(eq(briefings.clienteId, marcaA));
    expect(briefingA.completo).toBe(true);
    const [marcaDeOutro] = await db().select().from(clientes).where(eq(clientes.id, marcaB));
    expect(marcaDeOutro.nichoId).toBe(confeitaria.id);
  });

  it("escolher o ramo que a marca já tem não muda nada (mudou falso)", async () => {
    const marca = await criarMarca("ramos-troca-igual", "Igual");
    await salvarRamoConta(marca, "bar-cafe-e-bebidas");

    const { mudou } = await salvarRamoConta(marca, "bar-cafe-e-bebidas");

    expect(mudou).toBe(false);
  });

  it("limpa o texto livre do 'outro' (a marca agora tem ramo) e recusa ramo que não existe", async () => {
    const marca = await criarMarca("ramos-troca-outro", "Outro");
    await db().update(clientes).set({ ramoOutro: "algo que não achei" }).where(eq(clientes.id, marca));

    const { cliente } = await salvarRamoConta(marca, "danca-e-ioga");

    expect(cliente.ramoOutro).toBeNull();
    await expect(salvarRamoConta(marca, "ramo-inventado")).rejects.toBeInstanceOf(ErroNicho);
  });
});

describe("ramoAtualDoCliente", () => {
  it("mostra o nome do catálogo quando o setor está encaixado, e o nome do setor quando não está", async () => {
    const [encaixado] = await db()
      .insert(nichos)
      .values({ slug: "adesivo-teste-encaixado", nome: "Adesivo Automotivo", ramoCatalogo: "estetica-automotiva" })
      .returning();
    const [aMao] = await db().insert(nichos).values({ slug: "setor-a-mao-atual", nome: "Setor à mão atual" }).returning();

    expect(await ramoAtualDoCliente(encaixado.id)).toEqual({ nichoId: encaixado.id, nome: "Estética automotiva", ramoSlug: "estetica-automotiva" });
    expect(await ramoAtualDoCliente(aMao.id)).toEqual({ nichoId: aMao.id, nome: "Setor à mão atual", ramoSlug: null });
  });

  it("sem setor (ou com um id que não existe), devolve nulo", async () => {
    expect(await ramoAtualDoCliente(null)).toBeNull();
    expect(await ramoAtualDoCliente(undefined)).toBeNull();
    expect(await ramoAtualDoCliente(999_999)).toBeNull();
  });
});

/**
 * A migração de dado da 0055: roda os próprios UPDATE do arquivo `.sql` (o que vai para produção), contra setores com os slugs e nomes
 * de produção. Nunca por id: o id de um banco não é o de outro.
 */
describe("migração 0055, os cinco setores que já existiam", () => {
  const SQL = readFileSync(join(process.cwd(), "drizzle", "0055_nichos-ramo-catalogo.sql"), "utf8");
  const ATUALIZACOES = SQL.split("--> statement-breakpoint").filter((trecho) => /\bUPDATE\b/.test(trecho));

  async function rodarMigracaoDeDado() {
    for (const comando of ATUALIZACOES) await db().execute(sql.raw(comando));
  }

  async function porSlug(slug: string) {
    const [linha] = await db().select().from(nichos).where(eq(nichos.slug, slug));
    return linha;
  }

  beforeAll(async () => {
    // O banco de produção, como estava em 03/10 (ids 1 e 2 são os de lá; os outros nem precisam ser).
    await db().execute(sql`delete from nichos where slug like 'mig-%'`);
    // Os testes de cima criaram setores nesses ramos (de propósito, sem marca): a migração só encaixa onde o ramo ainda não tem setor.
    await db().execute(sql`delete from nichos where ramo_catalogo in ('limpeza-e-organizacao-da-casa', 'estetica-automotiva', 'empreendedorismo-e-negocios', 'maquiagem-e-cosmeticos', 'infantil-e-brinquedos')`);
    await db().insert(nichos).values([
      { slug: "produtos-de-limpeza", nome: "Produtos de limpeza" },
      { slug: "adesivo-automotivo", nome: "Adesivo Automotivo" },
      { slug: "empreendedorismo-e-construcao-de-marcas", nome: "Empreendedorismo e Construção de Marcas" },
      { slug: "cosmeticos", nome: "cosméticos", ativo: false },
      { slug: "brinquedos-infantis", nome: "Brinquedos Infantis", ativo: false },
      // Um setor com o nome certo e o endereço diferente (criado à mão de outro jeito): casa pelo nome.
      { slug: "mig-nome-diferente", nome: "Brinquedos Infantis" },
      // Um setor de verdade que não é nenhum dos cinco: não pode ser tocado.
      { slug: "mig-dentistas", nome: "Dentistas" },
    ]);
  });

  it("o arquivo tem os cinco UPDATE e nenhum deles usa id", () => {
    expect(ATUALIZACOES).toHaveLength(5);
    for (const comando of ATUALIZACOES) expect(comando).not.toMatch(/"id"\s*=\s*\d/);
  });

  it("encaixa cada setor no ramo certo, muda só o nome do setor do Overtake (o endereço fica) e não toca nos outros", async () => {
    await rodarMigracaoDeDado();

    expect((await porSlug("produtos-de-limpeza")).ramoCatalogo).toBe("limpeza-e-organizacao-da-casa");
    const automotivo = await porSlug("adesivo-automotivo");
    expect(automotivo.ramoCatalogo).toBe("estetica-automotiva");
    expect(automotivo.nome).toBe("Estética automotiva");
    expect((await porSlug("empreendedorismo-e-construcao-de-marcas")).ramoCatalogo).toBe("empreendedorismo-e-negocios");
    const cosmeticos = await porSlug("cosmeticos");
    expect(cosmeticos.ramoCatalogo).toBe("maquiagem-e-cosmeticos");
    expect(cosmeticos.ativo).toBe(false);
    expect((await porSlug("brinquedos-infantis")).ramoCatalogo).toBe("infantil-e-brinquedos");
    // Os nomes dos outros não mudam.
    expect((await porSlug("produtos-de-limpeza")).nome).toBe("Produtos de limpeza");
    expect((await porSlug("mig-dentistas")).ramoCatalogo).toBeNull();
    expect((await porSlug("mig-dentistas")).nome).toBe("Dentistas");
  });

  it("dois setores com o mesmo nome: só o do endereço certo ganha o ramo (e o índice único não quebra)", async () => {
    expect((await porSlug("brinquedos-infantis")).ramoCatalogo).toBe("infantil-e-brinquedos");
    expect((await porSlug("mig-nome-diferente")).ramoCatalogo).toBeNull();
  });

  it("rodar de novo não muda nada e não dá erro", async () => {
    const antes = await db().select().from(nichos).orderBy(nichos.id);
    await rodarMigracaoDeDado();
    expect(await db().select().from(nichos).orderBy(nichos.id)).toEqual(antes);
  });

  it("depois dela, escolher o ramo cai no setor que já existia (a base continua a mesma), sem criar outro nem pesquisar", async () => {
    const existente = await porSlug("produtos-de-limpeza");

    const { nicho, criado } = await garantirNichoDoRamo("limpeza-e-organizacao-da-casa");

    expect(criado).toBe(false);
    expect(nicho.id).toBe(existente.id);
    expect(await jobsDePesquisaDe(existente.id)).toBe(0);
  });

  it("num banco sem nenhum desses setores (dev, testes), não casa linha nenhuma", async () => {
    await db().execute(sql`delete from nichos where slug in ('produtos-de-limpeza', 'adesivo-automotivo', 'empreendedorismo-e-construcao-de-marcas', 'cosmeticos', 'brinquedos-infantis', 'mig-nome-diferente')`);
    await expect(rodarMigracaoDeDado()).resolves.toBeUndefined();
    const aindaComRamoDosCinco = await db()
      .select()
      .from(nichos)
      .where(sql`${nichos.ramoCatalogo} in ('limpeza-e-organizacao-da-casa', 'estetica-automotiva', 'empreendedorismo-e-negocios', 'infantil-e-brinquedos')`);
    expect(aindaComRamoDosCinco.filter((n) => n.slug.startsWith("mig-"))).toHaveLength(0);
  });
});
