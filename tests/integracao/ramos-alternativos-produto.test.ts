/**
 * Onde os ramos alternativos entram no produto (E45, PR 3), contra o Postgres real: o tema livre (a prova e a nota), a evidência do roteiro e
 * as Referências olham o ramo principal e os alternativos, cada um com a régua (o piso) do próprio setor; os temas do dia continuam só do
 * ramo principal.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, ramosDaConta, temasDia, user, videos, type PerfilCompilado } from "@/db/schema";
import * as avaliarTemaIA from "@/ia/prompts/avaliarTema";
import { hojeISO } from "@/lib/config";
import {
  evidenciaParaRoteiro,
  evidenciaParaTema,
  referenciasDoNicho,
  setoresComPiso,
  todosOsVideosDoNicho,
} from "@/servicos/pesquisa";
import { avaliarTema, ramoQueMaisCasou, temasParaCliente } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "consultoria",
    preco: "pacote mensal por R$ 400",
    clienteIdeal: "autonomo",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "consultoria para autonomos",
  referencias: [],
};

let principalId: number;
let alternativoId: number;
let marcaId: number;

async function criarVideo(opcoes: { chave: string; nichoId: number; views: number; assunto: string }): Promise<number> {
  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: `rap-${opcoes.chave}`,
      url: `https://exemplo.invalido/rap-${opcoes.chave}`,
      nichoId: opcoes.nichoId,
      titulo: opcoes.assunto,
      views: opcoes.views,
      foraDaCurva: "6",
      publicadoEm: new Date(),
      idioma: "pt",
      analise: {
        assunto: opcoes.assunto,
        gancho: "gancho",
        estrutura: "estrutura",
        fechamento: "fechamento",
        chamadaFinal: "chamada",
        formato: "fala_para_camera",
        porQueFuncionou: "x",
      } as never,
    })
    .returning();
  return video.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "rap-principal", nome: "Ramo principal", termos: [], pisoViews: 50_000 }).returning();
  const [b] = await db().insert(nichos).values({ slug: "rap-alternativo", nome: "Ramo alternativo", termos: [], pisoViews: 200_000 }).returning();
  principalId = a.id;
  alternativoId = b.id;

  await db().insert(user).values({ id: "rap-usuario", name: "[teste] Marca", email: "marca@rap.teste" });
  const [marca] = await db().insert(clientes).values({ usuarioId: "rap-usuario", nome: "[teste] Marca", nichoId: principalId }).returning();
  marcaId = marca.id;
  await db().insert(briefings).values({ clienteId: marcaId, completo: true, perfil: PERFIL });
  await db().insert(ramosDaConta).values({ clienteId: marcaId, nichoId: alternativoId });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("a evidência olha o principal e os alternativos, cada um com o piso do próprio setor", () => {
  it("sem alternativos, só o principal; com o alternativo na lista, o vídeo dele entra (e o do principal vem primeiro no desempate)", async () => {
    const doPrincipal = await criarVideo({ chave: "p1", nichoId: principalId, views: 80_000, assunto: "planilha de custos do mes" });
    const doAlternativo = await criarVideo({ chave: "a1", nichoId: alternativoId, views: 300_000, assunto: "planilha de custos do mes" });

    const so = await evidenciaParaTema(principalId, "planilha custos");
    const com = await evidenciaParaTema(principalId, "planilha custos", 8, undefined, [alternativoId]);

    expect(so.map((v) => v.id)).toEqual([doPrincipal]);
    expect(com.map((v) => v.id).sort()).toEqual([doPrincipal, doAlternativo].sort());
    expect(com[0].id).toBe(doPrincipal);
    expect(com.find((v) => v.id === doAlternativo)?.nichoId).toBe(alternativoId);
  });

  it("o piso é o do setor de cada vídeo: 80 mil views passa no principal (piso 50 mil) e não passa no alternativo (piso 200 mil)", async () => {
    await criarVideo({ chave: "a2", nichoId: alternativoId, views: 80_000, assunto: "contrato de prestacao de servico" });
    const doPrincipal = await criarVideo({ chave: "p2", nichoId: principalId, views: 80_000, assunto: "contrato de prestacao de servico" });

    const evidencia = await evidenciaParaTema(principalId, "contrato prestacao servico", 8, undefined, [alternativoId]);
    const roteiro = await evidenciaParaRoteiro(principalId, "contrato prestacao servico", 8, [alternativoId]);

    expect(evidencia.map((v) => v.id)).toEqual([doPrincipal]);
    expect(roteiro.map((v) => v.id)).toEqual([doPrincipal]);
    expect(roteiro[0].nichoId).toBe(principalId);
  });

  it("a evidência do roteiro traz o setor de cada vídeo e vê o vídeo do alternativo", async () => {
    const doAlternativo = await criarVideo({ chave: "a3", nichoId: alternativoId, views: 400_000, assunto: "imposto do autonomo em dia" });

    const sem = await evidenciaParaRoteiro(principalId, "imposto autonomo");
    const com = await evidenciaParaRoteiro(principalId, "imposto autonomo", 8, [alternativoId]);

    expect(sem).toEqual([]);
    expect(com.map((v) => ({ id: v.id, nichoId: v.nichoId }))).toEqual([{ id: doAlternativo, nichoId: alternativoId }]);
  });
});

describe("o tema livre: a prova inclui o alternativo, e a nota diz de qual ramo ela vem", () => {
  it("um assunto que só o ramo alternativo tem prova recebe nota com evidência daquele ramo e ramoDoAssunto com o nome dele", async () => {
    for (let i = 0; i < 3; i += 1) {
      await criarVideo({ chave: `tl-${i}`, nichoId: alternativoId, views: 500_000, assunto: "reserva de emergencia" });
    }
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, marcaId));

    const resultado = await avaliarTema(cliente, "reserva emergencia");

    expect(resultado.evidencias.length).toBeGreaterThan(0);
    expect(resultado.pilares.viralizar.nota).toBeGreaterThanOrEqual(9);
    expect(resultado.ramoDoAssunto).toBe("Ramo alternativo");
  });

  it("sem ramo alternativo ligado, o mesmo assunto não tem prova (o alternativo só entra quando o admin liga)", async () => {
    await db().delete(ramosDaConta).where(eq(ramosDaConta.clienteId, marcaId));
    try {
      const [cliente] = await db().select().from(clientes).where(eq(clientes.id, marcaId));
      const resultado = await avaliarTema(cliente, "reserva emergencia");

      expect(resultado.evidencias).toEqual([]);
      expect(resultado.ramoDoAssunto).toBeNull();
    } finally {
      await db().insert(ramosDaConta).values({ clienteId: marcaId, nichoId: alternativoId });
    }
  });

  it("a entrada do prompt marca o vídeo de um ramo alternativo (e só ele), e pede para citar o ramo", () => {
    const entrada = avaliarTemaIA.montarEntrada({
      tema: "reserva",
      evidencias: [
        { id: 1, assunto: "a", gancho: "g", foraDaCurva: 5 },
        { id: 2, assunto: "b", gancho: "g", foraDaCurva: 6, ramo: "Nutrição" },
      ],
    });
    expect(entrada).toContain("ramo alternativo: Nutrição");
    expect(entrada.match(/ramo alternativo: /g)).toHaveLength(1);
    expect(entrada).toContain("diga na justificativa de qual ramo");
    expect(avaliarTemaIA.montarEntrada({ tema: "x", evidencias: [{ id: 1, assunto: "a", gancho: "g", foraDaCurva: 5 }] })).not.toContain("ramo alternativo");
  });

  it("ramoQueMaisCasou: só nomeia um alternativo que tem mais vídeos citados que o principal; empate é do principal", () => {
    const nomes = new Map([[7, "Ramo B"]]);
    const evidencias = [
      { id: 1, nichoId: 1 },
      { id: 2, nichoId: 7 },
      { id: 3, nichoId: 7 },
    ];
    expect(ramoQueMaisCasou([1, 2, 3], evidencias, nomes)).toBe("Ramo B");
    expect(ramoQueMaisCasou([1, 2], evidencias, nomes)).toBeNull();
    expect(ramoQueMaisCasou([], evidencias, nomes)).toBeNull();
    expect(ramoQueMaisCasou([1, 2, 3], evidencias, new Map())).toBeNull();
  });
});

describe("Referências com o ramo principal e os alternativos", () => {
  it("as três abas olham os dois setores, cada vídeo medido pelo piso do seu setor, e a pílula Ramo filtra", async () => {
    const setores = await setoresComPiso([principalId, alternativoId]);
    const doPrincipal = await criarVideo({ chave: "r-p", nichoId: principalId, views: 90_000, assunto: "referencia do principal" });
    const doAlternativo = await criarVideo({ chave: "r-a", nichoId: alternativoId, views: 250_000, assunto: "referencia do alternativo" });
    const abaixoDoPisoDele = await criarVideo({ chave: "r-fraco", nichoId: alternativoId, views: 90_000, assunto: "referencia fraca do alternativo" });

    const soPrincipal = await referenciasDoNicho(principalId, { periodoDias: 90 });
    const todos = await referenciasDoNicho(principalId, { periodoDias: 90, setores });
    const soAlternativo = await referenciasDoNicho(principalId, { periodoDias: 90, setores, ramoId: alternativoId });
    const soPrincipalPelaPilula = await referenciasDoNicho(principalId, { periodoDias: 90, setores, ramoId: principalId });
    const ramoDeFora = await referenciasDoNicho(principalId, { periodoDias: 90, setores, ramoId: 999_999 });

    expect(soPrincipal.videos.map((v) => v.id)).not.toContain(doAlternativo);
    expect(todos.videos.map((v) => v.id)).toContain(doPrincipal);
    expect(todos.videos.map((v) => v.id)).toContain(doAlternativo);
    // 90 mil views está abaixo do piso do alternativo (200 mil): nunca é referência dele, mesmo estando acima do piso do principal.
    expect(todos.videos.map((v) => v.id)).not.toContain(abaixoDoPisoDele);
    // Os vídeos do alternativo dos testes de cima também estão aqui (todos acima do piso dele); o que importa é só ele, e sem o fraco.
    expect(soAlternativo.videos.map((v) => v.id)).toContain(doAlternativo);
    expect(soAlternativo.videos.map((v) => v.id)).not.toContain(abaixoDoPisoDele);
    expect(soAlternativo.videos.every((v) => v.nichoId === alternativoId)).toBe(true);
    expect(soPrincipalPelaPilula.videos.every((v) => v.nichoId === principalId)).toBe(true);
    expect(ramoDeFora.videos).toEqual([]);
    expect(ramoDeFora.total).toBe(0);
  });

  it('o segmento "Todos" mostra os dois setores sem a régua, com o selo de abaixo do piso medido pelo setor do vídeo', async () => {
    const setores = await setoresComPiso([principalId, alternativoId]);

    const todos = await todosOsVideosDoNicho(principalId, { periodoDias: 90, setores });
    const fraco = todos.videos.find((v) => v.assunto === "referencia fraca do alternativo");

    expect(fraco).toBeDefined();
    expect(fraco?.nichoId).toBe(alternativoId);
    expect(fraco?.abaixoDaRegua).toBe(true);
    const doPrincipal = todos.videos.find((v) => v.assunto === "referencia do principal");
    expect(doPrincipal?.abaixoDaRegua).toBe(false);

    const soAlternativo = await todosOsVideosDoNicho(principalId, { periodoDias: 90, setores, ramoId: alternativoId });
    expect(soAlternativo.videos.every((v) => v.nichoId === alternativoId)).toBe(true);
  });
});

describe("os temas do dia continuam só do ramo principal", () => {
  it("o alternativo tem temas hoje e o principal também: a marca vê os do principal, e só os dele", async () => {
    const data = hojeISO();
    const tema = (titulo: string) => ({
      titulo,
      descricao: "descricao",
      porQue: "por que",
      evidencias: [1],
      puxaPara: "alcance" as const,
    });
    await db().insert(temasDia).values({ nichoId: principalId, data, temas: [tema("tema do principal")] });
    await db().insert(temasDia).values({ nichoId: alternativoId, data, temas: [tema("tema do alternativo")] });
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, marcaId));

    const resultado = await temasParaCliente(cliente, data);

    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") expect(resultado.temas.map((t) => t.titulo)).toEqual(["tema do principal"]);
  });
});
