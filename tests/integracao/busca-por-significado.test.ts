/**
 * E17 parte 1 (refeita em 23/10/2026 e ajustada pela medição com dados reais), contra o Postgres real: a prova do Tema livre por significado. Com `BUSCA_POR_SIGNIFICADO` ligada,
 * em TODA busca do Tema livre o modelo barato lê o conjunto elegível do setor (até 200 vídeos) e devolve só os do mesmo assunto; a busca por palavra só ordena os candidatos
 * quando há mais elegíveis que o teto, e volta a valer se o modelo não responde. Desligada (o padrão), nada muda. O mock do modelo não entende significado: aqui se prova o
 * encanamento (quem é chamado, com quê, quanto custa, o que fica em cache); o significado em si é medido com chave real.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { db, getPool } from "@/db";
import { clientes, geracoesIA, nichos, user, videos } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { config } from "@/lib/config";
import { chaveDoCache, MAXIMO_DE_CANDIDATOS_PARA_IA } from "@/servicos/busca-por-significado";
import { evidenciaParaTema } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";
import { semearBuscaPorSignificado, TEMAS_DE_COMPARACAO } from "../fixtures/busca/busca-por-significado";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);
const DIA = 24 * 60 * 60 * 1000;

let nichoId: number;
let clienteId: number;
let chaveDe: Map<number, string>;
let idDe: Map<string, number>;

async function acha(tema: string, limite = 8, nicho = nichoId): Promise<string[]> {
  const evidencia = await evidenciaParaTema(nicho, tema, limite, undefined, [], undefined, { clienteId });
  return evidencia.map((v) => chaveDe.get(v.id) ?? `?${v.id}`);
}

function ligar(porSignificado: boolean): void {
  config.busca.porSignificado = porSignificado;
}

function chamadasDoModelo() {
  return gerarEstruturadoMock.mock.calls.map(([params]) => params).filter((params) => params.tarefa === "reordenarEvidencia");
}

function linhasDeCandidato(entrada: string): string[] {
  return entrada.split("\n").filter((l) => /^id \d+:/.test(l));
}

async function geracoes() {
  return db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "reordenarEvidencia"));
}

/** Insere vídeos elegíveis de um setor em lote: `titulo`, `foraDaCurva` e, se quiser, etiquetas; o assunto da análise é o título. */
async function inserirVideos(setor: number, prefixo: string, itens: { titulo: string; foraDaCurva: number; etiquetas?: string[] }[]): Promise<number[]> {
  const ids: number[] = [];
  for (let inicio = 0; inicio < itens.length; inicio += 100) {
    const lote = itens.slice(inicio, inicio + 100);
    const linhas = await db()
      .insert(videos)
      .values(
        lote.map((v, i) => ({
          plataforma: "youtube" as const,
          idExterno: `${prefixo}-${inicio + i}`,
          url: `https://exemplo.invalido/${prefixo}-${inicio + i}`,
          nichoId: setor,
          titulo: v.titulo,
          etiquetas: v.etiquetas ?? [],
          views: 200000,
          foraDaCurva: String(v.foraDaCurva),
          publicadoEm: new Date(Date.now() - 5 * DIA),
          idioma: "pt",
          analise: { assunto: v.titulo, gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
        })),
      )
      .returning({ id: videos.id });
    ids.push(...linhas.map((l) => l.id));
  }
  return ids;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "busca-significado", nome: "Odontologia de teste", termos: [] }).returning();
  nichoId = nicho.id;
  idDe = await semearBuscaPorSignificado(nichoId, "bps");
  chaveDe = new Map([...idDe].map(([chave, id]) => [id, chave]));
  await db().insert(user).values({ id: "bps-usuario", name: "[teste] Marca", email: "marca@bps.teste" });
  const [marca] = await db().insert(clientes).values({ usuarioId: "bps-usuario", nome: "[teste] Marca", nichoId }).returning();
  clienteId = marca.id;
}, 60_000);

beforeEach(() => {
  ligar(false);
  gerarEstruturadoMock.mockClear();
});

afterEach(() => {
  ligar(false);
});

afterAll(async () => {
  await getPool().end();
});

describe("as extensões e as colunas da migração", () => {
  it("unaccent e pg_trgm existem, f_unaccent é imutável e as colunas geradas tiram o acento", async () => {
    const extensoes = await db().execute<{ extname: string }>(sql`select extname from pg_extension where extname in ('unaccent', 'pg_trgm') order by 1`);
    expect(extensoes.rows.map((r) => r.extname)).toEqual(["pg_trgm", "unaccent"]);

    const imutavel = await db().execute<{ provolatile: string }>(sql`select provolatile from pg_proc where proname = 'f_unaccent'`);
    expect(imutavel.rows[0].provolatile).toBe("i");

    const [linha] = await db().select({ texto: videos.textoCurto }).from(videos).where(eq(videos.id, idDe.get("halito")!));
    expect(linha.texto).toBe("mau halito: as 3 causas que ninguem conta causas do mau halito");
  });
});

describe("desligado, nada muda (o padrão em produção)", () => {
  it.each(TEMAS_DE_COMPARACAO)("$tema: a busca de sempre acha $antes e o modelo não é chamado", async ({ tema, antes }) => {
    ligar(false);
    expect(await acha(tema)).toEqual(antes);
    expect(chamadasDoModelo()).toHaveLength(0);
  });
});

describe("ligado, o modelo barato escolhe a prova em toda busca do Tema livre", () => {
  it("chama o modelo mesmo quando a busca de palavra já achava bastante, com o setor inteiro como candidatos", async () => {
    ligar(true);
    // "dentes" acha vários vídeos pela palavra; antes o modelo só entrava com menos de 3 provas.
    await acha("cuidar dos dentes todo dia");
    const chamadas = chamadasDoModelo();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].nivel).toBe("barato");
    // 18 vídeos do brinquedo, todos elegíveis: todos vão ao modelo (o teto é de 200, não de 30).
    expect(linhasDeCandidato(chamadas[0].entrada)).toHaveLength(18);
  });

  it("chama o modelo também quando a busca de palavra não acha nada, e o que ele devolve vira a prova", async () => {
    ligar(true);
    const crianca = idDe.get("crianca")!;
    gerarEstruturadoMock.mockResolvedValueOnce({
      dados: { motivo: "O tema pede levar criança ao dentista.", mesmoAssunto: [crianca] },
      modelo: "mock",
      tokensEntrada: 10,
      tokensSaida: 5,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    });
    expect(await acha("meu filho tem medo de dentista")).toEqual(["crianca"]);
    expect(chamadasDoModelo()).toHaveLength(1);
  });

  it("pode devolver nenhum: lista vazia é prova nenhuma, e a busca de palavra não completa", async () => {
    ligar(true);
    // "gengiva" achava um vídeo pela palavra; o modelo diz que nenhum trata do assunto, e vale o modelo.
    expect(await acha("gengiva sangrando [mock:reordenar-vazio]")).toEqual([]);
  });

  it("a chamada é registrada com cliente, ramo, versão 1.2.0 e o motivo", async () => {
    ligar(true);
    const antes = (await geracoes()).length;
    await acha("quanto custa um implante");
    const linhas = await geracoes();
    expect(linhas.length).toBe(antes + 1);
    const registrada = linhas[linhas.length - 1];
    expect(registrada.clienteId).toBe(clienteId);
    expect(registrada.ramoId).toBe(nichoId);
    expect(registrada.versaoPrompt).toBe("1.2.0");
    expect(typeof (registrada.saida as { motivo: string }).motivo).toBe("string");
    expect(registrada.evidencias).toContain(idDe.get("implante")!);
  });

  it("id que o modelo inventa, ou repete, é ignorado, e o corte por limite vale", async () => {
    ligar(true);
    const crianca = idDe.get("crianca")!;
    gerarEstruturadoMock.mockResolvedValueOnce({
      dados: { motivo: "x", mesmoAssunto: [987654321, crianca, crianca] },
      modelo: "mock",
      tokensEntrada: 10,
      tokensSaida: 5,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    });
    expect(await acha("medo de dentista, o que fazer com meu filho")).toEqual(["crianca"]);
    expect((await acha("outro tema qualquer [mock:reordenar-tudo]", 5)).length).toBe(5);
  });

  it("a mesma pergunta não é paga duas vezes: a segunda sai do registro, mesmo escrita com outra caixa e acento", async () => {
    ligar(true);
    const pergunta = "receio de levar o filho ao dentista";
    const linhasAntes = (await geracoes()).length;

    const primeira = await acha(pergunta);
    expect(primeira).toContain("crianca");
    expect(chamadasDoModelo()).toHaveLength(1);
    expect((await geracoes()).length).toBe(linhasAntes + 1);

    const segunda = await acha(pergunta);
    const terceira = await acha("RECEIO de levar o FILHO ao dentísta");

    expect(segunda).toEqual(primeira);
    expect(terceira).toEqual(primeira);
    expect(chamadasDoModelo()).toHaveLength(1);
    expect((await geracoes()).length).toBe(linhasAntes + 1);
  });

  it("a chave do cache leva versão, setores, tema sem acento nem caixa e os candidatos", () => {
    expect(chaveDoCache("1.2.0", [1], "Tema", [1, 2, 3])).toBe(chaveDoCache("1.2.0", [1], "tema", [3, 2, 1]));
    expect(chaveDoCache("1.2.0", [1], "tema", [1, 2, 3])).not.toBe(chaveDoCache("1.2.0", [1], "tema", [1, 2, 3, 4]));
    expect(chaveDoCache("1.2.0", [1], "tema", [1, 2])).not.toBe(chaveDoCache("1.2.0", [1, 2], "tema", [1, 2]));
    expect(chaveDoCache("1.2.0", [1], "tema", [1, 2])).not.toBe(chaveDoCache("1.0.0", [1], "tema", [1, 2]));
  });

  it("modelo fora do ar: vale a busca por palavra de sempre, sem erro e sem registro", async () => {
    ligar(true);
    const linhasAntes = (await geracoes()).length;
    // A palavra "mancha" achava o vídeo do café pela etiqueta, antes e agora.
    expect(await acha("mancha [mock:reordenar-fora]")).toEqual(["cafe"]);
    expect((await geracoes()).length).toBe(linhasAntes);
  });

  it("sem cliente (ferramentas, scripts) o modelo nunca é chamado, mesmo ligada", async () => {
    ligar(true);
    const evidencia = await evidenciaParaTema(nichoId, "gengiva sangrando ao escovar");
    expect(evidencia.map((v) => chaveDe.get(v.id))).toEqual(["gengiva"]);
    expect(chamadasDoModelo()).toHaveLength(0);
  });

  it("setor sem nenhum vídeo elegível: nada a escolher, o modelo não é chamado", async () => {
    ligar(true);
    const [vazio] = await db().insert(nichos).values({ slug: "busca-significado-vazio", nome: "Vazio", termos: [] }).returning();
    expect(await acha("qualquer coisa", 8, vazio.id)).toEqual([]);
    expect(chamadasDoModelo()).toHaveLength(0);
  });
});

describe("o teto de candidatos e a ordem em que o modelo os lê", () => {
  let setorGrande: number;
  let classico: number;

  beforeAll(async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "busca-significado-grande", nome: "Setor grande", termos: [] }).returning();
    setorGrande = nicho.id;
    // 249 vídeos que dividem três palavras soltas com o tema, e um que só tem "pasta" numa etiqueta: a busca de sempre o achava, e por pouco (um ponto).
    const enchimento = Array.from({ length: 249 }, (_, i) => ({ titulo: `Dica ${i} para usar removedora de mancha em casa`, foraDaCurva: 5 }));
    const ids = await inserirVideos(setorGrande, "grande", [{ titulo: "Segredo do rejunte branco", foraDaCurva: 1, etiquetas: ["pasta"] }, ...enchimento]);
    classico = ids[0];
    chaveDe = new Map([...chaveDe, ...ids.map((id, i) => [id, i === 0 ? "classico" : `enchimento-${i}`] as [number, string])]);
  }, 120_000);

  it("nunca mais que 200 candidatos vão ao modelo, qualquer que seja o tamanho do setor", async () => {
    ligar(true);
    await acha("onde usar removedora de mancha", 8, setorGrande);
    const chamadas = chamadasDoModelo();
    expect(chamadas).toHaveLength(1);
    expect(MAXIMO_DE_CANDIDATOS_PARA_IA).toBe(200);
    expect(linhasDeCandidato(chamadas[0].entrada)).toHaveLength(200);
  });

  it("a prova que a busca de sempre achava vem na frente dos candidatos, mesmo valendo um ponto contra três palavras soltas (casos L01 e E05)", async () => {
    ligar(true);
    const resultado = await acha("onde usar a pasta removedora de mancha [mock:reordenar-tudo]", 8, setorGrande);
    expect(resultado[0]).toBe("classico");
    const entrada = chamadasDoModelo().at(-1)!.entrada;
    expect(linhasDeCandidato(entrada)[0].startsWith(`id ${classico}:`)).toBe(true);
  });
});

describe("termo de duas letras como IA é palavra inteira, não descartada (caso E07)", () => {
  it("o vídeo que tem a sigla entra entre os candidatos de um setor maior que o teto", async () => {
    const [nicho] = await db().insert(nichos).values({ slug: "busca-significado-ia", nome: "Setor da sigla", termos: [] }).returning();
    // 247 vídeos com duas das três palavras do tema e nota alta; 3 com a sigla e as mesmas duas palavras, e nota baixa.
    const comSigla = Array.from({ length: 3 }, (_, i) => ({ titulo: `IA no negocio pequeno ${i}`, foraDaCurva: 1 }));
    const outros = Array.from({ length: 247 }, (_, i) => ({ titulo: `Dica ${i} de negocio pequeno`, foraDaCurva: 5 }));
    const ids = await inserirVideos(nicho.id, "sigla", [...outros, ...comSigla]);
    const idsDaSigla = new Set(ids.slice(247));
    ligar(true);

    await evidenciaParaTema(nicho.id, "usar IA no negocio pequeno [mock:reordenar-tudo]", 8, undefined, [], undefined, { clienteId });

    const entrada = chamadasDoModelo().at(-1)!.entrada;
    const lidos = linhasDeCandidato(entrada).map((l) => Number(l.match(/^id (\d+):/)![1]));
    expect(lidos).toHaveLength(200);
    for (const id of idsDaSigla) expect(lidos).toContain(id);
    // E vêm na frente: a sigla é a palavra que define o tema.
    expect(new Set(lidos.slice(0, 3))).toEqual(idsDaSigla);
  });
});
