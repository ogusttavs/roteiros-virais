/**
 * `rodarEmailAcompanhamento` (V10, item 4): sem `EMAIL_ACOMPANHAMENTO`, não
 * manda nada; com ela, manda um e-mail só, para esse endereço, com o
 * resumo de "o que está quebrado agora" e a linha de ontem de cada marca
 * ativa. `enviarEmail` mockado, sem chamada de rede de verdade.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));

import { db, getPool } from "@/db";
import { clientes, execucoesJob, nichos, roteiros, user } from "@/db/schema";
import { rodarEmailAcompanhamento } from "@/jobs/email-acompanhamento";
import { config, hojeISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";

import { resetarSchema } from "../../scripts/resetar-schema";

function diaIso(diasAtras: number): string {
  return hojeISO(new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000));
}

const ONTEM = diaIso(1);
const enviarEmailMock = vi.mocked(enviarEmail);

let nichoId: number;
let clienteId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "email-acomp-teste", nome: "Email acomp teste", termos: [] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values({ id: "email-acomp-user", name: "[teste]", email: "email-acomp@teste.invalido" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "email-acomp-user", nome: "[teste] Marca do E-mail", nichoId }).returning();
  clienteId = cliente.id;

  await db().insert(execucoesJob).values({
    nome: "coleta-youtube",
    status: "erro",
    erro: "exemplo de erro para o e-mail",
    iniciadoEm: new Date(`${ONTEM}T12:00:00-03:00`),
    terminadoEm: new Date(`${ONTEM}T12:00:00-03:00`),
  });

  await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: ONTEM,
      tema: "tema de ontem",
      origem: "sugerido",
      objetivo: "alcance",
      conteudo: {
        titulo: "titulo de exemplo",
        duracaoS: 30,
        gancho: "gancho",
        corpo: "corpo",
        fechamento: "fechamento",
        chamadaFinal: "chamada",
        cartoes: null,
        porQueAssim: [],
        cenas: [],
        ondeGravar: "no local",
        edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
        evidencias: [],
        semEvidencia: false,
        forcaEvidencia: null,
      },
      status: "gerado",
    });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(() => {
  enviarEmailMock.mockClear();
});

describe("rodarEmailAcompanhamento", () => {
  it("sem EMAIL_ACOMPANHAMENTO configurada, nao manda nada", async () => {
    const original = config.emailAcompanhamento;
    config.emailAcompanhamento = "";
    try {
      const resultado = await rodarEmailAcompanhamento();
      expect(resultado.enviado).toBe(false);
      expect(enviarEmailMock).not.toHaveBeenCalled();
    } finally {
      config.emailAcompanhamento = original;
    }
  });

  it("com EMAIL_ACOMPANHAMENTO configurada, manda um e-mail so, com o erro de ontem e o roteiro de ontem", async () => {
    const original = config.emailAcompanhamento;
    config.emailAcompanhamento = "fable@exemplo.invalido";
    try {
      const resultado = await rodarEmailAcompanhamento();
      expect(resultado.enviado).toBe(true);
      expect(enviarEmailMock).toHaveBeenCalledTimes(1);

      const [chamada] = enviarEmailMock.mock.calls;
      expect(chamada[0].para).toBe("fable@exemplo.invalido");
      expect(chamada[0].html).toContain("coleta-youtube");
      expect(chamada[0].html).toContain("exemplo de erro para o e-mail");
      expect(chamada[0].html).toContain("Marca do E-mail");
    } finally {
      config.emailAcompanhamento = original;
    }
  });
});
