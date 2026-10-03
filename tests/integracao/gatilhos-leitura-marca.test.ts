/**
 * Os gatilhos da leitura da marca (E38 PR 2): `salvarDadosFixos` (o Começar) e `salvarPerfilConta`
 * (a Conta) só enfileiram `entender-marca` quando o site ou um perfil que se lê (Instagram, YouTube)
 * mudou. Salvar de novo sem mexer não bate no site da pessoa; apagar tudo não enfileira nada; mexer
 * só no TikTok (que não é lido) também não. O PR 1 deixou o Começar sem gatilho nenhum.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, user } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { salvarDadosFixos, salvarPerfilConta } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;
let sequencia = 0;

async function criarCliente(): Promise<number> {
  sequencia += 1;
  const id = `gatilho-leitura-${sequencia}`;
  const [usuario] = await db().insert(user).values({ id: `${id}-usuario`, name: `[teste] ${id}`, email: `${id}@gatilho.teste` }).returning();
  const [cliente] = await db().insert(clientes).values({ usuarioId: usuario.id, nome: `[teste] ${id}` }).returning();
  return cliente.id;
}

function dadosFixos(extra: { site?: string; instagram?: string; tiktok?: string; youtube?: string } = {}) {
  return {
    nome: "Marca de teste",
    alcance: "brasil",
    nichoId,
    persona: "negocio",
    site: extra.site,
    perfis: { instagram: extra.instagram, tiktok: extra.tiktok, youtube: extra.youtube },
  };
}

async function jobsDoCliente(clienteId: number, fila: string): Promise<number> {
  // O envio é "sem esperar" (`void ...`): dá um instante para o pg-boss gravar.
  await new Promise((resolver) => setTimeout(resolver, 150));
  const resultado = await db().execute(sql`
    select count(*)::int as total from pgboss.job
    where name = ${fila} and (data ->> 'clienteId')::int = ${clienteId}
  `);
  return Number((resultado.rows[0] as { total: number }).total);
}

async function limparFilas(): Promise<void> {
  await db().execute(sql`delete from pgboss.job where name in (${FILAS.entenderMarca}, ${FILAS.analisarPerfil})`);
}

beforeAll(async () => {
  await resetarSchema(db());
  await garantirBossPronto();
  const [nicho] = await db().insert(nichos).values({ slug: "gatilho-leitura", nome: "Gatilho leitura" }).returning();
  nichoId = nicho.id;
}, 60_000);

afterAll(async () => {
  await boss().stop({ graceful: false });
  await getPool().end();
});

beforeEach(limparFilas);

describe("salvarDadosFixos (o Começar)", () => {
  it("a primeira vez, com site e Instagram: enfileira a leitura da marca e a análise do próprio perfil", async () => {
    const clienteId = await criarCliente();

    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.com.br", instagram: "loja.exemplo" }));

    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1);
    expect(await jobsDoCliente(clienteId, FILAS.analisarPerfil)).toBe(1);
  });

  it("salvar de novo sem mudar nada não enfileira de novo (nem bate no site da pessoa)", async () => {
    const clienteId = await criarCliente();
    const dados = dadosFixos({ site: "https://loja-exemplo.com.br", instagram: "loja.exemplo" });
    await salvarDadosFixos(clienteId, dados);
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1); // espera o primeiro envio (é "sem esperar") antes de limpar
    await limparFilas();

    await salvarDadosFixos(clienteId, dados);

    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(0);
    expect(await jobsDoCliente(clienteId, FILAS.analisarPerfil)).toBe(0);
  });

  it("sem site e sem perfil nenhum: não há o que ler, não enfileira", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos());
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(0);
  });

  it("só o TikTok (que não é lido): não enfileira", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ tiktok: "perfil.tiktok" }));
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(0);
  });

  it("trocar o site depois enfileira de novo", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.com.br" }));
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1);
    await limparFilas();

    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://outra-loja-exemplo.com.br" }));

    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1);
  });
});

describe("salvarPerfilConta (a Conta)", () => {
  const PERFIS_VAZIOS = { instagram: "", tiktok: "", youtube: "" };

  it("o site agora se edita na Conta: grava, e enfileira a leitura", async () => {
    const clienteId = await criarCliente();

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site: " https://loja-exemplo.com.br " });

    expect(cliente.site).toBe("https://loja-exemplo.com.br");
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1);
  });

  it("quem não manda o campo do site (chamada antiga) nunca apaga o que está gravado nem enfileira", async () => {
    const clienteId = await criarCliente();
    await db().update(clientes).set({ site: "https://loja-exemplo.com.br" }).where(eq(clientes.id, clienteId));

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca nova", perfis: PERFIS_VAZIOS });

    expect(cliente.site).toBe("https://loja-exemplo.com.br");
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(0);
  });

  it("site vazio apaga o site", async () => {
    const clienteId = await criarCliente();
    await db().update(clientes).set({ site: "https://loja-exemplo.com.br" }).where(eq(clientes.id, clienteId));

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site: "" });

    expect(cliente.site).toBeNull();
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(0);
  });

  it("endereço que não parece site é recusado e nada é gravado", async () => {
    const clienteId = await criarCliente();
    await expect(salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site: "isso nao e um site" })).rejects.toThrow();
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(cliente.site).toBeNull();
  });

  it("salvar a Conta sem mexer no site nem nos perfis lidos não enfileira a leitura da marca", async () => {
    const clienteId = await criarCliente();
    const dados = { nome: "Marca", perfis: { instagram: "loja.exemplo", tiktok: "", youtube: "" }, site: "https://loja-exemplo.com.br" };
    await salvarPerfilConta(clienteId, dados);
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1); // espera o primeiro envio antes de limpar
    await limparFilas();

    await salvarPerfilConta(clienteId, { ...dados, nome: "Marca com outro nome" });

    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(0);
  });

  it("mudar o Instagram enfileira de novo", async () => {
    const clienteId = await criarCliente();
    await salvarPerfilConta(clienteId, { nome: "Marca", perfis: { instagram: "loja.exemplo", tiktok: "", youtube: "" } });
    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1);
    await limparFilas();

    await salvarPerfilConta(clienteId, { nome: "Marca", perfis: { instagram: "outra.loja", tiktok: "", youtube: "" } });

    expect(await jobsDoCliente(clienteId, FILAS.entenderMarca)).toBe(1);
  });
});
