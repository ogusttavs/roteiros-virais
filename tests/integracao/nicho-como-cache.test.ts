/**
 * "Nicho como cache" até o roteiro (E24 parte 2; escopo 5.6, modelo híbrido), contra o Postgres real e com o simulador de IA.
 *
 * As duas metades da regra, pela porta de verdade e não por tabela:
 *  1. Uma marca nova que escolhe um ramo que já tem base ENTRA nela: o mesmo setor, nenhuma pesquisa nova, nenhum vídeo, conta ou setor a
 *     mais, e o roteiro dela sai em cima das MESMAS evidências do roteiro da marca que chegou antes.
 *  2. A camada exclusiva de cada marca (perfil do briefing, concorrente citado, o que ela confirmou sobre si, regra aprendida, leitura de
 *     um perfil dela) chega ao prompt dela e a nenhum outro: circula padrão, nunca conteúdo. Conferido no texto que a IA de fato recebe.
 *
 * Os isolamentos por tabela já têm teste próprio (`perfis-citados`, `contexto-marca`, `analisar-perfil`, `aprendizado`); este junta as
 * camadas com duas marcas reais no mesmo setor, que é o caso que o modelo híbrido cria.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { db, getPool } from "@/db";
import {
  aprendizadoCliente,
  briefings,
  clientes,
  contas,
  contextoMarcaItens,
  geracoesIA,
  nichos,
  perfisAnalisados,
  perfisCitados,
  user,
  videos,
  type PerfilCompilado,
} from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { salvarRamoConta } from "@/servicos/clientes";
import { nichoDoRamo } from "@/servicos/ramos";
import { gerarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);

const RAMO = "odontologia";
const TEMA = "clareamento dental caseiro";

/** Marcas que só existem para o teste achar vazamento: nenhuma aparece em prompt nenhum a não ser pelo caminho da própria marca. */
type Marcas = { tag: string; perfil: PerfilCompilado; concorrente: string };

function marcas(tag: string): Marcas {
  return {
    tag,
    concorrente: `@concorrente_${tag}`,
    perfil: {
      fatos: {
        oQueVende: `vende ${tag}_servico_unico de clareamento`,
        preco: "a partir de R$ 300",
        clienteIdeal: `quem mora em ${tag}_bairro_unico`,
        medos: ["sensibilidade depois do clareamento"],
        frasesDaFala: [`"${tag}_frase_unica"`],
        proibicoes: ["garantia total"],
        cenasFilmaveis: ["a cadeira do consultorio"],
        concorrentes: [],
        perfisAdmirados: [],
      },
      resumo: `clinica ${tag}_resumo_unico em clareamento dental`,
      referencias: [],
    },
  };
}

let contador = 0;

async function criarMarca(m: Marcas): Promise<number> {
  contador += 1;
  const usuarioId = `nicho-cache-${m.tag}-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${m.tag}`, email: `${usuarioId}@nicho-cache.teste` });
  const [marca] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome: `[teste] Marca ${m.tag}`,
      camadaExclusiva: { concorrentes: [m.concorrente], termos: [], perfisAdmirados: [] },
    })
    .returning();
  await db().insert(briefings).values({ clienteId: marca.id, completo: true, perfil: m.perfil });
  return marca.id;
}

/** As camadas que só a marca tem, fora do briefing: o que ela confirmou sobre si, a regra que o app aprendeu dela e a leitura de um perfil dela. */
async function darCamadaExclusiva(clienteId: number, m: Marcas): Promise<{ fala: string; regra: string; leitura: string; handle: string }> {
  const fala = `fala ${m.tag}_confirmado_unico e sem pressa`;
  const regra = `${m.tag}_regra_aprendida_unica`;
  const leitura = `${m.tag}_leitura_unica do que esse perfil faz`;
  const handle = `perfil_${m.tag}_unico`;
  await db()
    .insert(contextoMarcaItens)
    .values({ clienteId, categoria: "fala", origem: "site", texto: fala, estado: "confirmado", textoConfirmado: fala });
  await db().insert(aprendizadoCliente).values({ clienteId, regra, ativa: true });
  const [citado] = await db()
    .insert(perfisCitados)
    .values({ clienteId, tipo: "admira", rede: "instagram", handle })
    .returning();
  await db()
    .insert(perfisAnalisados)
    .values({ clienteId, perfilCitadoId: citado.id, origem: "citado", rede: "instagram", handle, existeNaRede: true, leitura });
  return { fala, regra, leitura, handle };
}

async function contagens() {
  const [{ v }] = (await db().execute(sql`select count(*)::int as v from videos`)).rows as { v: number }[];
  const [{ c }] = (await db().execute(sql`select count(*)::int as c from contas`)).rows as { c: number }[];
  const [{ n }] = (await db().execute(sql`select count(*)::int as n from nichos`)).rows as { n: number }[];
  const [{ j }] = (await db().execute(sql`select count(*)::int as j from pgboss.job where name = ${FILAS.pesquisaDeSetor}`)).rows as { j: number }[];
  return { videos: v, contas: c, nichos: n, pesquisasDeSetor: j };
}

/** Tudo o que a IA recebeu enquanto `fazer` rodava, numa string só (sistema, entrada, fontes: qualquer campo). */
async function oQueAIARecebeu(fazer: () => Promise<unknown>): Promise<string> {
  gerarEstruturadoMock.mockClear();
  await fazer();
  return gerarEstruturadoMock.mock.calls.map(([params]) => JSON.stringify(params)).join("\n");
}

async function entradasGravadas(clienteId: number): Promise<string> {
  const linhas = await db().select({ entradas: geracoesIA.entradas }).from(geracoesIA).where(eq(geracoesIA.clienteId, clienteId));
  return JSON.stringify(linhas.map((l) => l.entradas));
}

let marcaA: number;
let marcaB: number;
let nichoId: number;
let idsDaBase: number[];
const A = marcas("aaa");
const B = marcas("bbb");
let camadaA: Awaited<ReturnType<typeof darCamadaExclusiva>>;
let camadaB: Awaited<ReturnType<typeof darCamadaExclusiva>>;
let promptDeA: string;
let promptDeB: string;
let evidenciasDeA: number[];
let evidenciasDeB: number[];
let antesDeB: Awaited<ReturnType<typeof contagens>>;

beforeAll(async () => {
  await resetarSchema(db());
  config.regras.setoresNovosPorDia = 1000;
  await garantirBossPronto();
  await db().execute(sql`delete from pgboss.job where name = ${FILAS.pesquisaDeSetor}`);
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("a marca que chega primeiro faz o setor nascer e deixa a base", () => {
  it("escolhe o ramo, o setor nasce com uma pesquisa só, e a base ganha os vídeos do setor", async () => {
    marcaA = await criarMarca(A);
    const { cliente, mudou } = await salvarRamoConta(marcaA, RAMO);
    expect(mudou).toBe(true);
    const setor = await nichoDoRamo(RAMO);
    expect(setor?.id).toBe(cliente.nichoId);
    nichoId = setor!.id;

    // A base do setor, como a coleta e a análise a deixariam: três vídeos fora da curva sobre o assunto.
    idsDaBase = [];
    for (const [i, titulo] of ["clareamento dental caseiro funciona?", "clareamento dental caseiro: o erro comum", "clareamento dental caseiro em 7 dias"].entries()) {
      const [video] = await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `base-odonto-${i}`,
          url: `https://exemplo.invalido/base-odonto-${i}`,
          nichoId,
          titulo,
          foraDaCurva: "6",
          publicadoEm: new Date(),
          idioma: "pt",
          analise: {
            assunto: titulo,
            gancho: "olha o que acontece com o seu dente",
            estrutura: "gancho, demonstracao, fechamento",
            fechamento: "mostra o resultado",
            chamadaFinal: "comenta se voce ja tentou",
            formato: "fala_para_camera",
            porQueFuncionou: "mostra o problema de verdade",
          } as never,
        })
        .returning({ id: videos.id });
      idsDaBase.push(video.id);
    }
    expect((await contagens()).pesquisasDeSetor).toBe(1);
  });
});

describe("a camada exclusiva da primeira marca existe antes de a segunda chegar", () => {
  it("a marca A tem briefing, concorrente, o que confirmou, regra aprendida e leitura de perfil; o roteiro dela usa tudo isso e a base do setor", async () => {
    camadaA = await darCamadaExclusiva(marcaA, A);

    promptDeA = await oQueAIARecebeu(async () => {
      const roteiro = await gerarRoteiro(marcaA, { origem: "livre", textoTema: TEMA, objetivo: "conversao" });
      evidenciasDeA = roteiro.conteudo.evidencias;
    });

    // Controle positivo: sem isto o "não vazou" abaixo não prova nada (poderia ser só a camada que nunca chegou ao prompt).
    expect(promptDeA).toContain("aaa_resumo_unico");
    expect(promptDeA).toContain("aaa_servico_unico");
    expect(promptDeA).toContain(A.concorrente);
    expect(promptDeA).toContain(camadaA.fala);
    expect(promptDeA).toContain(camadaA.regra);
    expect(promptDeA).toContain(camadaA.leitura);
    expect(evidenciasDeA.length).toBeGreaterThan(0);
    for (const id of evidenciasDeA) expect(idsDaBase).toContain(id);
  });
});

describe("a marca nova entra na base que já existe", () => {
  it("escolher o mesmo ramo cai no mesmo setor e não cria vídeo, conta, setor nem pesquisa", async () => {
    antesDeB = await contagens();

    marcaB = await criarMarca(B);
    const { cliente, mudou } = await salvarRamoConta(marcaB, RAMO);

    expect(mudou).toBe(true);
    expect(cliente.nichoId).toBe(nichoId);
    expect(await contagens()).toEqual(antesDeB);
    const linhas = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, RAMO));
    expect(linhas).toHaveLength(1);
  });

  it("o roteiro dela sai das mesmas evidências da base, sem coleta nem pesquisa nova", async () => {
    camadaB = await darCamadaExclusiva(marcaB, B);

    promptDeB = await oQueAIARecebeu(async () => {
      const roteiro = await gerarRoteiro(marcaB, { origem: "livre", textoTema: TEMA, objetivo: "conversao" });
      evidenciasDeB = roteiro.conteudo.evidencias;
    });

    expect(evidenciasDeB.length).toBeGreaterThan(0);
    for (const id of evidenciasDeB) expect(idsDaBase).toContain(id);
    // As duas marcas, mesmo tema, mesma base: as mesmas evidências.
    expect([...evidenciasDeB].sort()).toEqual([...evidenciasDeA].sort());
    expect(await contagens()).toEqual(antesDeB);
  });

  it("a camada exclusiva da B chega ao prompt dela (controle positivo)", () => {
    expect(promptDeB).toContain("bbb_resumo_unico");
    expect(promptDeB).toContain("bbb_servico_unico");
    expect(promptDeB).toContain(B.concorrente);
    expect(promptDeB).toContain(camadaB.fala);
    expect(promptDeB).toContain(camadaB.regra);
    expect(promptDeB).toContain(camadaB.leitura);
  });
});

describe("a camada exclusiva não vaza entre marcas do mesmo setor", () => {
  /** Tudo o que é só de uma marca: o perfil, o concorrente, o que confirmou, a regra aprendida, o perfil lido. */
  function soDe(camada: typeof camadaA, m: Marcas): string[] {
    return [`${m.tag}_resumo_unico`, `${m.tag}_servico_unico`, `${m.tag}_bairro_unico`, `${m.tag}_frase_unica`, m.concorrente, camada.fala, camada.regra, camada.leitura, camada.handle];
  }

  it("nada da marca A está no prompt da B, e nada da B no da A", () => {
    for (const marcador of soDe(camadaA, A)) expect(promptDeB, `a marca B recebeu "${marcador}", que é só da A`).not.toContain(marcador);
    for (const marcador of soDe(camadaB, B)) expect(promptDeA, `a marca A recebeu "${marcador}", que é só da B`).not.toContain(marcador);
  });

  it("o que ficou gravado das gerações (a base do aprendizado e do admin) também é só de cada marca", async () => {
    // O registro guarda a entrada variável (tema, evidência, recentes), não o prompt de sistema; o controle é o tema que as duas pediram.
    const gravadoA = await entradasGravadas(marcaA);
    const gravadoB = await entradasGravadas(marcaB);
    expect(gravadoA).toContain(TEMA);
    expect(gravadoB).toContain(TEMA);
    for (const marcador of soDe(camadaB, B)) expect(gravadoA, `a geração da A guardou "${marcador}"`).not.toContain(marcador);
    for (const marcador of soDe(camadaA, A)) expect(gravadoB, `a geração da B guardou "${marcador}"`).not.toContain(marcador);
  });

  it("a A gera de novo depois que a B existe e continua sem nada da B (a marca nova não contamina quem já estava)", async () => {
    const depois = await oQueAIARecebeu(() => gerarRoteiro(marcaA, { origem: "livre", textoTema: TEMA, objetivo: "conversao" }));
    expect(depois).toContain("aaa_resumo_unico");
    for (const marcador of soDe(camadaB, B)) expect(depois).not.toContain(marcador);
  });
});

describe("a base compartilhada não tem dono (a camada exclusiva mora em tabelas à parte)", () => {
  it("contas, vídeos e modelo do setor não têm coluna que aponte para uma marca", async () => {
    const colunas = await db().execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('contas', 'videos', 'modelos_nicho', 'temas_dia', 'noticias')
        and column_name like '%cliente%'
    `);
    expect(colunas.rows).toEqual([]);
  });

  it("a base do setor continua igual depois das duas marcas: os mesmos vídeos, nenhum com dono", async () => {
    const doSetor = await db().select({ id: videos.id }).from(videos).where(eq(videos.nichoId, nichoId));
    expect(doSetor.map((v) => v.id).sort()).toEqual([...idsDaBase].sort());
    expect(await db().select().from(contas).where(eq(contas.nichoId, nichoId))).toEqual([]);
  });
});
