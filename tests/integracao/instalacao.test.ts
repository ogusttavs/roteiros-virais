/**
 * O convite de instalar o aplicativo (E48 PR 1), contra o Postgres real: agora não adia sete dias no servidor, e `instalado_em` é gravado uma
 * vez só (a primeira abertura em modo aplicativo), e aparece na lista de marcas do admin.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, membrosMarca, preferenciasUsuario, user } from "@/db/schema";
import { conviteDeInstalarPodeAparecer } from "@/lib/convite-instalar";
import { listarClientesAdmin } from "@/servicos/admin-coleta";
import { adiarConviteDeInstalar, preferenciasDoUsuario, registrarInstalacao } from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;

async function criarPessoa(usuarioId: string, comPreferencias: boolean): Promise<number> {
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${usuarioId}`, email: `${usuarioId}@instalacao.teste` });
  if (comPreferencias) await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Marca ${usuarioId}` }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  return marca.id;
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("adiarConviteDeInstalar", () => {
  it("grava sete dias à frente, e o convite não pode aparecer até lá", async () => {
    await criarPessoa("inst-adiar", true);
    const agora = new Date("2026-10-03T12:00:00Z");

    const ate = await adiarConviteDeInstalar("inst-adiar", agora);

    expect(ate.getTime() - agora.getTime()).toBe(7 * DIA_MS);
    const prefs = await preferenciasDoUsuario("inst-adiar");
    expect(prefs?.conviteInstalarAdiadoAte?.getTime()).toBe(ate.getTime());
    expect(conviteDeInstalarPodeAparecer(prefs, new Date(agora.getTime() + 3 * DIA_MS))).toBe(false);
    expect(conviteDeInstalarPodeAparecer(prefs, new Date(agora.getTime() + 8 * DIA_MS))).toBe(true);
  });

  it("dizer agora não de novo recomeça os sete dias; sem linha de preferências, cria a linha", async () => {
    await criarPessoa("inst-adiar-sem-linha", false);
    const primeiro = await adiarConviteDeInstalar("inst-adiar-sem-linha", new Date("2026-10-03T12:00:00Z"));
    const segundo = await adiarConviteDeInstalar("inst-adiar-sem-linha", new Date("2026-10-12T12:00:00Z"));

    expect(segundo.getTime()).toBeGreaterThan(primeiro.getTime());
    expect((await preferenciasDoUsuario("inst-adiar-sem-linha"))?.conviteInstalarAdiadoAte?.getTime()).toBe(segundo.getTime());
  });
});

describe("registrarInstalacao", () => {
  it("grava na primeira abertura em modo aplicativo e só nela: abrir de novo não muda a data", async () => {
    await criarPessoa("inst-registrar", true);
    const primeira = new Date("2026-10-03T12:00:00Z");

    expect(await registrarInstalacao("inst-registrar", primeira)).toBe(true);
    expect(await registrarInstalacao("inst-registrar", new Date("2026-10-10T12:00:00Z"))).toBe(false);

    const prefs = await preferenciasDoUsuario("inst-registrar");
    expect(prefs?.instaladoEm?.getTime()).toBe(primeira.getTime());
    // Instalado: o convite nunca mais, mesmo sem nenhum agora não.
    expect(conviteDeInstalarPodeAparecer(prefs, new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("duas aberturas ao mesmo tempo gravam uma vez só", async () => {
    await criarPessoa("inst-corrida", true);
    const resultados = await Promise.all([registrarInstalacao("inst-corrida"), registrarInstalacao("inst-corrida"), registrarInstalacao("inst-corrida")]);

    expect(resultados.filter(Boolean)).toHaveLength(1);
  });

  it("sem linha de preferências, cria a linha e grava", async () => {
    await criarPessoa("inst-sem-linha", false);
    expect(await registrarInstalacao("inst-sem-linha")).toBe(true);
    expect((await preferenciasDoUsuario("inst-sem-linha"))?.instaladoEm).not.toBeNull();
  });

  it("a lista de marcas do admin mostra quando o dono instalou, e nulo para quem não instalou", async () => {
    const lista = await listarClientesAdmin();
    const instalou = lista.find((c) => c.nome === "[teste] Marca inst-registrar");
    const naoInstalou = lista.find((c) => c.nome === "[teste] Marca inst-adiar");

    expect(instalou?.instaladoEm).not.toBeNull();
    expect(naoInstalou?.instaladoEm).toBeNull();
  });

  it("não mexe nas preferências de outra pessoa", async () => {
    const [outra] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, "inst-adiar"));
    expect(outra.instaladoEm).toBeNull();
  });
});
