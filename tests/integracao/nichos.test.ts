/**
 * Nicho pelo admin (etapa 24, parte 1 do plano): criar, editar, ativar e
 * desativar, e acrescentar contas semente. Contra o Postgres real (etapa 24,
 * criterio de aceite: "teste de integracao de criar, editar, desativar e da
 * conta semente virar vigiada").
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos } from "@/db/schema";
import {
  adicionarContasSemente,
  alternarAtivoNicho,
  atualizarNicho,
  criarNicho,
  ErroNicho,
} from "@/servicos/nichos";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

const TERMOS_VALIDOS = "dentista\nortodontia\nclareamento\nimplante\ncanal".trim();

describe("criarNicho", () => {
  it("cria com slug gerado do nome, ativo, com os termos normalizados", async () => {
    const nicho = await criarNicho({
      nome: "Produtos de Limpeza",
      descricao: "marca propria de limpeza",
      termosBruto: TERMOS_VALIDOS,
    });

    expect(nicho.slug).toBe("produtos-de-limpeza");
    expect(nicho.ativo).toBe(true);
    expect(nicho.termos).toEqual(["dentista", "ortodontia", "clareamento", "implante", "canal"]);
  });

  it("recusa menos de 5 termos", async () => {
    await expect(
      criarNicho({ nome: "Nicho com poucos termos", termosBruto: "um\ndois\ntres" }),
    ).rejects.toThrow(ErroNicho);
  });

  it("recusa mais de 20 termos", async () => {
    const vinteEUm = Array.from({ length: 21 }, (_, i) => `termo${i}`).join("\n");
    await expect(criarNicho({ nome: "Nicho com termos demais", termosBruto: vinteEUm })).rejects.toThrow(
      ErroNicho,
    );
  });

  it("recusa nome que gera um slug ja usado (nada de sufixo automatico)", async () => {
    await criarNicho({ nome: "Estetica e Beleza", termosBruto: TERMOS_VALIDOS });

    await expect(
      criarNicho({ nome: "estética e beleza", termosBruto: TERMOS_VALIDOS }),
    ).rejects.toThrow(ErroNicho);
  });

  it("recusa nome vazio", async () => {
    await expect(criarNicho({ nome: "   ", termosBruto: TERMOS_VALIDOS })).rejects.toThrow(ErroNicho);
  });
});

describe("atualizarNicho", () => {
  it("atualiza nome, descricao e termos, sem mudar o slug", async () => {
    const criado = await criarNicho({ nome: "Nicho para editar", termosBruto: TERMOS_VALIDOS });

    const atualizado = await atualizarNicho(criado.id, {
      nome: "Nicho editado",
      descricao: "nova descricao",
      termosBruto: "termo-a\ntermo-b\ntermo-c\ntermo-d\ntermo-e",
    });

    expect(atualizado.slug).toBe(criado.slug);
    expect(atualizado.nome).toBe("Nicho editado");
    expect(atualizado.descricao).toBe("nova descricao");
    expect(atualizado.termos).toEqual(["termo-a", "termo-b", "termo-c", "termo-d", "termo-e"]);
  });

  it("recusa termos fora da faixa na edicao tambem", async () => {
    const criado = await criarNicho({ nome: "Nicho para editar termos", termosBruto: TERMOS_VALIDOS });
    await expect(atualizarNicho(criado.id, { nome: "x", termosBruto: "um\ndois" })).rejects.toThrow(
      ErroNicho,
    );
  });

  it("nicho inexistente", async () => {
    await expect(
      atualizarNicho(999999, { nome: "nao existe", termosBruto: TERMOS_VALIDOS }),
    ).rejects.toThrow(ErroNicho);
  });
});

describe("alternarAtivoNicho", () => {
  it("desativa e reativa, sem apagar nada", async () => {
    const criado = await criarNicho({ nome: "Nicho para desativar", termosBruto: TERMOS_VALIDOS });

    const desativado = await alternarAtivoNicho(criado.id, false);
    expect(desativado.ativo).toBe(false);

    const [aindaExiste] = await db().select().from(nichos).where(eq(nichos.id, criado.id));
    expect(aindaExiste).toBeDefined();
    expect(aindaExiste.termos).toEqual(desativado.termos);

    const reativado = await alternarAtivoNicho(criado.id, true);
    expect(reativado.ativo).toBe(true);
  });
});

describe("adicionarContasSemente", () => {
  it("cria as contas vigiadas com origem curadoria", async () => {
    const nicho = await criarNicho({ nome: "Nicho contas semente", termosBruto: TERMOS_VALIDOS });

    const criadas = await adicionarContasSemente(
      nicho.id,
      "https://www.youtube.com/@examplecanal\nhttps://www.tiktok.com/@exampletiktok\nhttps://www.instagram.com/exampleinsta/",
    );

    expect(criadas).toHaveLength(3);
    for (const conta of criadas) {
      expect(conta.vigiada).toBe(true);
      expect(conta.origem).toBe("curadoria");
      expect(conta.nichoId).toBe(nicho.id);
    }
    expect(criadas.map((c) => c.plataforma).sort()).toEqual(["instagram", "tiktok", "youtube"]);
  });

  it("URL invalida: nada gravado pela metade", async () => {
    const nicho = await criarNicho({ nome: "Nicho url invalida", termosBruto: TERMOS_VALIDOS });

    await expect(
      adicionarContasSemente(
        nicho.id,
        "https://www.youtube.com/@valida\nhttps://www.facebook.com/invalida",
      ),
    ).rejects.toThrow(ErroNicho);

    const linhas = await db().select().from(contas).where(eq(contas.nichoId, nicho.id));
    expect(linhas).toHaveLength(0);
  });

  it("conta que ja existe (mesma plataforma e handle) so vira vigiada, sem duplicar linha", async () => {
    const nicho = await criarNicho({ nome: "Nicho conta existente", termosBruto: TERMOS_VALIDOS });

    await db().insert(contas).values({
      plataforma: "youtube",
      handle: "@jaexistia",
      nichoId: nicho.id,
      vigiada: false,
      origem: "coleta",
    });

    const criadas = await adicionarContasSemente(nicho.id, "https://www.youtube.com/@jaexistia");
    expect(criadas).toHaveLength(1);
    expect(criadas[0].vigiada).toBe(true);

    const linhas = await db()
      .select()
      .from(contas)
      .where(and(eq(contas.plataforma, "youtube"), eq(contas.handle, "@jaexistia")));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].origem).toBe("coleta");
  });

  it("recusa passar de 10 contas semente no nicho", async () => {
    const nicho = await criarNicho({ nome: "Nicho limite de contas", termosBruto: TERMOS_VALIDOS });
    const onze = Array.from({ length: 11 }, (_, i) => `https://www.tiktok.com/@conta${i}`).join("\n");

    await expect(adicionarContasSemente(nicho.id, onze)).rejects.toThrow(ErroNicho);
  });

  it("recusa sem nenhuma URL", async () => {
    const nicho = await criarNicho({ nome: "Nicho sem url", termosBruto: TERMOS_VALIDOS });
    await expect(adicionarContasSemente(nicho.id, "   \n  ")).rejects.toThrow(ErroNicho);
  });
});
