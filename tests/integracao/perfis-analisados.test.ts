/**
 * `src/servicos/perfis-analisados.ts` (E38, partes 2 e 3) contra o Postgres e o pg-boss reais:
 * a leitura para o briefing e para o admin do setor, e as duas funcoes que enfileiram a
 * conferencia (de um perfil citado e da propria marca).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, perfisAnalisados, perfisCitados, user } from "@/db/schema";
import { boss, FILAS } from "@/jobs/fila";
import {
  enfileirarAnaliseDaPropriaMarca,
  enfileirarAnaliseDePerfil,
  leiturasDoCliente,
  listarPerfisIndicados,
} from "@/servicos/perfis-analisados";

import { resetarSchema } from "../../scripts/resetar-schema";

/**
 * Insercao direta na tabela, nunca pelo servico `adicionarPerfilCitado`: aquele servico dispara
 * `enfileirarAnaliseDePerfil` sem esperar (`void ... .catch()`), que polui a fila `analisar-perfil`
 * de verdade por tras, correndo contra as proprias asserções deste arquivo sobre essa fila.
 */
async function criarPerfilCitado(clienteId: number, tipo: "concorrente" | "admira", rede: "youtube" | "instagram", handle: string) {
  const [linha] = await db().insert(perfisCitados).values({ clienteId, tipo, rede, handle }).returning();
  return linha;
}

/**
 * O pg-boss nao e derrubado pelo `resetarSchema` (so "public" e "drizzle"), e o
 * `resetarSchema` reinicia a sequencia de id de `clientes`: um job vazado de outro arquivo pode
 * ter, por coincidencia, o mesmo `clienteId` numerico que um cliente criado aqui. Drenar a fila
 * inteira antes de qualquer teste evita esse falso positivo.
 */
async function drenarFila(): Promise<void> {
  for (;;) {
    const lote = await boss().fetch(FILAS.analisarPerfil, { batchSize: 1000 });
    if (lote.length === 0) return;
  }
}

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  await boss().start();
  await drenarFila();
  const [nicho] = await db().insert(nichos).values({ slug: "perfis-analisados-nicho", nome: "[teste] Nicho", termos: ["teste"], ativo: true }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await boss().stop({ graceful: false });
  await getPool().end();
});

async function criarCliente(prefixo: string, comNicho = false): Promise<number> {
  const [usuario] = await db()
    .insert(user)
    .values({ id: `${prefixo}-usuario`, name: `[teste] ${prefixo}`, email: `${prefixo}@perfis-analisados.teste` })
    .returning();
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: usuario.id, nome: `[teste] ${prefixo}`, nichoId: comNicho ? nichoId : null })
    .returning();
  return cliente.id;
}

describe("leiturasDoCliente", () => {
  it("junta o tipo do perfil citado (concorrente ou admira) quando a origem e citado", async () => {
    const clienteId = await criarCliente("leituras-citado");
    const perfil = await criarPerfilCitado(clienteId, "concorrente", "instagram", "concorrenteteste");
    await db().insert(perfisAnalisados).values({
      clienteId,
      perfilCitadoId: perfil.id,
      origem: "citado",
      rede: "instagram",
      handle: "concorrenteteste",
      leitura: "posta antes e depois.",
    });

    const [linha] = await leiturasDoCliente(clienteId);
    expect(linha.tipoCitado).toBe("concorrente");
    expect(linha.leitura).toBe("posta antes e depois.");
  });

  it("tipoCitado nulo quando a origem e a propria marca (sem perfilCitadoId)", async () => {
    const clienteId = await criarCliente("leituras-propria-marca");
    await db().insert(perfisAnalisados).values({
      clienteId,
      perfilCitadoId: null,
      origem: "propria_marca",
      rede: "youtube",
      handle: "marcateste",
      leitura: "o que mais rende e o bastidor.",
    });

    const [linha] = await leiturasDoCliente(clienteId);
    expect(linha.tipoCitado).toBeNull();
    expect(linha.origem).toBe("propria_marca");
  });

  it("isolado por cliente", async () => {
    const clienteA = await criarCliente("leituras-isolado-a");
    const clienteB = await criarCliente("leituras-isolado-b");
    await db().insert(perfisAnalisados).values({ clienteId: clienteA, perfilCitadoId: null, origem: "propria_marca", rede: "youtube", handle: "soA" });

    expect(await leiturasDoCliente(clienteB)).toHaveLength(0);
    expect(await leiturasDoCliente(clienteA)).toHaveLength(1);
  });
});

describe("listarPerfisIndicados", () => {
  it("lista so quem qualificou e ainda nao virou conta, com o nome do cliente", async () => {
    const clienteId = await criarCliente("indicados-qualifica", true);
    await db().insert(perfisAnalisados).values({
      clienteId,
      perfilCitadoId: null,
      origem: "citado",
      rede: "youtube",
      handle: "qualificado",
      qualificaParaSetor: true,
    });

    const lista = await listarPerfisIndicados(nichoId);
    expect(lista.some((p) => p.handle === "qualificado" && p.clienteNome === "[teste] indicados-qualifica")).toBe(true);
  });

  it("nao lista quem nao qualificou", async () => {
    const clienteId = await criarCliente("indicados-nao-qualifica", true);
    await db().insert(perfisAnalisados).values({
      clienteId,
      perfilCitadoId: null,
      origem: "citado",
      rede: "youtube",
      handle: "naoqualificado",
      qualificaParaSetor: false,
    });

    const lista = await listarPerfisIndicados(nichoId);
    expect(lista.some((p) => p.handle === "naoqualificado")).toBe(false);
  });

  it("nao lista quem ja virou conta do setor", async () => {
    const clienteId = await criarCliente("indicados-ja-virou", true);
    await db().insert(perfisAnalisados).values({
      clienteId,
      perfilCitadoId: null,
      origem: "citado",
      rede: "youtube",
      handle: "javirou",
      qualificaParaSetor: true,
      viraDoSetorEm: new Date(),
    });

    const lista = await listarPerfisIndicados(nichoId);
    expect(lista.some((p) => p.handle === "javirou")).toBe(false);
  });

  it("nao lista perfil de cliente de outro setor", async () => {
    const [outroNicho] = await db().insert(nichos).values({ slug: "perfis-analisados-outro-nicho", nome: "[teste] Outro nicho", termos: [], ativo: true }).returning();
    const [usuario] = await db().insert(user).values({ id: "indicados-outro-setor-usuario", name: "[teste] outro setor", email: "outro-setor@perfis-analisados.teste" }).returning();
    const [cliente] = await db().insert(clientes).values({ usuarioId: usuario.id, nome: "[teste] outro setor", nichoId: outroNicho.id }).returning();
    await db().insert(perfisAnalisados).values({
      clienteId: cliente.id,
      perfilCitadoId: null,
      origem: "citado",
      rede: "youtube",
      handle: "deoutrosetor",
      qualificaParaSetor: true,
    });

    const lista = await listarPerfisIndicados(nichoId);
    expect(lista.some((p) => p.handle === "deoutrosetor")).toBe(false);
  });
});

/**
 * A fila `analisar-perfil` e compartilhada com o resto da suite (o pg-boss nao e derrubado pelo
 * `resetarSchema`, e outros arquivos, como `perfis-citados.test.ts` e `dados-fixos.test.ts`,
 * disparam o mesmo enfileiramento de verdade, sem esperar, pelos proprios servicos deles). Em vez
 * de assumir a fila vazia, cada teste busca um lote grande e filtra pelo `clienteId` proprio.
 */
async function jobsDoCliente(clienteId: number) {
  const jobs = await boss().fetch<{ clienteId: number }>(FILAS.analisarPerfil, { batchSize: 1000 });
  return jobs.filter((j) => j.data.clienteId === clienteId);
}

describe("enfileirarAnaliseDePerfil", () => {
  it("manda um job para a fila analisar-perfil com os dados do perfil citado", async () => {
    const clienteId = await criarCliente("enfileirar-citado");
    const perfil = await criarPerfilCitado(clienteId, "admira", "youtube", "canaladmirado");

    await enfileirarAnaliseDePerfil(clienteId, perfil.id);

    const jobs = await jobsDoCliente(clienteId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({
      clienteId,
      perfilCitadoId: perfil.id,
      origem: "citado",
      tipoCitado: "admira",
      rede: "youtube",
      handle: "canaladmirado",
    });
  });

  it("perfil citado inexistente: nao manda nada", async () => {
    const clienteId = await criarCliente("enfileirar-citado-inexistente");

    await enfileirarAnaliseDePerfil(clienteId, 999_999);

    expect(await jobsDoCliente(clienteId)).toHaveLength(0);
  });
});

describe("enfileirarAnaliseDaPropriaMarca", () => {
  it("manda um job por rede preenchida, nenhum para rede vazia", async () => {
    const clienteId = await criarCliente("enfileirar-propria-marca");

    await enfileirarAnaliseDaPropriaMarca(clienteId, { instagram: "@marcateste", youtube: null, tiktok: "@tiktokteste" });

    const jobs = await jobsDoCliente(clienteId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ clienteId, origem: "propria_marca", rede: "instagram", handle: "@marcateste" });
  });

  it("nenhuma rede preenchida: nao manda nada", async () => {
    const clienteId = await criarCliente("enfileirar-propria-marca-vazia");

    await enfileirarAnaliseDaPropriaMarca(clienteId, { instagram: null, youtube: null, tiktok: null });

    expect(await jobsDoCliente(clienteId)).toHaveLength(0);
  });
});
