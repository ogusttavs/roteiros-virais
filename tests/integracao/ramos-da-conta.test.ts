/**
 * Os ramos alternativos da marca (E45, PR 3), contra o Postgres real: o admin liga até dois, o setor ganha "marca" com o alternativo
 * (não desliga enquanto alguém o usa; volta quando um alternativo o liga), e tirar o último desliga o setor.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, ramosDaConta, user } from "@/db/schema";
import { FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { salvarRamoConta } from "@/servicos/clientes";
import { registrarPedidoDeRamo } from "@/servicos/pedidos-de-ramo";
import { desligarSetorSeSemMarca, ErroLimiteDeSetores, garantirNichoDoRamo, nichoDoRamo } from "@/servicos/ramos";
import {
  ErroRamosDaConta,
  ligarRamoAlternativo,
  MAXIMO_DE_RAMOS_ALTERNATIVOS,
  previaDeLigarRamo,
  ramosAlternativosDaMarca,
  setoresDaConta,
  tirarRamoAlternativo,
} from "@/servicos/ramos-da-conta";

import { resetarSchema } from "../../scripts/resetar-schema";

const ADMIN = "ramos-da-conta-admin";

async function criarMarca(usuarioId: string, nome: string, ramoPrincipal: string | null): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${nome}`, email: `${usuarioId}@ramos-da-conta.teste` });
  const nichoId = ramoPrincipal ? (await garantirNichoDoRamo(ramoPrincipal)).nicho.id : null;
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] ${nome}`, nichoId }).returning();
  return marca.id;
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
  await db().insert(user).values({ id: ADMIN, name: "[teste] Admin", email: `${ADMIN}@ramos-da-conta.teste` });
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("ligar e tirar um ramo alternativo", () => {
  it("liga em um setor que já é pesquisado: a linha nasce, nenhuma pesquisa nova começa, e o setor segue ligado", async () => {
    const dona = await criarMarca("rdc-vivo-a", "Vivo A", "odontologia");
    const outra = await criarMarca("rdc-vivo-b", "Vivo B", "nutricao");
    const setorNutricao = (await nichoDoRamo("nutricao"))!;
    const jobsAntes = await jobsDePesquisaDe(setorNutricao.id);

    const ligado = await ligarRamoAlternativo(dona, "nutricao", ADMIN);

    expect(ligado.nichoId).toBe(setorNutricao.id);
    expect(ligado.ramoSlug).toBe("nutricao");
    expect(await jobsDePesquisaDe(setorNutricao.id)).toBe(jobsAntes);
    expect((await setorPorId(setorNutricao.id)).ativo).toBe(true);
    const [linha] = await db().select().from(ramosDaConta).where(eq(ramosDaConta.clienteId, dona));
    expect(linha.ligadoPorUsuarioId).toBe(ADMIN);
    expect(outra).toBeGreaterThan(0);
  });

  it("liga em um setor parado: o setor volta a ser pesquisado (ligado de novo, com a pesquisa de setor na fila)", async () => {
    const dona = await criarMarca("rdc-parado-a", "Parado A", "odontologia");
    const { nicho } = await garantirNichoDoRamo("veterinaria-e-pet");
    await db().update(nichos).set({ ativo: false }).where(eq(nichos.id, nicho.id));
    await ligarRamoAlternativo(dona, "veterinaria-e-pet", ADMIN);

    expect((await setorPorId(nicho.id)).ativo).toBe(true);
    // A fila deduplica a pesquisa de um setor que já espera (a do nascimento, neste teste): basta que ela exista.
    expect(await jobsDePesquisaDe(nicho.id)).toBeGreaterThanOrEqual(1);
  });

  it("liga em um ramo que ainda não tem setor: o setor nasce com o nome do ramo, ligado, e a pesquisa começa", async () => {
    const dona = await criarMarca("rdc-novo-a", "Novo A", "odontologia");
    expect(await nichoDoRamo("agro-e-campo")).toBeNull();

    const ligado = await ligarRamoAlternativo(dona, "agro-e-campo", ADMIN);

    const setor = (await nichoDoRamo("agro-e-campo"))!;
    expect(setor.id).toBe(ligado.nichoId);
    expect(setor.ativo).toBe(true);
    expect(setor.nome).toBe("Agro e campo");
    expect(await jobsDePesquisaDe(setor.id)).toBeGreaterThan(0);
  });

  it("tirar o único uso do setor (nenhuma outra marca) o desliga; com outra marca usando, ele continua", async () => {
    const dona = await criarMarca("rdc-tira-a", "Tira A", "odontologia");
    const { nicho: sozinho } = await garantirNichoDoRamo("contabilidade-e-financas");
    const ligadoSozinho = await ligarRamoAlternativo(dona, "contabilidade-e-financas", ADMIN);
    const outraMarca = await criarMarca("rdc-tira-b", "Tira B", "advocacia");
    const { nicho: compartilhado } = await garantirNichoDoRamo("advocacia");
    const ligadoCompartilhado = await ligarRamoAlternativo(dona, "advocacia", ADMIN);

    await tirarRamoAlternativo(dona, ligadoSozinho.id);
    await tirarRamoAlternativo(dona, ligadoCompartilhado.id);

    expect((await setorPorId(sozinho.id)).ativo).toBe(false);
    expect((await setorPorId(compartilhado.id)).ativo).toBe(true);
    expect(await ramosAlternativosDaMarca(dona)).toEqual([]);
    expect(outraMarca).toBeGreaterThan(0);
  });

  it("um setor que só tem alternativos ligados não é desligado (ter marca inclui o alternativo), e desliga quando o último sai", async () => {
    const dona = await criarMarca("rdc-so-alt", "So alt", "odontologia");
    const { nicho } = await garantirNichoDoRamo("turismo-e-hospedagem");
    const ligado = await ligarRamoAlternativo(dona, "turismo-e-hospedagem", ADMIN);

    // Nenhuma marca o tem como principal, mas o alternativo basta.
    expect(await desligarSetorSeSemMarca(nicho.id)).toBe(false);
    expect((await setorPorId(nicho.id)).ativo).toBe(true);

    await tirarRamoAlternativo(dona, ligado.id);
    expect((await setorPorId(nicho.id)).ativo).toBe(false);
  });

  it("a marca desativada não segura o setor pelo alternativo", async () => {
    const dona = await criarMarca("rdc-inativa", "Inativa", "odontologia");
    const { nicho } = await garantirNichoDoRamo("fotografia-e-video");
    await ligarRamoAlternativo(dona, "fotografia-e-video", ADMIN);
    await db().update(clientes).set({ ativo: false }).where(eq(clientes.id, dona));

    expect(await desligarSetorSeSemMarca(nicho.id)).toBe(true);
  });
});

describe("as regras do admin, em frase", () => {
  it("o terceiro ramo alternativo é recusado (o máximo é dois), e nada é gravado", async () => {
    const dona = await criarMarca("rdc-max", "Max", "odontologia");
    await ligarRamoAlternativo(dona, "nutricao", ADMIN);
    await ligarRamoAlternativo(dona, "advocacia", ADMIN);

    await expect(ligarRamoAlternativo(dona, "educacao-e-cursos", ADMIN)).rejects.toThrow(/2 ramos alternativos/);
    await expect(ligarRamoAlternativo(dona, "educacao-e-cursos", ADMIN)).rejects.toBeInstanceOf(ErroRamosDaConta);
    expect((await ramosAlternativosDaMarca(dona)).length).toBe(MAXIMO_DE_RAMOS_ALTERNATIVOS);
  });

  it("recusa o ramo principal, o ramo repetido, o ramo desconhecido e a marca sem ramo principal", async () => {
    const dona = await criarMarca("rdc-regras", "Regras", "odontologia");
    const semPrincipal = await criarMarca("rdc-sem-principal", "Sem principal", null);

    await expect(ligarRamoAlternativo(dona, "odontologia", ADMIN)).rejects.toThrow(/ramo principal/);
    await ligarRamoAlternativo(dona, "nutricao", ADMIN);
    await expect(ligarRamoAlternativo(dona, "nutricao", ADMIN)).rejects.toThrow(/já está ligado/);
    await expect(ligarRamoAlternativo(dona, "ramo-que-nao-existe", ADMIN)).rejects.toThrow(/desconhecido/i);
    await expect(ligarRamoAlternativo(semPrincipal, "nutricao", ADMIN)).rejects.toThrow(/ramo principal/);
  });

  it("duas ligações ao mesmo tempo nunca passam do máximo", async () => {
    const dona = await criarMarca("rdc-corrida", "Corrida", "odontologia");
    await ligarRamoAlternativo(dona, "nutricao", ADMIN);

    const resultados = await Promise.allSettled([
      ligarRamoAlternativo(dona, "advocacia", ADMIN),
      ligarRamoAlternativo(dona, "educacao-e-cursos", ADMIN),
      ligarRamoAlternativo(dona, "eventos-e-festas", ADMIN),
    ]);

    expect((await ramosAlternativosDaMarca(dona)).length).toBeLessThanOrEqual(MAXIMO_DE_RAMOS_ALTERNATIVOS);
    expect(resultados.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  });

  it("o teto de setores novos do dia vale ao ligar: lança ErroLimiteDeSetores e nada é gravado", async () => {
    const dona = await criarMarca("rdc-teto", "Teto", "odontologia");
    const nasceramHoje = (await db().select().from(nichos)).filter((n) => n.ramoCatalogo !== null).length;
    config.regras.setoresNovosPorDia = nasceramHoje;
    try {
      await expect(ligarRamoAlternativo(dona, "importacao-e-desenvolvimento-de-produto", ADMIN)).rejects.toBeInstanceOf(ErroLimiteDeSetores);
      expect(await ramosAlternativosDaMarca(dona)).toEqual([]);
    } finally {
      config.regras.setoresNovosPorDia = 1000;
    }
  });

  it("tirar um ramo que já foi tirado, ou de outra marca, é recusado", async () => {
    const dona = await criarMarca("rdc-tira-regras-a", "Tira regras A", "odontologia");
    const outra = await criarMarca("rdc-tira-regras-b", "Tira regras B", "odontologia");
    const ligado = await ligarRamoAlternativo(dona, "nutricao", ADMIN);

    await expect(tirarRamoAlternativo(outra, ligado.id)).rejects.toBeInstanceOf(ErroRamosDaConta);
    await tirarRamoAlternativo(dona, ligado.id);
    await expect(tirarRamoAlternativo(dona, ligado.id)).rejects.toBeInstanceOf(ErroRamosDaConta);
  });
});

describe("um alternativo que a marca depois escolheu como principal", () => {
  it("deixa de contar como alternativo (a lista, os setores da conta e o máximo não o repetem)", async () => {
    const dona = await criarMarca("rdc-virou-principal", "Virou principal", "odontologia");
    const ligado = await ligarRamoAlternativo(dona, "nutricao", ADMIN);
    expect((await ramosAlternativosDaMarca(dona)).map((a) => a.id)).toEqual([ligado.id]);

    await db().update(clientes).set({ nichoId: ligado.nichoId }).where(eq(clientes.id, dona));

    expect(await ramosAlternativosDaMarca(dona)).toEqual([]);
    expect(await setoresDaConta(dona, ligado.nichoId)).toEqual([ligado.nichoId]);
    // E o ramo que era o principal pode ser ligado como alternativo agora.
    await expect(ligarRamoAlternativo(dona, "odontologia", ADMIN)).resolves.toBeDefined();
  });
});

describe("o teto de dois alternativos não fura quando o principal troca (E45 PR 3, item 0a da E48)", () => {
  it("principal P com A e B; A vira o principal e o admin liga C; a marca troca para D: A não reaparece, ficam B e C, e um terceiro continua recusado", async () => {
    const dona = await criarMarca("rdc-teto-troca", "Teto troca", "odontologia");
    await ligarRamoAlternativo(dona, "nutricao", ADMIN);
    await ligarRamoAlternativo(dona, "advocacia", ADMIN);

    await salvarRamoConta(dona, "nutricao");
    // A linha de Nutrição saiu da tabela ao virar principal (não ficou escondida).
    expect((await db().select().from(ramosDaConta).where(eq(ramosDaConta.clienteId, dona))).length).toBe(1);
    await ligarRamoAlternativo(dona, "educacao-e-cursos", ADMIN);
    await salvarRamoConta(dona, "eventos-e-festas");

    const visiveis = (await ramosAlternativosDaMarca(dona)).map((a) => a.ramoSlug);
    expect(visiveis.sort()).toEqual(["advocacia", "educacao-e-cursos"]);
    await expect(ligarRamoAlternativo(dona, "fotografia-e-video", ADMIN)).rejects.toThrow(/2 ramos alternativos/);
  });

  it("o alternativo que vira o principal pelo palpite do 'Não achei o meu' e pelo admin que resolve o pedido também sai da tabela", async () => {
    const dona = await criarMarca("rdc-teto-pedido", "Teto pedido", "odontologia");
    await ligarRamoAlternativo(dona, "nutricao", ADMIN);

    // O palpite de "nutricionista" leva a marca para Nutrição (o provisório): é o principal agora.
    const { pedido } = await registrarPedidoDeRamo(dona, "nutricionista esportiva");
    expect((await db().select().from(ramosDaConta).where(eq(ramosDaConta.clienteId, dona))).length).toBe(0);

    await ligarRamoAlternativo(dona, "advocacia", ADMIN);
    const { encaixarPedido } = await import("@/servicos/pedidos-de-ramo");
    await encaixarPedido(pedido.id, "advocacia");
    expect((await db().select().from(ramosDaConta).where(eq(ramosDaConta.clienteId, dona))).length).toBe(0);
  });

  it("uma linha que ficou parada (igual ao principal) conta no teto: com ela e mais um alternativo, o terceiro é recusado", async () => {
    const dona = await criarMarca("rdc-linha-parada", "Linha parada", "odontologia");
    const principal = (await nichoDoRamo("odontologia"))!;
    const { nicho: nutricao } = await garantirNichoDoRamo("nutricao");
    // Dado antigo, de antes da correção: a linha do próprio principal e um alternativo de verdade.
    await db().insert(ramosDaConta).values([
      { clienteId: dona, nichoId: principal.id },
      { clienteId: dona, nichoId: nutricao.id },
    ]);
    expect((await ramosAlternativosDaMarca(dona)).length).toBe(1);

    await expect(ligarRamoAlternativo(dona, "advocacia", ADMIN)).rejects.toThrow(/2 ramos alternativos/);
  });
});

describe("a lista dos setores da conta e a prévia de custo", () => {
  it("o principal vem primeiro, depois os alternativos na ordem em que foram ligados", async () => {
    const dona = await criarMarca("rdc-lista", "Lista", "odontologia");
    const principal = (await nichoDoRamo("odontologia"))!;
    const a = await ligarRamoAlternativo(dona, "nutricao", ADMIN);
    const b = await ligarRamoAlternativo(dona, "advocacia", ADMIN);

    expect(await setoresDaConta(dona, principal.id)).toEqual([principal.id, a.nichoId, b.nichoId]);
    expect(await setoresDaConta(dona, null)).toEqual([a.nichoId, b.nichoId]);
    const semAlternativo = await criarMarca("rdc-lista-vazia", "Lista vazia", "odontologia");
    expect(await setoresDaConta(semAlternativo, principal.id)).toEqual([principal.id]);
  });

  it("a prévia diz se o setor já é pesquisado ou vai começar (parado e inexistente contam como 'começa')", async () => {
    await garantirNichoDoRamo("moda-e-vestuario");
    const { nicho: parado } = await garantirNichoDoRamo("joias-oculos-e-acessorios");
    await db().update(nichos).set({ ativo: false }).where(eq(nichos.id, parado.id));

    expect((await previaDeLigarRamo("moda-e-vestuario")).estado).toBe("pesquisado");
    expect((await previaDeLigarRamo("joias-oculos-e-acessorios")).estado).toBe("comeca");
    expect((await previaDeLigarRamo("reforma-e-construcao")).estado).toBe("comeca");
    await expect(previaDeLigarRamo("nao-existe")).rejects.toBeInstanceOf(ErroRamosDaConta);
  });
});
