/**
 * "Nova conta" do admin nascendo do catálogo de ramos, contra o Postgres real: o ramo do catálogo cria (ou reaproveita) o setor dele e a conta nasce nele; o ramo
 * escrito à mão cria a conta e o pedido aberto; sem ramo, nome vazio e o teto de setores novos do dia não criam conta nenhuma.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, pedidosDeRamo } from "@/db/schema";
import { config } from "@/lib/config";
import { criarMarcaDoCatalogo, ErroCliente } from "@/servicos/clientes";
import { ErroLimiteDeSetores } from "@/servicos/ramos";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("criarMarcaDoCatalogo", () => {
  it("um ramo do catálogo sem setor: o setor nasce, ligado ao ramo, e a conta entra nele com o tipo e o plano pedidos", async () => {
    expect(await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "academia-e-treino"))).toHaveLength(0);
    const marca = await criarMarcaDoCatalogo({ nome: "  Academia da Rua  ", ramoSlug: "academia-e-treino", tipo: "pessoa", plano: "sem_limite" });
    const [setor] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "academia-e-treino"));
    expect(setor.nome).toBe("Academia e treino");
    expect(marca).toMatchObject({ nome: "Academia da Rua", nichoId: setor.id, tipo: "pessoa", plano: "sem_limite" });
  });

  it("o mesmo ramo de novo reaproveita o setor (nenhum setor a mais)", async () => {
    const [antes] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "academia-e-treino"));
    const marca = await criarMarcaDoCatalogo({ nome: "Outra academia", ramoSlug: "academia-e-treino" });
    expect(marca.nichoId).toBe(antes.id);
    expect(await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "academia-e-treino"))).toHaveLength(1);
  });

  it("o ramo escrito à mão: a conta nasce (no ramo mais próximo, se algum casa) e o pedido fica aberto com o texto", async () => {
    const marca = await criarMarcaDoCatalogo({ nome: "Conta sem ramo do catalogo", ramoOutro: "  xyzw abcd  " });
    expect(marca.ramoOutro).toBe("xyzw abcd");
    expect(marca.nichoId).toBeNull();
    const pedidos = await db().select().from(pedidosDeRamo).where(eq(pedidosDeRamo.clienteId, marca.id));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ texto: "xyzw abcd", estado: "aberto" });
  });

  it("sem ramo ou sem nome, ou com um ramo que não existe, não cria conta", async () => {
    const antes = (await db().select().from(clientes)).length;
    await expect(criarMarcaDoCatalogo({ nome: "Sem ramo" })).rejects.toBeInstanceOf(ErroCliente);
    await expect(criarMarcaDoCatalogo({ nome: "   ", ramoSlug: "academia-e-treino" })).rejects.toBeInstanceOf(ErroCliente);
    await expect(criarMarcaDoCatalogo({ nome: "Ramo falso", ramoSlug: "ramo-que-nao-existe" })).rejects.toThrow();
    expect((await db().select().from(clientes)).length).toBe(antes);
  });

  it("o teto de setores novos por dia segura a criação do setor e nenhuma conta nasce", async () => {
    const original = config.regras.setoresNovosPorDia;
    (config.regras as { setoresNovosPorDia: number }).setoresNovosPorDia = 1;
    try {
      const antes = (await db().select().from(clientes)).length;
      await expect(criarMarcaDoCatalogo({ nome: "Cheia", ramoSlug: "veterinaria-e-pet" })).rejects.toBeInstanceOf(ErroLimiteDeSetores);
      expect((await db().select().from(clientes)).length).toBe(antes);
    } finally {
      (config.regras as { setoresNovosPorDia: number }).setoresNovosPorDia = original;
    }
  });
});
