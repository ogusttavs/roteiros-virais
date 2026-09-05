/**
 * `resumoHistorico` (temas.ts) e `roteirosDoCliente` (roteiro.ts), o topo e
 * a lista de `/historico` (etapa 12, decisão 3 do `PROXIMO.md`), contra o
 * Postgres real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, roteiros, user } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { roteirosDoCliente } from "@/servicos/roteiro";
import { resumoHistorico } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
/**
 * Data local do Brasil, nao UTC (achado rodando perto da meia-noite UTC,
 * que ja e o dia seguinte em Brasilia): `constanciaDoCliente` usa
 * `hojeISO()` (Brasil) para decidir "hoje"; um fixture de teste em UTC
 * puro descasava bem nesse horario e quebrava o teste sem nenhum bug real.
 */
function dataIso(diasAtras: number): string {
  return hojeISO(new Date(Date.now() - diasAtras * DIA_MS));
}
function dataHora(diasAtras: number): Date {
  return new Date(Date.now() - diasAtras * DIA_MS);
}

const CONTEUDO_ROTEIRO_MINIMO = {
  titulo: "titulo",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
};

let nichoId: number;
let contadorUsuario = 0;

async function criarCliente(): Promise<number> {
  contadorUsuario += 1;
  const usuarioId = `historico-teste-${contadorUsuario}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] cliente ${contadorUsuario}`, email: `${usuarioId}@historico.teste` });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: `[teste] cliente ${contadorUsuario}`, nichoId })
    .returning();
  return cliente.id;
}

async function criarRoteiro(
  clienteId: number,
  opcoes: {
    diasAtras: number;
    status: "gerado" | "gravado" | "postado";
    gravadoEm?: Date;
    postadoEm?: Date;
    versao?: number;
    versaoDe?: number;
  },
) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: dataIso(opcoes.diasAtras),
      tema: `tema de ${opcoes.diasAtras} dias atras`,
      origem: "sugerido",
      objetivo: "alcance",
      conteudo: CONTEUDO_ROTEIRO_MINIMO,
      status: opcoes.status,
      gravadoEm: opcoes.gravadoEm,
      postadoEm: opcoes.postadoEm,
      versao: opcoes.versao ?? 1,
      versaoDe: opcoes.versaoDe,
    })
    .returning();
  return roteiro;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "historico-teste", nome: "Historico teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("resumoHistorico: dias seguidos", () => {
  it("um intervalo de 2 dias sem gravar (como um fim de semana) quebra a sequencia", async () => {
    const clienteId = await criarCliente();
    // grava hoje e ontem (2 seguidos); antes disso, um buraco de 2 dias (ex.: fim de semana sem gravar).
    await criarRoteiro(clienteId, { diasAtras: 0, status: "postado" });
    await criarRoteiro(clienteId, { diasAtras: 1, status: "postado" });
    await criarRoteiro(clienteId, { diasAtras: 3, status: "postado" });
    await criarRoteiro(clienteId, { diasAtras: 4, status: "postado" });

    const resumo = await resumoHistorico(clienteId);
    expect(resumo.diasSeguidos).toBe(2);
  });

  it("gravando todo santo dia, o fim de semana nao quebra nada", async () => {
    const clienteId = await criarCliente();
    for (let i = 0; i <= 4; i += 1) {
      await criarRoteiro(clienteId, { diasAtras: i, status: "gravado" });
    }

    const resumo = await resumoHistorico(clienteId);
    expect(resumo.diasSeguidos).toBe(5);
  });

  it("cliente parado (ultimo registro ha mais de 1 dia): dias seguidos e zero, nao quebra", async () => {
    const clienteId = await criarCliente();
    await criarRoteiro(clienteId, { diasAtras: 5, status: "postado" });

    const resumo = await resumoHistorico(clienteId);
    expect(resumo.diasSeguidos).toBe(0);
  });
});

describe("resumoHistorico: gravados e postados no mes", () => {
  it("conta por gravadoEm/postadoEm, nao pela data do tema; mais de 30 dias atras nunca conta (qualquer mes tem no maximo 31 dias)", async () => {
    const clienteId = await criarCliente();
    await criarRoteiro(clienteId, { diasAtras: 0, status: "gravado", gravadoEm: dataHora(0) });
    await criarRoteiro(clienteId, { diasAtras: 0, status: "postado", gravadoEm: dataHora(0), postadoEm: dataHora(0) });
    // mais de 31 dias atras: sempre em outro mes, independente de quando o teste roda.
    await criarRoteiro(clienteId, { diasAtras: 33, status: "gravado", gravadoEm: dataHora(33) });

    const resumo = await resumoHistorico(clienteId);

    expect(resumo.gravadosNoMes).toBe(2);
    expect(resumo.postadosNoMes).toBe(1);
  });
});

describe("resumoHistorico: os ultimos 30 dias", () => {
  it("marca o dia certo pelo gravadoEm (hoje e um dia especifico), sem depender do mes corrente", async () => {
    const clienteId = await criarCliente();
    await criarRoteiro(clienteId, { diasAtras: 5, status: "gravado", gravadoEm: dataHora(5) });

    const resumo = await resumoHistorico(clienteId);

    expect(resumo.ultimos30Dias).toHaveLength(30);
    expect(resumo.ultimos30Dias[29]).toBe(false); // hoje, nada gravado
    expect(resumo.ultimos30Dias[29 - 5]).toBe(true); // 5 dias atras
  });
});

describe("roteirosDoCliente", () => {
  it("so traz a versao mais nova de cada serie (outro angulo nao duplica linha)", async () => {
    const clienteId = await criarCliente();
    const v1 = await criarRoteiro(clienteId, { diasAtras: 2, status: "gerado", versao: 1 });
    const v2 = await criarRoteiro(clienteId, { diasAtras: 2, status: "gravado", versao: 2, versaoDe: v1.id });

    const lista = await roteirosDoCliente(clienteId);

    expect(lista).toHaveLength(1);
    expect(lista[0].id).toBe(v2.id);
    expect(lista[0].status).toBe("gravado");
  });

  it("ordena por data decrescente", async () => {
    const clienteId = await criarCliente();
    await criarRoteiro(clienteId, { diasAtras: 5, status: "postado" });
    await criarRoteiro(clienteId, { diasAtras: 1, status: "gravado" });

    const lista = await roteirosDoCliente(clienteId);

    expect(lista.map((r) => r.status)).toEqual(["gravado", "postado"]);
  });
});
