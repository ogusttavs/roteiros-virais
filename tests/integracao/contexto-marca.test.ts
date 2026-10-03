/**
 * Serviço `contexto-marca` (E38 PR 2) contra o Postgres real: o que a seção do briefing lê, as quatro
 * ações da pessoa (confirmar, corrigir, tirar, desfazer) e, o que mais importa, o que chega ao perfil
 * compilado (`perfilDoCliente`) e por ele a todo roteiro, tema e plano: só o que ela confirmou ou
 * corrigiu e não tirou. Proposta pendente nunca chega a um prompt.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, contextoMarca, contextoMarcaItens, user, type PerfilCompilado } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { formatarPerfilCompilado, perfilDoCliente } from "@/servicos/briefing";
import {
  confirmarItem,
  contextoConfirmadoDoCliente,
  corrigirItem,
  desfazerTirarItem,
  enfileirarEntenderMarca,
  ErroContextoMarca,
  secaoDoCliente,
  tirarItem,
} from "@/servicos/contexto-marca";

import { resetarSchema } from "../../scripts/resetar-schema";

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "removedor de manchas",
    preco: "30 a 90 reais",
    clienteIdeal: "quem cuida da casa",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "Loja de produtos de limpeza para tecido.",
  referencias: [],
};

const AGORA = new Date("2026-10-03T12:00:00Z");
let sequencia = 0;

async function criarCliente(extra: Partial<typeof clientes.$inferInsert> = {}, comPerfil = true): Promise<number> {
  sequencia += 1;
  const id = `contexto-marca-${sequencia}`;
  const [usuario] = await db().insert(user).values({ id: `${id}-usuario`, name: `[teste] ${id}`, email: `${id}@contexto-marca.teste` }).returning();
  const [cliente] = await db().insert(clientes).values({ usuarioId: usuario.id, nome: `[teste] ${id}`, ...extra }).returning();
  if (comPerfil) {
    await db().insert(briefings).values({ clienteId: cliente.id, completo: true, notaGeral: "9.00", perfil: PERFIL });
  }
  return cliente.id;
}

async function criarItem(clienteId: number, parcial: Partial<typeof contextoMarcaItens.$inferInsert> = {}): Promise<number> {
  const [item] = await db()
    .insert(contextoMarcaItens)
    .values({ clienteId, categoria: "vende", origem: "site", texto: "Vende removedor de manchas para tecido claro.", ...parcial })
    .returning({ id: contextoMarcaItens.id });
  return item.id;
}

async function itemPorId(id: number) {
  const [item] = await db().select().from(contextoMarcaItens).where(eq(contextoMarcaItens.id, id));
  return item;
}

beforeAll(async () => {
  await resetarSchema(db());
  await garantirBossPronto();
}, 60_000);

afterAll(async () => {
  await boss().stop({ graceful: false });
  await getPool().end();
});

describe("perfilDoCliente: só o que a pessoa confirmou chega aos prompts", () => {
  it("sem nenhum item, o perfil é o de sempre (sem o campo)", async () => {
    const clienteId = await criarCliente();
    const perfil = await perfilDoCliente(clienteId);
    expect(perfil).not.toBeNull();
    expect("contextoConfirmado" in perfil!).toBe(false);
  });

  it("proposta pendente nunca entra, nem no texto do prompt", async () => {
    const clienteId = await criarCliente();
    await criarItem(clienteId, { estado: "para_confirmar" });

    const perfil = await perfilDoCliente(clienteId);

    expect(perfil?.contextoConfirmado).toBeUndefined();
    expect(formatarPerfilCompilado(perfil!)).not.toContain("confirmou sobre a própria marca");
  });

  it("confirmar traz o texto da IA; corrigir traz o texto da pessoa; tirar tira; desfazer devolve", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId);

    await confirmarItem(clienteId, id);
    expect((await perfilDoCliente(clienteId))?.contextoConfirmado).toEqual([{ categoria: "vende", texto: "Vende removedor de manchas para tecido claro." }]);

    await corrigirItem(clienteId, id, "  Vende removedor\n de manchas só para tecido branco. ");
    expect((await perfilDoCliente(clienteId))?.contextoConfirmado).toEqual([{ categoria: "vende", texto: "Vende removedor de manchas só para tecido branco." }]);
    expect(formatarPerfilCompilado((await perfilDoCliente(clienteId))!)).toContain("- O que vende ou faz: Vende removedor de manchas só para tecido branco.");

    await tirarItem(clienteId, id);
    expect((await perfilDoCliente(clienteId))?.contextoConfirmado).toBeUndefined();

    await desfazerTirarItem(clienteId, id);
    expect((await perfilDoCliente(clienteId))?.contextoConfirmado).toEqual([{ categoria: "vende", texto: "Vende removedor de manchas só para tecido branco." }]);
  });

  it("uma proposta nova por cima de um item confirmado não tira o que estava em vigor", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId);
    await confirmarItem(clienteId, id);
    // O que o job faz quando o site muda: a proposta vira outra e o item volta a confirmar.
    await db().update(contextoMarcaItens).set({ texto: "Agora também vende amaciante.", estado: "para_confirmar", novidade: "mudou" }).where(eq(contextoMarcaItens.id, id));

    expect(await contextoConfirmadoDoCliente(clienteId)).toEqual([{ categoria: "vende", texto: "Vende removedor de manchas para tecido claro." }]);
  });

  it("sem briefing compilado, continua nulo (nada a mesclar)", async () => {
    const clienteId = await criarCliente({}, false);
    await db().insert(briefings).values({ clienteId });
    expect(await perfilDoCliente(clienteId)).toBeNull();
  });

  it("a ordem no prompt é por categoria, nunca pela ordem em que a pessoa confirmou", async () => {
    const clienteId = await criarCliente();
    const rendeu = await criarItem(clienteId, { categoria: "rendeu", texto: "O antes e depois rende mais." });
    const vende = await criarItem(clienteId, { categoria: "vende", texto: "Vende removedor." });
    await confirmarItem(clienteId, rendeu);
    await confirmarItem(clienteId, vende);

    expect((await contextoConfirmadoDoCliente(clienteId)).map((i) => i.categoria)).toEqual(["vende", "rendeu"]);
  });
});

describe("as quatro ações da pessoa", () => {
  it("confirmar duas vezes (duplo toque) não dá erro; confirmar o que foi tirado, sim", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId);
    await confirmarItem(clienteId, id);
    await expect(confirmarItem(clienteId, id)).resolves.toBeUndefined();

    await tirarItem(clienteId, id);
    await expect(confirmarItem(clienteId, id)).rejects.toBeInstanceOf(ErroContextoMarca);
  });

  it("confirmar limpa a pílula de novidade e guarda quando", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId, { novidade: "nova" });
    await confirmarItem(clienteId, id);
    const item = await itemPorId(id);
    expect(item).toMatchObject({ estado: "confirmado", novidade: null, textoConfirmado: "Vende removedor de manchas para tecido claro." });
    expect(item.confirmadoEm).not.toBeNull();
  });

  it("corrigir: texto vazio e texto longo demais são recusados, e nada é cortado em silêncio", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId);
    await expect(corrigirItem(clienteId, id, "   ")).rejects.toThrow("escreva o que está certo.");
    await expect(corrigirItem(clienteId, id, "a ".repeat(400))).rejects.toThrow("longo demais");
    const texto500 = `${"palavra ".repeat(62)}fim`;
    expect(texto500.length).toBeLessThanOrEqual(500);
    await corrigirItem(clienteId, id, texto500);
    expect((await itemPorId(id)).textoConfirmado).toBe(texto500);
  });

  it("tirar e desfazer devolvem o estado de antes (confirmado volta confirmado, não a confirmar)", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId);
    await confirmarItem(clienteId, id);

    await tirarItem(clienteId, id);
    expect(await itemPorId(id)).toMatchObject({ estado: "recusado", estadoAnterior: "confirmado" });

    await desfazerTirarItem(clienteId, id);
    expect(await itemPorId(id)).toMatchObject({ estado: "confirmado", estadoAnterior: null });
  });

  it("tirar duas vezes é inofensivo e desfazer o que não foi tirado também", async () => {
    const clienteId = await criarCliente();
    const id = await criarItem(clienteId);
    await tirarItem(clienteId, id);
    await expect(tirarItem(clienteId, id)).resolves.toBeUndefined();
    expect(await itemPorId(id)).toMatchObject({ estado: "recusado", estadoAnterior: "para_confirmar" });
    await desfazerTirarItem(clienteId, id);
    await expect(desfazerTirarItem(clienteId, id)).resolves.toBeUndefined();
    expect((await itemPorId(id)).estado).toBe("para_confirmar");
  });

  it("id que não existe, ou que é de outra marca: erro, e nada muda", async () => {
    const a = await criarCliente();
    const b = await criarCliente();
    const id = await criarItem(a);
    for (const acao of [
      () => confirmarItem(b, id),
      () => corrigirItem(b, id, "texto"),
      () => tirarItem(b, id),
      () => desfazerTirarItem(b, id),
      () => confirmarItem(a, 99_999_999),
    ]) {
      await expect(acao()).rejects.toBeInstanceOf(ErroContextoMarca);
    }
    expect(await itemPorId(id)).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });
  });
});

describe("secaoDoCliente: o que a tela mostra", () => {
  it("sem site e sem perfil lido: sem fonte (o TikTok sozinho não conta, mas fica guardado)", async () => {
    const clienteId = await criarCliente({ site: null, perfis: { instagram: null, tiktok: "perfil.tiktok", youtube: null } });
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));

    const secao = await secaoDoCliente(cliente, AGORA);

    expect(secao.estado).toBe("sem_fonte");
    expect(secao.tiktokGuardado).toBe(true);
    expect(secao.itens).toEqual([]);
  });

  it("com fonte e nenhuma tentativa: lendo; tentou e não leu: não leu; leu: ok", async () => {
    const clienteId = await criarCliente({ site: "https://loja-exemplo.test" });
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect((await secaoDoCliente(cliente, AGORA)).estado).toBe("lendo");

    await db().insert(contextoMarca).values({ clienteId, ultimaTentativaEm: new Date(AGORA.getTime() - 3_600_000), fontes: [{ tipo: "site", lida: false, motivo: "bloqueado_pelo_site" }] });
    const naoLeu = await secaoDoCliente(cliente, AGORA);
    expect(naoLeu.estado).toBe("nao_leu");
    expect(naoLeu.fontes).toEqual([{ tipo: "site", lida: false, motivo: "bloqueado_pelo_site" }]);

    await db().update(contextoMarca).set({ ultimaLeituraOkEm: new Date("2026-09-20T10:00:00Z") }).where(eq(contextoMarca.clienteId, clienteId));
    const ok = await secaoDoCliente(cliente, AGORA);
    expect(ok.estado).toBe("ok");
    expect(ok.proximaLeituraEm?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });

  it("os itens vêm por categoria e id; o tirado e o que sumiu sem confirmação não aparecem; o que sumiu e foi confirmado aparece", async () => {
    const clienteId = await criarCliente({ site: "https://loja-exemplo.test" });
    await db().insert(contextoMarca).values({ clienteId, ultimaLeituraOkEm: AGORA, ultimaTentativaEm: AGORA });
    const posta = await criarItem(clienteId, { categoria: "posta", origem: "instagram", texto: "Posta antes e depois." });
    const vende = await criarItem(clienteId, { texto: "Vende removedor." });
    const tirado = await criarItem(clienteId, { categoria: "fala", texto: "Fala formal.", estado: "recusado" });
    const sumiuSemConfirmar = await criarItem(clienteId, { categoria: "fala", texto: "Fala com humor.", sumiuEm: AGORA });
    const sumiuConfirmado = await criarItem(clienteId, { categoria: "rendeu", texto: "O antes e depois rende.", sumiuEm: AGORA, estado: "confirmado", textoConfirmado: "O antes e depois rende." });
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));

    const secao = await secaoDoCliente(cliente, AGORA);

    expect(secao.itens.map((i) => i.id)).toEqual([vende, posta, sumiuConfirmado]);
    expect(secao.itens.map((i) => i.id)).not.toContain(tirado);
    expect(secao.itens.map((i) => i.id)).not.toContain(sumiuSemConfirmar);
  });

  it("o texto mostrado é o da proposta enquanto pendente, e o em vigor depois de confirmar ou corrigir", async () => {
    const clienteId = await criarCliente({ site: "https://loja-exemplo.test" });
    await db().insert(contextoMarca).values({ clienteId, ultimaLeituraOkEm: AGORA });
    const id = await criarItem(clienteId, { texto: "Proposta da IA." });
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect((await secaoDoCliente(cliente, AGORA)).itens[0].texto).toBe("Proposta da IA.");

    await corrigirItem(clienteId, id, "O que eu disse.");
    const depois = (await secaoDoCliente(cliente, AGORA)).itens[0];
    expect(depois).toMatchObject({ texto: "O que eu disse.", estado: "corrigido" });
  });

  it("nunca mostra item de outra marca", async () => {
    const a = await criarCliente({ site: "https://a.exemplo.test" });
    const b = await criarCliente({ site: "https://b.exemplo.test" });
    await criarItem(a, { texto: "Só da marca A." });
    const [clienteB] = await db().select().from(clientes).where(eq(clientes.id, b));
    await db().insert(contextoMarca).values({ clienteId: b, ultimaLeituraOkEm: AGORA });
    expect((await secaoDoCliente(clienteB, AGORA)).itens).toEqual([]);
  });
});

describe("enfileirarEntenderMarca", () => {
  it("duas chamadas seguidas viram um job só; uma chave própria não é engolida pela outra", async () => {
    const clienteId = await criarCliente();
    await db().execute(sql`delete from pgboss.job where name = ${FILAS.entenderMarca}`);

    expect(await enfileirarEntenderMarca(clienteId, "evento")).toBe(true);
    expect(await enfileirarEntenderMarca(clienteId, "evento")).toBe(false);
    expect(await enfileirarEntenderMarca(clienteId, "evento", { chave: `marca-${clienteId}-depois`, janelaSegundos: 600, depoisDeSegundos: 605 })).toBe(true);
  });
});
