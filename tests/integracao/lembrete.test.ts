/**
 * `rodarLembrete` (etapa 12, decisão 5 do `PROXIMO.md`): cliente que já
 * abriu o painel hoje não recebe; cliente na hora certa, sem ter aberto,
 * recebe. `enviarEmail` sai no log fora de produção (`NODE_ENV` de teste),
 * sem chamada de rede de verdade.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, user } from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";

import { resetarSchema } from "../../scripts/resetar-schema";

let contador = 0;
async function criarCliente(opcoes: { horaLembrete: string; ultimoAcessoEm?: Date | null; ativo?: boolean }) {
  contador += 1;
  const usuarioId = `lembrete-teste-${contador}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] cliente ${contador}`, email: `${usuarioId}@lembrete.teste` });
  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome: `[teste] cliente ${contador}`,
      horaLembrete: opcoes.horaLembrete,
      ultimoAcessoEm: opcoes.ultimoAcessoEm ?? null,
      ativo: opcoes.ativo ?? true,
    })
    .returning();
  return cliente;
}

beforeAll(async () => {
  await resetarSchema(db());
});

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(clientes);
  await db().delete(user);
});

/** 11:00 em Brasilia (UTC-3), uma quinta-feira qualquer, longe de meia-noite. */
const AGORA = new Date("2026-09-03T14:00:00Z");

describe("rodarLembrete", () => {
  it("cliente na hora certa, sem ter aberto o painel hoje, recebe", async () => {
    await criarCliente({ horaLembrete: "11:00" });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.horaAtual).toBe("11:00");
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaAbriram).toBe(0);
  });

  it("cliente que ja abriu o painel hoje nao recebe", async () => {
    await criarCliente({ horaLembrete: "11:00", ultimoAcessoEm: AGORA });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(0);
    expect(resumo.jaAbriram).toBe(1);
  });

  it("cliente que abriu ontem, nao hoje, ainda recebe", async () => {
    const ontem = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    await criarCliente({ horaLembrete: "11:00", ultimoAcessoEm: ontem });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaAbriram).toBe(0);
  });

  it("cliente com outra hora escolhida nao entra nos candidatos desta hora", async () => {
    await criarCliente({ horaLembrete: "08:00" });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(0);
    expect(resumo.enviados).toBe(0);
  });

  it("cliente inativo nao entra nos candidatos", async () => {
    await criarCliente({ horaLembrete: "11:00", ativo: false });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(0);
  });
});
