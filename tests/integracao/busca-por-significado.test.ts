/**
 * E17 parte 1 (refeita em 23/10/2026), contra o Postgres real: a prova do Tema livre por significado próximo, só com o que o banco já tem (`unaccent`, `pg_trgm`,
 * busca em português com radical, sinônimos do catálogo) e o modelo barato escolhendo entre os candidatos quando a busca achou pouco. Tudo desligado por padrão
 * (`config.busca`); os testes ligam e desligam na mão e restauram no fim.
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

let nichoId: number;
let clienteId: number;
let chaveDe: Map<number, string>;
let idDe: Map<string, number>;

async function acha(tema: string, limite = 8): Promise<string[]> {
  const evidencia = await evidenciaParaTema(nichoId, tema, limite, undefined, [], undefined, { clienteId });
  return evidencia.map((v) => chaveDe.get(v.id) ?? `?${v.id}`);
}

function ligar(porSignificado: boolean, reordenarComIA = false): void {
  config.busca.porSignificado = porSignificado;
  config.busca.reordenarComIA = reordenarComIA;
}

function chamadasDoModelo() {
  return gerarEstruturadoMock.mock.calls.map(([params]) => params).filter((params) => params.tarefa === "reordenarEvidencia");
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

describe("desligado, nada muda (padrão em produção)", () => {
  it.each(TEMAS_DE_COMPARACAO)("$tema: a busca de sempre acha $antes", async ({ tema, antes }) => {
    ligar(false);
    expect(await acha(tema)).toEqual(antes);
    expect(chamadasDoModelo()).toHaveLength(0);
  });

  it("a chave do modelo barato ligada sozinha, sem a busca por significado, não chama o modelo", async () => {
    ligar(false, true);
    expect(await acha("meu filho tem medo de dentista")).toEqual([]);
    expect(chamadasDoModelo()).toHaveLength(0);
  });
});

describe("ligado, o tema escrito com outras palavras acha o vídeo certo", () => {
  it.each(TEMAS_DE_COMPARACAO)("$tema: $nota", async ({ tema, antes, primeiro }) => {
    ligar(true);
    const depois = await acha(tema);
    if (primeiro === null) {
      expect(depois).toEqual([]);
      return;
    }
    expect(depois[0]).toBe(primeiro);
    // Quem entrava continua entrando.
    for (const chave of antes) expect(depois).toContain(chave);
    // Nunca vídeo de outro assunto.
    expect(depois).not.toContain("bolo");
    expect(depois).not.toContain("consultorio");
  });

  it("acento e plural não atrapalham, em qualquer dos dois lados", async () => {
    ligar(true);
    expect((await acha("implantes dentarios"))[0]).toBe("implante");
    expect((await acha("IMPLANTE DENTÁRIO"))[0]).toBe("implante");
    expect((await acha("tratamentos de canais"))[0]).toBe("canal");
    expect((await acha("halito"))[0]).toBe("halito");
  });

  it("a palavra comum do setor não puxa todo vídeo dela: 'dentes' sozinha dá meio ponto, não admite", async () => {
    ligar(true);
    // "clarear os dentes" admite só o clareamento, e não os onze vídeos que falam de dente.
    expect(await acha("clarear os dentes")).toEqual(["clareamento"]);
  });

  it("o sinônimo do catálogo completa a prova, mas não basta sozinho", async () => {
    ligar(true);
    // "clareamento" é do ramo de odontologia, e "ortodontia" é vizinha dele no catálogo: o vídeo de ortodontia para adultos (uma palavra do tema mais um sinônimo) entra;
    // o de pilates para adultos (a mesma palavra do tema, sem sinônimo nenhum) fica de fora.
    const encontrados = await acha("clareamento caseiro para adultos");
    expect(encontrados).toContain("ortodontia");
    expect(encontrados).not.toContain("pilates");
  });

  it("os filtros de sempre continuam valendo por cima: vídeo antigo, sem análise ou abaixo do piso nunca entra", async () => {
    ligar(true);
    const velho = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: "bps-velho",
        url: "https://exemplo.invalido/bps-velho",
        nichoId,
        titulo: "Clareamento dental antigo",
        views: 200000,
        foraDaCurva: "9",
        publicadoEm: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        analise: { assunto: "clareamento antigo", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
      })
      .returning({ id: videos.id });
    const semAnalise = await db()
      .insert(videos)
      .values({ plataforma: "youtube", idExterno: "bps-sem-analise", url: "https://exemplo.invalido/bps-sem-analise", nichoId, titulo: "Clareamento dental sem leitura", views: 200000, publicadoEm: new Date() })
      .returning({ id: videos.id });
    const ids = (await evidenciaParaTema(nichoId, "clareamento dental")).map((v) => v.id);
    expect(ids).not.toContain(velho[0].id);
    expect(ids).not.toContain(semAnalise[0].id);
    expect(ids).toContain(idDe.get("clareamento")!);
  });
});

describe("o modelo barato escolhe a prova quando a busca achou pouco", () => {
  const TEMA = "meu filho tem medo de dentista";

  beforeAll(async () => {
    // Mais vídeos do que o teto de candidatos, para provar o corte.
    for (let i = 0; i < 40; i += 1) {
      await db()
        .insert(videos)
        .values({
          plataforma: "youtube",
          idExterno: `bps-enchimento-${i}`,
          url: `https://exemplo.invalido/bps-enchimento-${i}`,
          nichoId,
          titulo: `Dica de consultório número ${i}`,
          views: 200000,
          foraDaCurva: String(1 + (i % 5)),
          publicadoEm: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          idioma: "pt",
          analise: { assunto: `dica geral ${i}`, gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", formato: "fala_para_camera", porQueFuncionou: "x" } as never,
        });
    }
  }, 60_000);

  async function geracoes() {
    return db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "reordenarEvidencia"));
  }

  it("com as duas chaves ligadas e o tema sem prova, o modelo escolhe, respeitando o teto de candidatos, e a chamada é registrada", async () => {
    ligar(true, true);
    const antes = (await geracoes()).length;

    const encontrados = await acha(TEMA);

    expect(encontrados).toEqual(["crianca"]);
    const chamadas = chamadasDoModelo();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].nivel).toBe("barato");
    const linhasDeCandidato = chamadas[0].entrada.split("\n").filter((l) => /^id \d+:/.test(l));
    expect(linhasDeCandidato.length).toBeGreaterThan(0);
    expect(linhasDeCandidato.length).toBeLessThanOrEqual(MAXIMO_DE_CANDIDATOS_PARA_IA);
    expect(chamadas[0].maxTokens).toBeLessThanOrEqual(1000);

    const linhas = await geracoes();
    expect(linhas.length).toBe(antes + 1);
    const registrada = linhas[linhas.length - 1];
    expect(registrada.clienteId).toBe(clienteId);
    expect(registrada.ramoId).toBe(nichoId);
    expect(registrada.versaoPrompt).toBe("1.0.0");
    expect(registrada.saida).toEqual({ mesmoAssunto: [idDe.get("crianca")] });
  });

  it("a mesma pergunta não é paga duas vezes: a segunda sai do registro, mesmo escrita com outra caixa e acento", async () => {
    ligar(true, true);
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
    // Nenhuma chamada nova, nenhuma linha nova: pagou uma vez.
    expect(chamadasDoModelo()).toHaveLength(1);
    expect((await geracoes()).length).toBe(linhasAntes + 1);
  });

  it("um vídeo novo no setor muda os candidatos, e então a pergunta é outra (a chave do registro leva os candidatos)", () => {
    expect(chaveDoCache("1.0.0", [1], "Tema", [1, 2, 3])).toBe(chaveDoCache("1.0.0", [1], "tema", [3, 2, 1]));
    expect(chaveDoCache("1.0.0", [1], "tema", [1, 2, 3])).not.toBe(chaveDoCache("1.0.0", [1], "tema", [1, 2, 3, 4]));
    expect(chaveDoCache("1.0.0", [1], "tema", [1, 2])).not.toBe(chaveDoCache("1.0.0", [1, 2], "tema", [1, 2]));
    expect(chaveDoCache("1.0.0", [1], "tema", [1, 2])).not.toBe(chaveDoCache("1.1.0", [1], "tema", [1, 2]));
  });

  it("id que o modelo inventa, ou repete, é ignorado, e o corte por limite vale", async () => {
    ligar(true, true);
    const crianca = idDe.get("crianca")!;
    gerarEstruturadoMock.mockResolvedValueOnce({
      dados: { mesmoAssunto: [987654321, crianca, crianca] },
      modelo: "mock",
      tokensEntrada: 10,
      tokensSaida: 5,
      tokensCacheLeitura: 0,
      tokensCacheEscrita: 0,
    });
    expect(await acha("medo de dentista, o que fazer com meu filho")).toEqual(["crianca"]);

    const todos = await acha("medo de dentista [mock:reordenar-tudo]", 5);
    expect(todos.length).toBe(5);
  });

  it("o modelo devolvendo lista vazia deixa a prova vazia (sem inventar), e fora do ar cai na busca por palavra sem derrubar nada", async () => {
    ligar(true, true);
    expect(await acha("cuidado com crianças [mock:reordenar-vazio]")).toEqual([]);
    const linhasAntes = (await geracoes()).length;
    // Fora do ar: a busca por palavra de sempre (aqui, "clareamento" achava um vídeo sozinha, mas o tema abaixo não acha nenhum).
    expect(await acha("receio do consultório odontológico [mock:reordenar-fora]")).toEqual([]);
    expect((await geracoes()).length).toBe(linhasAntes);
  });

  it("quando a busca já achou o bastante, o modelo não é chamado", async () => {
    ligar(true, true);
    gerarEstruturadoMock.mockClear();
    const encontrados = await acha("dica de consultório");
    expect(encontrados.length).toBeGreaterThanOrEqual(3);
    expect(chamadasDoModelo()).toHaveLength(0);
  });

  it("sem cliente (ferramentas, scripts) o modelo nunca é chamado, mesmo com as duas chaves ligadas", async () => {
    ligar(true, true);
    gerarEstruturadoMock.mockClear();
    await evidenciaParaTema(nichoId, "uma pergunta sem nenhuma prova no setor inteiro");
    expect(chamadasDoModelo()).toHaveLength(0);
  });
});
