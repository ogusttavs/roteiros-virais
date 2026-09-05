/**
 * `rodarLembrete` (etapa 12, decisão 5; guardas da etapa 13, ajuste 1 da
 * revisão da parte 2 do `PROXIMO.md`): cliente que já abriu o painel hoje
 * não recebe; cliente que já recebeu o lembrete hoje não recebe de novo
 * (uma repetição do pg-boss ou uma execução manual no mesmo dia); cliente
 * sem tema no nicho, nem hoje nem nos últimos 3 dias (a mesma regra de
 * estabilidade de `/hoje`, `temasDoDiaOuRecente`), ou sem nicho, não
 * recebe; cliente na hora certa, sem nada disso, recebe, mesmo quando o
 * tema mostrado é o de ontem. `enviarEmail` sai no log fora de produção
 * (`NODE_ENV` de teste), sem chamada de rede de verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));

import { db, getPool } from "@/db";
import { clientes, nichos, temasDia, user } from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";
import { enviarEmail } from "@/lib/email";

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
let nichoTemaOntemId: number;
let nichoTemaForaDaJanelaId: number;

function temaExemplo(titulo: string) {
  return [{ titulo, descricao: "descricao", porQue: "por que", evidencias: [], puxaPara: "alcance" as const }];
}

beforeAll(async () => {
  await resetarSchema(db());

  const [comTema] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-com-tema", nome: "Lembrete teste com tema", termos: [] })
    .returning();
  nichoComTemaId = comTema.id;
  await db()
    .insert(temasDia)
    .values({ nichoId: nichoComTemaId, data: "2026-09-03", temas: temaExemplo("tema 1") });

  const [semTema] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-sem-tema", nome: "Lembrete teste sem tema", termos: [] })
    .returning();
  nichoSemTemaId = semTema.id;

  // AGORA e 2026-09-03; "ontem" (2026-09-02) entra na janela de estabilidade de 3 dias.
  const [temaOntem] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-tema-ontem", nome: "Lembrete teste tema ontem", termos: [] })
    .returning();
  nichoTemaOntemId = temaOntem.id;
  await db()
    .insert(temasDia)
    .values({ nichoId: nichoTemaOntemId, data: "2026-09-02", temas: temaExemplo("tema de ontem") });

  // 5 dias atras, fora da janela de estabilidade de 3 dias: conta como sem tema.
  const [foraDaJanela] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-fora-da-janela", nome: "Lembrete teste fora da janela", termos: [] })
    .returning();
  nichoTemaForaDaJanelaId = foraDaJanela.id;
  await db()
    .insert(temasDia)
    .values({ nichoId: nichoTemaForaDaJanelaId, data: "2026-08-29", temas: temaExemplo("tema antigo demais") });
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

  it("nicho sem nenhum tema gravado nao recebe, conta em semTema", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoSemTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semTema).toBe(1);
  });

  it("nicho so com tema de ontem (regra de estabilidade de /hoje) recebe, nao conta em semTema", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoTemaOntemId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.semTema).toBe(0);
  });

  it("nicho so com tema de mais de 3 dias atras (fora da janela de estabilidade) nao recebe, conta em semTema", async () => {
    await criarCliente({ horaLembrete: "11:00", nichoId: nichoTemaForaDaJanelaId });

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

  it("se o envio falhar, desfaz a marca de ultimo_lembrete_em (nao perde o lembrete do dia por uma falha do provedor)", async () => {
    const cliente = await criarCliente({ horaLembrete: "11:00", nichoId: nichoComTemaId });
    vi.mocked(enviarEmail).mockRejectedValueOnce(new Error("falha simulada do provedor"));

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.erros).toBeDefined();

    const [linha] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(linha.ultimoLembreteEm).toBeNull();
  });
});
