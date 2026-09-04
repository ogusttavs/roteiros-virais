/**
 * `temasParaCliente` e `avaliarTema` (etapa 10): ciclo completo contra o
 * Postgres real. `AI_PROVIDER=mock` (`vitest.config.mts`) faz
 * `gerarEstruturado` cair no mock de `avaliarTema`, sem chamar a Anthropic
 * de verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import {
  avaliacoesTema,
  briefings,
  clientes,
  nichos,
  roteiros,
  temasDia,
  user,
  videos,
  type Objetivo,
  type PerfilCompilado,
} from "@/db/schema";
import { avaliarTema, ErroTemas, temasParaCliente } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function dataIso(diasAtras: number): string {
  return new Date(Date.now() - diasAtras * DIA_MS).toISOString().slice(0, 10);
}

const PERFIL_PADRAO: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
};

let nichoId: number;
let clienteId: number;
let contadorUsuario = 0;

async function criarCliente(opcoes: { persona?: "negocio" | "criador"; comBriefing?: boolean } = {}): Promise<number> {
  contadorUsuario += 1;
  const usuarioId = `temas-teste-${contadorUsuario}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] cliente ${contadorUsuario}`, email: `${usuarioId}@temas.teste` });

  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: `[teste] cliente ${contadorUsuario}`, nichoId, persona: opcoes.persona ?? "negocio" })
    .returning();

  if (opcoes.comBriefing !== false) {
    await db()
      .insert(briefings)
      .values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });
  }

  return cliente.id;
}

async function criarTemasDia(data: string, temas: { puxaPara: "alcance" | "engajamento" | "conversao" }[]) {
  await db()
    .insert(temasDia)
    .values({
      nichoId,
      data,
      temas: temas.map((t, i) => ({
        titulo: `tema ${i + 1}`,
        descricao: "descricao",
        porQue: "por que",
        evidencias: [1],
        puxaPara: t.puxaPara,
      })),
    });
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
};

async function criarRoteiroPostado(clienteId: number, objetivo: Objetivo, diasAtras: number) {
  await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: dataIso(diasAtras),
      tema: `tema de ${diasAtras} dias atras`,
      origem: "sugerido",
      objetivo,
      conteudo: CONTEUDO_ROTEIRO_MINIMO,
      status: "postado",
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "temas-teste", nome: "Temas teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(temasDia).where(eq(temasDia.nichoId, nichoId));
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(avaliacoesTema);
  if (clienteId) await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
});

describe("temasParaCliente: regra de estabilidade", () => {
  it("sem tema hoje, usa o mais recente dos ultimos 3 dias", async () => {
    clienteId = await criarCliente();
    await criarTemasDia(dataIso(2), [
      { puxaPara: "alcance" },
      { puxaPara: "engajamento" },
      { puxaPara: "conversao" },
    ]);

    const resultado = await temasParaCliente((await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0]);

    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") {
      expect(resultado.dataUsada).toBe(dataIso(2));
      expect(resultado.temas).toHaveLength(3);
    }
  });

  it("nada nos ultimos 3 dias: sem tema", async () => {
    clienteId = await criarCliente();
    await criarTemasDia(dataIso(10), [{ puxaPara: "alcance" }]);

    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const resultado = await temasParaCliente(cliente);

    expect(resultado.status).toBe("sem_tema");
  });

  it("cliente sem nicho: sem tema, sem consultar o banco de temas", async () => {
    clienteId = await criarCliente();
    await db().update(clientes).set({ nichoId: null }).where(eq(clientes.id, clienteId));

    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const resultado = await temasParaCliente(cliente);

    expect(resultado.status).toBe("sem_tema");
  });
});

describe("temasParaCliente: aviso da linha editorial", () => {
  it("historico com menos de 5 roteiros: nenhum aviso, ordem original mantida", async () => {
    clienteId = await criarCliente();
    await criarTemasDia(dataIso(0), [
      { puxaPara: "alcance" },
      { puxaPara: "engajamento" },
      { puxaPara: "conversao" },
    ]);

    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const resultado = await temasParaCliente(cliente);

    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") {
      expect(resultado.avisoLinhaEditorial).toBeNull();
      expect(resultado.temas[0].puxaPara).toBe("alcance");
    }
  });

  it("historico puxado para alcance: o tema que puxa para conversao vai para o primeiro lugar, com aviso", async () => {
    clienteId = await criarCliente();
    for (let i = 0; i < 12; i += 1) await criarRoteiroPostado(clienteId, "alcance", i + 1);
    await criarRoteiroPostado(clienteId, "engajamento", 13);
    await criarRoteiroPostado(clienteId, "engajamento", 14);
    await criarRoteiroPostado(clienteId, "conversao", 15);

    await criarTemasDia(dataIso(0), [
      { puxaPara: "alcance" },
      { puxaPara: "engajamento" },
      { puxaPara: "conversao" },
    ]);

    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const resultado = await temasParaCliente(cliente);

    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") {
      expect(resultado.temas[0].puxaPara).toBe("conversao");
      expect(resultado.avisoLinhaEditorial).toBe(
        "dos seus últimos 15 vídeos, 12 foram para te conhecerem e só 1 para te chamarem para comprar; hoje o tema puxa para o lado de fechar",
      );
    }
  });
});

describe("avaliarTema", () => {
  it("sem evidencia nenhuma: nota de viralizar 4 ou menos, e sugere angulo vizinho", async () => {
    clienteId = await criarCliente();
    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];

    const resultado = await avaliarTema(cliente, "assunto sem nenhum video parecido no banco");

    expect(resultado.pilares.viralizar.nota).toBeLessThanOrEqual(4);
    expect(resultado.anguloSugerido).not.toBeNull();

    const [linha] = await db().select().from(avaliacoesTema).where(eq(avaliacoesTema.clienteId, clienteId));
    expect(linha.tema).toBe("assunto sem nenhum video parecido no banco");
  });

  it("com evidencia clara: nota de viralizar mais alta, e a avaliacao fica gravada", async () => {
    clienteId = await criarCliente();
    for (let i = 0; i < 3; i += 1) {
      await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `evidencia-${i}`,
          url: `https://exemplo.invalido/evidencia-${i}`,
          nichoId,
          titulo: "como limpar sofa de estofado",
          foraDaCurva: "6",
          publicadoEm: new Date(),
          analise: {
            assunto: "limpeza de sofa",
            gancho: "x",
            estrutura: "x",
            fechamento: "x",
            chamadaFinal: "x",
            formato: "fala_para_camera",
            porQueFuncionou: "x",
          } as never,
        });
    }

    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const resultado = await avaliarTema(cliente, "limpar sofa estofado");

    expect(resultado.pilares.viralizar.nota).toBeGreaterThanOrEqual(9);
    expect(resultado.evidencias.length).toBeGreaterThan(0);
  });

  it("cliente sem briefing compilado: erro nomeado", async () => {
    clienteId = await criarCliente({ comBriefing: false });
    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];

    await expect(avaliarTema(cliente, "qualquer assunto")).rejects.toThrow(ErroTemas);
  });
});
