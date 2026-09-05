/**
 * `rodarLembrete` (etapa 12, decisão 5; guardas da etapa 13, ajuste 3 do
 * `PROXIMO.md`): cliente que já abriu o painel hoje não recebe; cliente que
 * já recebeu o lembrete hoje não recebe de novo (uma repetição do pg-boss ou
 * uma execução manual no mesmo dia); cliente sem tema hoje no nicho (ou sem
 * nicho) não recebe; cliente na hora certa, sem nada disso, recebe.
 * `enviarEmail` sai no log fora de produção (`NODE_ENV` de teste), sem
 * chamada de rede de verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, temasDia, user } from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";

import { resetarSchema } from "../../scripts/resetar-schema";

let contador = 0;
async function criarCliente(opcoes: {
  horaLembrete: string;
  nichoId?: number | null;
  ultimoAcessoEm?: Date | null;
  ultimoLembreteEm?: Date | null;
  ativo?: boolean;
}) {
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
      nichoId: opcoes.nichoId ?? null,
      ultimoAcessoEm: opcoes.ultimoAcessoEm ?? null,
      ultimoLembreteEm: opcoes.ultimoLembreteEm ?? null,
      ativo: opcoes.ativo ?? true,
    })
    .returning();
  return cliente;
}

/** 11:00 em Brasilia (UTC-3), uma quinta-feira qualquer, longe de meia-noite. */
const AGORA = new Date("2026-09-03T14:00:00Z");

let nichoComTemaId: number;
let nichoSemTemaId: number;

beforeAll(async () => {
  await resetarSchema(db());

  const [comTema] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-com-tema", nome: "Lembrete teste com tema", termos: [] })
    .returning();
  nichoComTemaId = comTema.id;
  await db()
    .insert(temasDia)
    .values({
      nichoId: nichoComTemaId,
      data: "2026-09-03",
      temas: [
        { titulo: "tema 1", descricao: "descricao", porQue: "por que", evidencias: [], puxaPara: "alcance" },
      ],
    });

  const [semTema] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-sem-tema", nome: "Lembrete teste sem tema", termos: [] })
    .returning();
  nichoSemTemaId = semTema.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(clientes);
  await db().delete(user);
});

describe("rodarLembrete", () => {
  it("cliente na hora certa, com tema hoje, sem ter aberto o painel hoje, recebe", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.horaAtual).toBe("11:00");
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaAbriram).toBe(0);
    expect(resumo.jaReceberam).toBe(0);
    expect(resumo.semTema).toBe(0);
  });

  it("grava ultimo_lembrete_em ao enviar", async () => {
    const cliente = await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId });

    await rodarLembrete(AGORA);

    const [linha] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(linha.ultimoLembreteEm?.getTime()).toBe(AGORA.getTime());
  });

  it("cliente que ja recebeu o lembrete hoje nao recebe de novo (repeticao do pg-boss ou execucao manual)", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId });

    const primeira = await rodarLembrete(AGORA);
    expect(primeira.enviados).toBe(1);

    const segunda = await rodarLembrete(AGORA);
    expect(segunda.enviados).toBe(0);
    expect(segunda.jaReceberam).toBe(1);
  });

  it("cliente que recebeu ontem, nao hoje, ainda recebe", async () => {
    const ontem = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId, ultimoLembreteEm: ontem });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaReceberam).toBe(0);
  });

  it("cliente que ja abriu o painel hoje nao recebe", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId, ultimoAcessoEm: AGORA });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(0);
    expect(resumo.jaAbriram).toBe(1);
  });

  it("cliente que abriu ontem, nao hoje, ainda recebe", async () => {
    const ontem = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId, ultimoAcessoEm: ontem });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaAbriram).toBe(0);
  });

  it("nicho sem tema hoje nao recebe, conta em semTema", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoSemTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semTema).toBe(1);
  });

  it("cliente sem nicho nao recebe, conta em semTema", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: null });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semTema).toBe(1);
  });

  it("cliente com outra hora escolhida nao entra nos candidatos desta hora", async () => {
    await criarCliente({ horaLembrete: "08:00", nichoId: nichoComTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(0);
    expect(resumo.enviados).toBe(0);
  });

  it("cliente inativo nao entra nos candidatos", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId, ativo: false });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(0);
  });
});
