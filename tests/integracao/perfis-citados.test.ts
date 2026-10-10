/**
 * Concorrentes e perfis admirados citados pelo cliente (V12c, item 7, a
 * E37b): adicionarPerfilCitado/removerPerfilCitado/perfisCitadosDoCliente,
 * isolados por cliente; e o script de migração (item 7), rodando duas vezes
 * sem duplicar.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, perfisCitados, user } from "@/db/schema";
import {
  adicionarPerfilCitado,
  ErroPerfilCitado,
  perfisCitadosDoCliente,
  removerPerfilCitado,
} from "@/servicos/perfis-citados";

import { migrarPerfisCitados } from "../../scripts/migrar-perfis-citados";
import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let outroClienteId: number;

beforeAll(async () => {
  await resetarSchema(db());

  const [a, b] = await db()
    .insert(user)
    .values([
      { id: "perfis-citados-a", name: "[teste] A", email: "a@perfis-citados.teste" },
      { id: "perfis-citados-b", name: "[teste] B", email: "b@perfis-citados.teste" },
    ])
    .returning();

  const [clienteA] = await db()
    .insert(clientes)
    .values({ usuarioId: a.id, nome: "[teste] Cliente A" })
    .returning();
  const [clienteB] = await db()
    .insert(clientes)
    .values({ usuarioId: b.id, nome: "[teste] Cliente B" })
    .returning();

  clienteId = clienteA.id;
  outroClienteId = clienteB.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("adicionarPerfilCitado / perfisCitadosDoCliente", () => {
  it("grava um concorrente e um admirado, cada um na propria lista", async () => {
    await adicionarPerfilCitado(clienteId, "concorrente", { rede: "instagram", handle: "limpatudoexpress" });
    await adicionarPerfilCitado(clienteId, "admira", { rede: "tiktok", handle: "@arrumadeiraprofissional" });

    const { concorrentes, admira } = await perfisCitadosDoCliente(clienteId);
    expect(concorrentes).toHaveLength(1);
    expect(concorrentes[0].handle).toBe("limpatudoexpress");
    expect(admira).toHaveLength(1);
    expect(admira[0].handle).toBe("arrumadeiraprofissional");
  });

  it("aceita um endereco inteiro colado, guarda so o nome limpo", async () => {
    await adicionarPerfilCitado(clienteId, "admira", {
      rede: "youtube",
      handle: "https://www.youtube.com/@canalreferencia",
    });

    const { admira } = await perfisCitadosDoCliente(clienteId);
    expect(admira.some((p) => p.handle === "@canalreferencia")).toBe(true);
  });

  it("o mesmo cliente, tipo, rede e handle duas vezes nao duplica (idempotente)", async () => {
    await adicionarPerfilCitado(clienteId, "concorrente", { rede: "instagram", handle: "oficinaderro" });
    await adicionarPerfilCitado(clienteId, "concorrente", { rede: "instagram", handle: "@oficinaderro" });

    const { concorrentes } = await perfisCitadosDoCliente(clienteId);
    expect(concorrentes.filter((p) => p.handle === "oficinaderro")).toHaveLength(1);
  });

  it("um tipo que não é um dos dois (um POST forjado) é recusado: o teto de dez por lista não some e nada é enfileirado", async () => {
    const antes = await db().select().from(perfisCitados).where(eq(perfisCitados.clienteId, clienteId));

    for (const tipoForjado of ["a1", "outro", "", "Concorrente"]) {
      await expect(adicionarPerfilCitado(clienteId, tipoForjado as never, { rede: "instagram", handle: "perfil.forjado" })).rejects.toThrow(ErroPerfilCitado);
    }

    expect(await db().select().from(perfisCitados).where(eq(perfisCitados.clienteId, clienteId))).toHaveLength(antes.length);
  });

  it("recusa handle vazio", async () => {
    await expect(adicionarPerfilCitado(clienteId, "admira", { rede: "instagram", handle: "   " })).rejects.toThrow();
  });

  it("ate 10 por lista, o 11o recusa", async () => {
    const [novoUsuario] = await db()
      .insert(user)
      .values({ id: "perfis-citados-limite", name: "[teste] Limite", email: "limite@perfis-citados.teste" })
      .returning();
    const [clienteLimite] = await db()
      .insert(clientes)
      .values({ usuarioId: novoUsuario.id, nome: "[teste] Cliente Limite" })
      .returning();

    for (let i = 0; i < 10; i += 1) {
      await adicionarPerfilCitado(clienteLimite.id, "admira", { rede: "instagram", handle: `perfil${i}` });
    }

    await expect(
      adicionarPerfilCitado(clienteLimite.id, "admira", { rede: "instagram", handle: "perfil10" }),
    ).rejects.toThrow(ErroPerfilCitado);
  });

  it("isolado por cliente: perfis de um cliente nao aparecem para outro", async () => {
    const { concorrentes, admira } = await perfisCitadosDoCliente(outroClienteId);
    expect(concorrentes).toHaveLength(0);
    expect(admira).toHaveLength(0);
  });
});

describe("removerPerfilCitado", () => {
  it("remove quando a linha e do cliente certo", async () => {
    const [novoUsuario] = await db()
      .insert(user)
      .values({ id: "perfis-citados-remover", name: "[teste] Remover", email: "remover@perfis-citados.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: novoUsuario.id, nome: "[teste] Cliente Remover" })
      .returning();

    const perfil = await adicionarPerfilCitado(cliente.id, "admira", { rede: "instagram", handle: "perfilremovivel" });
    await removerPerfilCitado(perfil.id, cliente.id);

    const [linha] = await db().select().from(perfisCitados).where(eq(perfisCitados.id, perfil.id));
    expect(linha).toBeUndefined();
  });

  it("nao remove linha de outro cliente (isolamento)", async () => {
    const perfil = await adicionarPerfilCitado(clienteId, "admira", { rede: "instagram", handle: "perfildoclienteA" });
    await removerPerfilCitado(perfil.id, outroClienteId);

    const [linha] = await db().select().from(perfisCitados).where(eq(perfisCitados.id, perfil.id));
    expect(linha).toBeDefined();
  });
});

describe("migrarPerfisCitados (script, item 7)", () => {
  it("extrai os @ da resposta de P12, sem apagar o texto original, idempotente em duas rodadas", async () => {
    const [novoUsuario] = await db()
      .insert(user)
      .values({ id: "perfis-citados-migracao", name: "[teste] Migracao", email: "migracao@perfis-citados.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: novoUsuario.id, nome: "[teste] Cliente Migracao" })
      .returning();

    const respostaP12 =
      "Admiro o perfil @arrumadeiraprofissional, porque explica bem o passo a passo. " +
      "Concorrente direto e a empresa @limpatudoexpress, que atende no mesmo bairro.";
    await db()
      .insert(briefings)
      .values({ clienteId: cliente.id, respostas: { p12: respostaP12 }, completo: false });

    const primeiraRodada = await migrarPerfisCitados();
    expect(primeiraRodada.briefingsComP12).toBeGreaterThanOrEqual(1);
    expect(primeiraRodada.handlesUnicosProcessados).toBeGreaterThanOrEqual(2);

    const { admira } = await perfisCitadosDoCliente(cliente.id);
    expect(admira.map((p) => p.handle).sort()).toEqual(["arrumadeiraprofissional", "limpatudoexpress"]);

    // a resposta original continua intacta, nada foi apagado.
    const [briefingDepois] = await db().select().from(briefings).where(eq(briefings.clienteId, cliente.id));
    expect(briefingDepois.respostas.p12).toBe(respostaP12);

    // segunda rodada: idempotente, nao duplica.
    await migrarPerfisCitados();
    const { admira: admiraDepoisDeNovo } = await perfisCitadosDoCliente(cliente.id);
    expect(admiraDepoisDeNovo).toHaveLength(2);
  });

  it("briefing sem p12 respondida nao conta e nao quebra", async () => {
    const [novoUsuario] = await db()
      .insert(user)
      .values({ id: "perfis-citados-sem-p12", name: "[teste] Sem P12", email: "sem-p12@perfis-citados.teste" })
      .returning();
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: novoUsuario.id, nome: "[teste] Cliente Sem P12" })
      .returning();
    await db()
      .insert(briefings)
      .values({ clienteId: cliente.id, respostas: { p1: "sem arroba nenhum aqui" }, completo: false });

    const resultado = await migrarPerfisCitados();
    expect(resultado.erros).toEqual([]);

    const { admira, concorrentes } = await perfisCitadosDoCliente(cliente.id);
    expect(admira).toHaveLength(0);
    expect(concorrentes).toHaveLength(0);
  });
});
