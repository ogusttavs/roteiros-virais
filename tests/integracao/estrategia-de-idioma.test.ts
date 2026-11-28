/**
 * E76 PR 3: a estratégia de idioma da marca de mais de um país, gravada pelo Começar (`salvarDadosFixosComPedido`) e lida por marca. Só vale com
 * "mais_de_um_pais"; trocar o onde para um país só apaga a estratégia, no Começar e na Conta (`salvarOndeConta`); e a de uma marca nunca
 * aparece na outra.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, user } from "@/db/schema";
import { estrategiaDaMarca } from "@/lib/estrategia-de-idioma";
import { clientePorId, salvarDadosFixosComPedido, salvarOndeConta } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let marcaA: number;
let marcaB: number;
let nichoId: number;

const base = (extra: Record<string, unknown>) => ({ nome: "[teste] Marca", nichoId, persona: "negocio", ...extra });

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "idioma-ramo", nome: "Idioma ramo" }).returning();
  nichoId = nicho.id;
  await db()
    .insert(user)
    .values([
      { id: "idioma-a", name: "[teste] Idioma A", email: "a@idioma.teste" },
      { id: "idioma-b", name: "[teste] Idioma B", email: "b@idioma.teste" },
    ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "idioma-a", nome: "[teste] Marca A" }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "idioma-b", nome: "[teste] Marca B" }).returning();
  marcaA = a.id;
  marcaB = b.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("a estratégia de idioma por marca", () => {
  it("o Começar grava a estratégia de quem fala com mais de um país, na forma guardada, e ela volta na leitura da marca", async () => {
    await salvarDadosFixosComPedido(
      marcaA,
      base({
        alcance: "mais_de_um_pais",
        paises: "Estados Unidos e Brasil",
        estrategiaIdioma: { modo: "linha_no_outro", principal: "portugues", segundo: "ingles", comoOutro: "sobra que o modo não usa" },
      }),
    );
    const lida = await clientePorId(marcaA);
    expect(lida?.estrategiaIdioma).toEqual({ modo: "linha_no_outro", principal: "portugues", segundo: "ingles", comoOutro: null });
    expect(lida && estrategiaDaMarca(lida)).toEqual({ modo: "linha_no_outro", principal: "portugues", segundo: "ingles", comoOutro: null });
  });

  it("a estratégia de uma marca não aparece na outra", async () => {
    const outra = await clientePorId(marcaB);
    expect(outra?.estrategiaIdioma).toBeNull();
    expect(outra && estrategiaDaMarca(outra)).toBeNull();
  });

  it("marca de um país só não guarda estratégia, mesmo que ela venha no pedido", async () => {
    const { cliente } = await salvarDadosFixosComPedido(
      marcaB,
      base({ alcance: "brasil", estrategiaIdioma: { modo: "so_ingles" } }),
    );
    expect(cliente.estrategiaIdioma).toBeNull();
    expect(estrategiaDaMarca(cliente)).toBeNull();
  });

  it("recusa a estratégia incompleta (metade sem o segundo idioma) e não mexe no que estava gravado", async () => {
    await expect(
      salvarDadosFixosComPedido(marcaA, base({ alcance: "mais_de_um_pais", paises: "Estados Unidos e Brasil", estrategiaIdioma: { modo: "metade", principal: "ingles" } })),
    ).rejects.toThrow();
    const [linha] = await db().select({ estrategiaIdioma: clientes.estrategiaIdioma }).from(clientes).where(eq(clientes.id, marcaA));
    expect(linha?.estrategiaIdioma?.modo).toBe("linha_no_outro");
  });

  it("a Conta mantém a estratégia enquanto a marca continua em mais de um país, e apaga quando ela vira de um país só", async () => {
    const mantida = await salvarOndeConta(marcaA, { alcance: "mais_de_um_pais", paises: "Estados Unidos, Brasil e Portugal" });
    expect(mantida.estrategiaIdioma?.modo).toBe("linha_no_outro");
    const apagada = await salvarOndeConta(marcaA, { alcance: "outro_pais", pais: "Estados Unidos" });
    expect(apagada.estrategiaIdioma).toBeNull();
  });

  it("o Começar com mais de um país e sem a estratégia é recusado no servidor, e o que estava gravado fica", async () => {
    await salvarDadosFixosComPedido(marcaA, base({ alcance: "mais_de_um_pais", paises: "Estados Unidos e Brasil", estrategiaIdioma: { modo: "outro", principal: "ingles", comoOutro: "só inglês nos Reels" } }));
    expect((await clientePorId(marcaA))?.estrategiaIdioma).toEqual({ modo: "outro", principal: "ingles", segundo: null, comoOutro: "só inglês nos Reels" });
    await expect(salvarDadosFixosComPedido(marcaA, base({ alcance: "mais_de_um_pais", paises: "Estados Unidos e Brasil" }))).rejects.toThrow();
    await expect(salvarDadosFixosComPedido(marcaA, base({ alcance: "mais_de_um_pais", paises: "Estados Unidos e Brasil", estrategiaIdioma: null }))).rejects.toThrow();
    expect((await clientePorId(marcaA))?.estrategiaIdioma?.modo).toBe("outro");
  });
});
