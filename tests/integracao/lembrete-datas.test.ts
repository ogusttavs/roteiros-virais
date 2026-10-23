/**
 * O aviso da manhã com a data que vem aí (E60), contra o Postgres real, com `enviarPush` e `enviarEmail` mockados: daqui a 7 e a 2 dias o aviso ganha uma linha com a data
 * (Dia das Mães para qualquer marca; o Dia do Cirurgião-Dentista só para a marca do ramo de odontologia); nos outros dias, e para o ramo que a data não interessa, o aviso é o
 * de sempre, palavra por palavra. O relógio é fixo: o `agora` vai para `rodarLembrete`, com a hora do lembrete escolhida a partir dele.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push", () => ({
  enviarPush: vi.fn().mockResolvedValue({ ok: true }),
  pushConfigurado: () => true,
}));

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, preferenciasUsuario, temasDia, user, type TemaDoDia } from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";
import { config, hojeISO, horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { enviarPush } from "@/lib/push";
import { registrarInscricaoPush } from "@/servicos/push";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoSemRamo: number;
let nichoOdontologia: number;
let contador = 0;

function tema(titulo: string): TemaDoDia {
  return { titulo, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
}

/** 10:00 em Brasília de um dia (UTC-3). */
function manhaDe(dia: string): Date {
  return new Date(`${dia}T13:00:00Z`);
}

async function pessoaComMarca(agora: Date, nichoId: number, nome: string, comPush = false): Promise<void> {
  contador += 1;
  const usuarioId = `lembrete-datas-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] pessoa ${contador}`, email: `${usuarioId}@lembrete-datas.teste` });
  await db().insert(preferenciasUsuario).values({ usuarioId, horaLembrete: horaAtualISO(agora) });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome, nichoId }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db().insert(temasDia).values({ nichoId, data: hojeISO(agora), temas: [tema("tema comum")] }).onConflictDoNothing();
  if (comPush) {
    await registrarInscricaoPush(usuarioId, { endpoint: `https://fcm.googleapis.com/fcm/send/${usuarioId}`, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android");
  }
}

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "lembrete-datas-sem-ramo", nome: "Sem ramo do catálogo", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "lembrete-datas-odonto", nome: "Odontologia", termos: [], ramoCatalogo: "odontologia" }).returning();
  nichoSemRamo = a.id;
  nichoOdontologia = b.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(user);
  await db().delete(temasDia);
  vi.mocked(enviarEmail).mockClear();
  vi.mocked(enviarPush).mockReset();
  vi.mocked(enviarPush).mockResolvedValue({ ok: true });
});

describe("o aviso da manhã com a data que vem aí", () => {
  it("daqui a 7 dias: o e-mail ganha a linha da data (Dia das Mães, domingo 10 de maio de 2026)", async () => {
    const agora = manhaDe("2026-05-03");
    await pessoaComMarca(agora, nichoSemRamo, "Loja da Ana");

    const resumo = await rodarLembrete(agora);

    expect(resumo.enviados).toBe(1);
    const email = vi.mocked(enviarEmail).mock.calls[0][0];
    expect(email.html).toContain("Daqui a 7 dias é Dia das Mães.");
    expect(email.html).toContain("Dá tempo de gravar sobre isso");
    // O texto de sempre continua lá.
    expect(email.html).toContain("está pronto para gravar");
    expect(email.assunto).toBe("O seu tema está pronto para gravar");
  });

  it("daqui a 2 dias: a linha também entra, e o push leva a data depois do texto de sempre", async () => {
    const agora = manhaDe("2026-05-08");
    await pessoaComMarca(agora, nichoSemRamo, "Loja da Ana", true);

    await rodarLembrete(agora);

    expect(vi.mocked(enviarPush).mock.calls[0][1]).toEqual({
      titulo: config.appName,
      corpo: "Os temas de hoje chegaram. Daqui a 2 dias é Dia das Mães.",
      url: "/hoje",
    });
  });

  it("nos outros dias da semana o aviso é o de sempre, palavra por palavra", async () => {
    for (const dia of ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-09", "2026-05-10"]) {
      const agora = manhaDe(dia);
      await pessoaComMarca(agora, nichoSemRamo, "Loja da Ana", true);
      await rodarLembrete(agora);
      expect(vi.mocked(enviarPush).mock.calls.at(-1)?.[1].corpo, dia).toBe("Os temas de hoje chegaram");
      await db().delete(user);
      await db().delete(temasDia);
      vi.mocked(enviarPush).mockClear();
    }
  });

  it("a data do ramo vai só para a marca do ramo: a clínica recebe o Dia do Cirurgião-Dentista, a outra marca não", async () => {
    const agora = manhaDe("2026-10-18");
    await pessoaComMarca(agora, nichoOdontologia, "Clínica Sorriso");
    await pessoaComMarca(agora, nichoSemRamo, "Loja da Ana");

    await rodarLembrete(agora);

    const emails = vi.mocked(enviarEmail).mock.calls.map(([e]) => e.html);
    expect(emails).toHaveLength(2);
    expect(emails.filter((html) => html.includes("Daqui a 7 dias é Dia do Cirurgião-Dentista."))).toHaveLength(1);
    expect(emails.filter((html) => html.includes("Dia do Cirurgião-Dentista") && html.includes("Loja da Ana"))).toHaveLength(0);
  });

  it("com mais de uma marca, a linha da data diz de qual marca é, e o nome sai escapado", async () => {
    const agora = manhaDe("2026-10-18");
    contador += 1;
    const usuarioId = `lembrete-datas-${contador}`;
    await db().insert(user).values({ id: usuarioId, name: "[teste] pessoa", email: `${usuarioId}@lembrete-datas.teste` });
    await db().insert(preferenciasUsuario).values({ usuarioId, horaLembrete: horaAtualISO(agora) });
    for (const [nome, nichoId] of [["Clínica <b>Sorriso", nichoOdontologia], ["Loja da Ana", nichoSemRamo]] as const) {
      const [marca] = await db().insert(clientes).values({ usuarioId, nome, nichoId }).returning();
      await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
      await db().insert(temasDia).values({ nichoId, data: hojeISO(agora), temas: [tema("tema comum")] }).onConflictDoNothing();
    }

    await rodarLembrete(agora);

    const html = vi.mocked(enviarEmail).mock.calls[0][0].html;
    expect(html).toContain("Daqui a 7 dias é Dia do Cirurgião-Dentista. Para Clínica &lt;b&gt;Sorriso.");
    expect(html).not.toContain("<b>Sorriso");
  });
});
