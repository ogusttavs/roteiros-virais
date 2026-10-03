/**
 * Os gatilhos da leitura da marca (E38 PR 2): `salvarDadosFixos` (o Começar) e `salvarPerfilConta`
 * (a Conta) só enfileiram `entender-marca` quando o site ou um perfil que se lê (Instagram, YouTube)
 * mudou. Salvar de novo sem mexer não bate no site da pessoa; apagar tudo não enfileira nada; mexer
 * só no TikTok (que não é lido) também não. O PR 1 deixou o Começar sem gatilho nenhum.
 *
 * O envio é "sem esperar" (`void ...`): os testes esperam por sondagem (o positivo) e olham por um tempo
 * (o negativo), nunca por um intervalo fixo que passe só por sorte. Endereços e perfis são fictícios
 * (`.test`), e a fila é limpa antes e depois: um worker de desenvolvimento no mesmo banco não pode ler
 * site de verdade por causa de um teste.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

async function contarJobs(clienteId: number, fila: string): Promise<number> {
  const resultado = await db().execute(sql`
    select count(*)::int as total from pgboss.job
    where name = ${fila} and (data ->> 'clienteId')::int = ${clienteId}
  `);
  return Number((resultado.rows[0] as { total: number }).total);
}

/** O positivo: espera (até 5 s) o envio "sem esperar" chegar, e confere o total exato. */
async function esperarJobs(clienteId: number, fila: string, esperado: number): Promise<void> {
  await expect.poll(() => contarJobs(clienteId, fila), { timeout: 5_000, interval: 50 }).toBe(esperado);
}

/** O negativo: olha por meio segundo (o envio leva dezenas de milissegundos) e exige que nunca apareça nada. */
async function garantirSemJobs(clienteId: number, fila: string): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    expect(await contarJobs(clienteId, fila)).toBe(0);
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
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
  await limparFilas();
  await boss().stop({ graceful: false });
  await getPool().end();
});

beforeEach(limparFilas);
afterEach(limparFilas);

describe("salvarDadosFixos (o Começar)", () => {
  it("a primeira vez, com site e Instagram: enfileira a leitura da marca e a análise do próprio perfil", async () => {
    const clienteId = await criarCliente();

    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test", instagram: "loja.exemplo" }));

    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
  });

  it("salvar de novo sem mudar nada não enfileira de novo (nem bate no site da pessoa)", async () => {
    const clienteId = await criarCliente();
    const dados = dadosFixos({ site: "https://loja-exemplo.test", instagram: "loja.exemplo" });
    await salvarDadosFixos(clienteId, dados);
    await esperarJobs(clienteId, FILAS.entenderMarca, 1); // espera o primeiro envio (é "sem esperar") antes de limpar
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
    await limparFilas();

    await salvarDadosFixos(clienteId, dados);

    await garantirSemJobs(clienteId, FILAS.entenderMarca);
    await garantirSemJobs(clienteId, FILAS.analisarPerfil);
  });

  it("o mesmo endereço escrito de outro jeito (maiúscula, barra no fim) não conta como mudança", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test", instagram: "Loja.Exemplo" }));
    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await limparFilas();

    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test/", instagram: "@loja.exemplo" }));

    await garantirSemJobs(clienteId, FILAS.entenderMarca);
  });

  it("sem site e sem perfil nenhum: não há o que ler, não enfileira", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos());
    await garantirSemJobs(clienteId, FILAS.entenderMarca);
  });

  it("só o TikTok (que não é lido): não enfileira a leitura da marca", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ tiktok: "perfil.tiktok" }));
    await garantirSemJobs(clienteId, FILAS.entenderMarca);
  });

  it("trocar o site depois enfileira de novo; e o segundo 'Salvar', logo em seguida (a pessoa corrigiu o endereço), nunca é engolido pelo primeiro", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test" }));

    // Sem limpar a fila entre os dois: é o que a pessoa faz ao errar uma letra e corrigir segundos depois.
    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://outra-loja-exemplo.test" }));

    await esperarJobs(clienteId, FILAS.entenderMarca, 2);
  });

  it("mexer só no site relê a marca, mas não gasta a análise do perfil das redes (que não mudaram)", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test", instagram: "loja.exemplo" }));
    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
    await limparFilas();

    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://outra-loja-exemplo.test", instagram: "loja.exemplo" }));

    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await garantirSemJobs(clienteId, FILAS.analisarPerfil);
  });

  it("mudar o Instagram relê a marca e analisa o perfil novo", async () => {
    const clienteId = await criarCliente();
    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test", instagram: "loja.exemplo" }));
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
    await limparFilas();

    await salvarDadosFixos(clienteId, dadosFixos({ site: "https://loja-exemplo.test", instagram: "outra.loja" }));

    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
  });
});

describe("salvarPerfilConta (a Conta)", () => {
  const PERFIS_VAZIOS = { instagram: "", tiktok: "", youtube: "" };

  it("o site agora se edita na Conta: grava, e enfileira a leitura", async () => {
    const clienteId = await criarCliente();

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site: " https://loja-exemplo.test " });

    expect(cliente.site).toBe("https://loja-exemplo.test");
    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
  });

  it("o endereço digitado sem o https:// (o que quase todo mundo faz) é aceito e guardado com https://", async () => {
    const clienteId = await criarCliente();

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site: "loja-exemplo.test" });

    expect(cliente.site).toBe("https://loja-exemplo.test");
    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
  });

  it("quem não manda o campo do site (chamada antiga) nunca apaga o que está gravado nem enfileira", async () => {
    const clienteId = await criarCliente();
    await db().update(clientes).set({ site: "https://loja-exemplo.test" }).where(eq(clientes.id, clienteId));

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca nova", perfis: PERFIS_VAZIOS });

    expect(cliente.site).toBe("https://loja-exemplo.test");
    await garantirSemJobs(clienteId, FILAS.entenderMarca);
  });

  it("site vazio apaga o site", async () => {
    const clienteId = await criarCliente();
    await db().update(clientes).set({ site: "https://loja-exemplo.test" }).where(eq(clientes.id, clienteId));

    const cliente = await salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site: "" });

    expect(cliente.site).toBeNull();
    await garantirSemJobs(clienteId, FILAS.entenderMarca);
  });

  it("endereço que não parece site, ou que tem porta, usuário e senha, ou é de rede interna, é recusado e nada é gravado", async () => {
    const clienteId = await criarCliente();
    for (const site of [
      "isso nao e um site",
      "https://loja-exemplo.test:6379/",
      "https://usuario:senha@loja-exemplo.test",
      "https://169.254.169.254",
      "https://impressora.local",
      `https://loja-exemplo.test/${"a".repeat(3_000)}`,
    ]) {
      await expect(salvarPerfilConta(clienteId, { nome: "Marca", perfis: PERFIS_VAZIOS, site }), site.slice(0, 40)).rejects.toThrow();
    }
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(cliente.site).toBeNull();
  });

  it("salvar a Conta sem mexer no site nem nos perfis não enfileira a leitura da marca nem a análise do próprio perfil", async () => {
    const clienteId = await criarCliente();
    const dados = { nome: "Marca", perfis: { instagram: "loja.exemplo", tiktok: "", youtube: "" }, site: "https://loja-exemplo.test" };
    await salvarPerfilConta(clienteId, dados);
    await esperarJobs(clienteId, FILAS.entenderMarca, 1); // espera o primeiro envio antes de limpar
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
    await limparFilas();

    await salvarPerfilConta(clienteId, { ...dados, nome: "Marca com outro nome" });

    await garantirSemJobs(clienteId, FILAS.entenderMarca);
    await garantirSemJobs(clienteId, FILAS.analisarPerfil);
  });

  it("mudar o Instagram enfileira de novo, a leitura da marca e a análise do perfil", async () => {
    const clienteId = await criarCliente();
    await salvarPerfilConta(clienteId, { nome: "Marca", perfis: { instagram: "loja.exemplo", tiktok: "", youtube: "" } });
    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
    await limparFilas();

    await salvarPerfilConta(clienteId, { nome: "Marca", perfis: { instagram: "outra.loja", tiktok: "", youtube: "" } });

    await esperarJobs(clienteId, FILAS.entenderMarca, 1);
    await esperarJobs(clienteId, FILAS.analisarPerfil, 1);
  });

  it("mexer só no TikTok não enfileira nada: o TikTok não é lido nem analisado por aqui", async () => {
    const clienteId = await criarCliente();

    await salvarPerfilConta(clienteId, { nome: "Marca", perfis: { instagram: "", tiktok: "perfil.tiktok", youtube: "" } });

    await garantirSemJobs(clienteId, FILAS.entenderMarca);
    await garantirSemJobs(clienteId, FILAS.analisarPerfil);
  });
});
