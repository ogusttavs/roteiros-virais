/**
 * A marcação de fala do roteiro (E41, parte 2a), contra o Postgres real e com o simulador de IA: escreve uma vez e guarda, não chama IA de novo com marca válida, nunca muda o texto (a trava),
 * só marca Reels falado, isola por marca, apaga as marcas quando o texto falado é editado, e o bloco que o modelo não acerta fica só com as marcas do código.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, roteiros, user, type ConteudoRoteiro, type MarcasDeFala } from "@/db/schema";
import * as cliente from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import { config } from "@/lib/config";
import { pedidoComMarcas, urlDeImpressao } from "@/lib/impressao-de-roteiro";
import { normalizar, textoIdentico, textoSemMarcas } from "@/lib/marcas-de-fala";
import { blocosFalados, falaDoRoteiro, marcarBloco, marcarFalaDoRoteiro, marcasParaATela, marcasValidas, motivoDeNaoMarcar } from "@/servicos/marcar-fala";
import { editarRoteiro, ErroRoteiro, roteiroPorId } from "@/servicos/roteiro";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

// Um espião na leitura do roteiro: um teste simula "outra marcação gravou logo depois da minha leitura".
vi.mock("@/servicos/roteiro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/servicos/roteiro")>();
  return { ...original, roteiroPorId: vi.fn(original.roteiroPorId) };
});

// O `editarRoteiro` enfileira a aprendizagem; aqui só interessa a coluna, então a fila é um espião.
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return { ...original, garantirBossPronto: vi.fn(async () => undefined), boss: vi.fn(() => ({ send: vi.fn(async () => null) })) };
});

let clienteId: number;
let outraMarcaId: number;

function conteudo(extra: Partial<ConteudoRoteiro> = {}): ConteudoRoteiro {
  return {
    titulo: "A mancha que voltou",
    duracaoS: 30,
    gancho: "A mancha voltou depois da limpeza e ninguém te conta o porquê.",
    corpo: "Quase sempre sobra produto fundo no tecido. Passe água morna e depois o tira-mancha, sem esfregar.",
    fechamento: "Em dois minutos o banco fica limpo de novo.",
    chamadaFinal: "Chame no WhatsApp e peça o kit por R$ 89.",
    cartoes: null,
    porQueAssim: [],
    cenas: [{ momento: "0 a 3 s", oQueFazer: "mostrar o banco do carro" }],
    ondeGravar: "no seu carro",
    edicao: { textoNaTela: [], ritmoDeCorte: "rápido", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    ...extra,
  };
}

async function criarRoteiro(opcoes: { clienteId?: number; formato?: "reels" | "story"; estilo?: "falado" | "sem_fala"; conteudo?: ConteudoRoteiro } = {}): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({
      clienteId: opcoes.clienteId ?? clienteId,
      data: "2026-10-10",
      tema: "a mancha que volta",
      origem: "livre",
      objetivo: "conversao",
      formato: opcoes.formato ?? "reels",
      estilo: opcoes.estilo ?? "falado",
      conteudo: opcoes.conteudo ?? conteudo(),
    })
    .returning({ id: roteiros.id });
  return linha.id;
}

async function marcasGuardadas(roteiroId: number): Promise<MarcasDeFala | null> {
  const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, roteiroId));
  return linha.marcas;
}

async function chamadasDeMarcarFala(): Promise<number> {
  const linhas = await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.tarefa, "marcarFala"));
  return linhas.length;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "marcar-fala", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  await db().insert(user).values([
    { id: "mf-usuario", name: "Marca", email: "mf@exemplo.teste" },
    { id: "mf-outro", name: "Outra", email: "mf-outro@exemplo.teste" },
  ]);
  const [marca] = await db().insert(clientes).values({ usuarioId: "mf-usuario", nome: "Marca", nichoId: nicho.id }).returning();
  const [outra] = await db().insert(clientes).values({ usuarioId: "mf-outro", nome: "Outra", nichoId: nicho.id }).returning();
  clienteId = marca.id;
  outraMarcaId = outra.id;
  const perfil = (clienteIdeal: string) => ({
    fatos: { oQueVende: "kit tira-mancha", preco: "89 reais", clienteIdeal, medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
    resumo: "produtos de limpeza",
    referencias: [],
  });
  await db().insert(briefings).values([
    { clienteId, completo: true, perfil: perfil("mora em apartamento e tem 35 anos") },
    { clienteId: outraMarcaId, completo: true, perfil: perfil("idosos que moram sozinhos") },
  ]);
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, "marcarFala"));
  vi.mocked(cliente.gerarEstruturado).mockClear();
  vi.mocked(roteiroPorId).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("marcar a fala de um roteiro", () => {
  it("escreve as marcas dos quatro blocos, sem mudar uma letra, e guarda no roteiro", async () => {
    const id = await criarRoteiro();
    const r = await marcarFalaDoRoteiro(clienteId, id);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.novas).toBe(true);
    expect(r.marcas.blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "fechamento", "chamadaFinal"]);
    const original = conteudo();
    for (const b of r.marcas.blocos) {
      // A trava: o texto sem as marcas é o texto do roteiro, palavra por palavra.
      expect(textoSemMarcas(b.marcado)).toBe(normalizar(original[b.bloco]));
      expect(textoIdentico(original[b.bloco], b.marcado)).toBe(true);
    }
    expect(r.marcas.blocos.map((b) => b.tom)).toEqual(["direto", "perto", "calmo", "firme"]);
    expect(r.marcas.semModelo).toEqual([]);

    // Guardado, e igual ao que voltou.
    const guardado = await marcasGuardadas(id);
    expect(guardado).toEqual(JSON.parse(JSON.stringify(r.marcas)));
    // Uma chamada de IA, registrada.
    expect(vi.mocked(cliente.gerarEstruturado)).toHaveBeenCalledTimes(1);
    expect(await chamadasDeMarcarFala()).toBe(1);
  });

  it("as regras que conferem por código foram aplicadas: pausa no fim de cada frase, número devagar, chamada final devagar e descendo", async () => {
    const id = await criarRoteiro();
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    const gancho = r.marcas.blocos[0].marcado;
    expect(gancho.endsWith("{//}")).toBe(true);
    const chamada = r.marcas.blocos[3].marcado;
    expect(chamada).toContain("{d:");
    expect(chamada).toContain("R$ 89");
    expect(chamada).toMatch(/\{v\}\{\/\/\}$/);
    expect(r.marcas.correcoes.length).toBeGreaterThan(0);
  });

  it("com marcas válidas guardadas não chama a IA de novo", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    vi.mocked(cliente.gerarEstruturado).mockClear();

    const segunda = await marcarFalaDoRoteiro(clienteId, id);
    expect(segunda.ok && segunda.novas).toBe(false);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    expect(await chamadasDeMarcarFala()).toBe(1);
  });

  it("dois pedidos ao mesmo tempo esperam a mesma chamada", async () => {
    const id = await criarRoteiro();
    // A IA espera um portão: assim o segundo pedido chega com o primeiro ainda no meio da chamada, sem depender da velocidade do banco.
    const real = (await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente")).gerarEstruturado;
    let liberar!: () => void;
    const portao = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (parametros) => {
      await portao;
      return real(parametros);
    });

    const primeiro = marcarFalaDoRoteiro(clienteId, id);
    const segundo = marcarFalaDoRoteiro(clienteId, id);
    await vi.waitFor(() => expect(vi.mocked(cliente.gerarEstruturado).mock.calls.length).toBeGreaterThanOrEqual(1));
    // Tempo para o segundo pedido ler o roteiro e chegar ao mesmo ponto (sem o mapa em andamento, ele chamaria a IA também).
    await new Promise((resolver) => setTimeout(resolver, 150));
    liberar();

    const [a, b] = await Promise.all([primeiro, segundo]);
    expect(a.ok && b.ok).toBe(true);
    expect(vi.mocked(cliente.gerarEstruturado)).toHaveBeenCalledTimes(1);
    expect(await chamadasDeMarcarFala()).toBe(1);
    // Os dois recebem as mesmas marcas.
    expect(a.ok && b.ok && a.marcas).toEqual(b.ok && b.marcas);
  });

  it("quem editou o texto no meio da marcação não herda o resultado do texto antigo: pede o seu", async () => {
    const id = await criarRoteiro();
    const real = (await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente")).gerarEstruturado;
    let liberar!: () => void;
    const portao = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (parametros) => {
      await portao;
      return real(parametros);
    });

    const antigo = marcarFalaDoRoteiro(clienteId, id);
    await vi.waitFor(() => expect(vi.mocked(cliente.gerarEstruturado).mock.calls.length).toBeGreaterThanOrEqual(1));
    // O texto muda enquanto o primeiro pedido espera na IA; o segundo pedido é do texto novo.
    await db().update(roteiros).set({ conteudo: conteudo({ gancho: "Um começo novo, escrito agora." }), editadoEm: new Date() }).where(eq(roteiros.id, id));
    const novo = marcarFalaDoRoteiro(clienteId, id);
    const resultadoNovo = await novo;
    liberar();
    const resultadoAntigo = await antigo;

    expect(resultadoNovo.ok).toBe(true);
    if (resultadoNovo.ok) expect(textoSemMarcas(resultadoNovo.marcas.blocos[0].marcado)).toBe("Um começo novo, escrito agora.");
    // O pedido do texto antigo termina como "editado no meio": o texto de agora já tem as suas marcas.
    expect(resultadoAntigo).toEqual({ ok: false, motivo: "editado_no_meio" });
    expect(vi.mocked(cliente.gerarEstruturado)).toHaveBeenCalledTimes(2);
  });

  it("Story e vídeo sem fala não têm fala para marcar, e nada é chamado nem guardado", async () => {
    const story = await criarRoteiro({ formato: "story" });
    const semFala = await criarRoteiro({ estilo: "sem_fala" });
    expect(await marcarFalaDoRoteiro(clienteId, story)).toEqual({ ok: false, motivo: "story" });
    expect(await marcarFalaDoRoteiro(clienteId, semFala)).toEqual({ ok: false, motivo: "sem_fala" });
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    expect(await marcasGuardadas(story)).toBeNull();
    expect(await marcasGuardadas(semFala)).toBeNull();
  });

  it("um texto com chave (a sintaxe das marcas) não é marcado", async () => {
    const id = await criarRoteiro({ conteudo: conteudo({ gancho: "Isso custa {p:caro} mesmo." }) });
    expect(await marcarFalaDoRoteiro(clienteId, id)).toEqual({ ok: false, motivo: "chave_no_texto" });
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("o roteiro de outra marca é 'não achei', e o dono dele não é afetado", async () => {
    const id = await criarRoteiro();
    await expect(marcarFalaDoRoteiro(outraMarcaId, id)).rejects.toThrow(textosMarcasDeFala.erros.naoEncontrado);
    await expect(marcarFalaDoRoteiro(outraMarcaId, id)).rejects.toBeInstanceOf(ErroRoteiro);
    expect(await marcasGuardadas(id)).toBeNull();
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("o aviso da muleta de abertura vira texto de apoio, e o texto não muda", async () => {
    const id = await criarRoteiro({ conteudo: conteudo({ gancho: "Então, a mancha voltou depois da limpeza e ninguém te conta o porquê." }) });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    expect(r.marcas.avisos).toEqual([{ regra: "R-FALA-01", texto: textosMarcasDeFala.avisos.muleta("Então") }]);
    expect(textoSemMarcas(r.marcas.blocos[0].marcado)).toBe("Então, a mancha voltou depois da limpeza e ninguém te conta o porquê.");
  });

  it("o ambiente com barulho e o público mais velho viram aviso", async () => {
    const cenas = [{ momento: "0 a 3 s", oQueFazer: "mostrar a oficina com as máquinas ligadas" }];
    const id = await criarRoteiro({ clienteId: outraMarcaId, conteudo: conteudo({ cenas }) });
    const r = await marcarFalaDoRoteiro(outraMarcaId, id);
    if (!r.ok) throw new Error("devia marcar");
    expect(r.marcas.avisos.map((a) => a.regra)).toEqual(["R-FALA-14", "R-FALA-15"]);
    expect(r.marcas.avisos[0].texto).toBe(textosMarcasDeFala.avisos.barulho);
  });

  it("o parágrafo do corpo continua um parágrafo", async () => {
    const corpo = "Primeiro, tire o excesso com um pano seco, sem esfregar.\nDepois passe o produto e espere um minuto.";
    const id = await criarRoteiro({ conteudo: conteudo({ corpo }) });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    const marcado = r.marcas.blocos[1].marcado;
    expect(marcado.split("\n")).toHaveLength(2);
    expect(textoIdentico(corpo, marcado)).toBe(true);
  });
});

describe("o modelo desobediente: a trava segura", () => {
  it("o bloco que o modelo muda nas duas tentativas fica só com as marcas do código, com o texto intacto", async () => {
    const gancho = "A mancha voltou ZZESTRAGA depois da limpeza.";
    const id = await criarRoteiro({ conteudo: conteudo({ gancho }) });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");

    expect(r.marcas.semModelo).toEqual(["gancho"]);
    const g = r.marcas.blocos[0];
    expect(textoSemMarcas(g.marcado)).toBe(gancho);
    expect(g.marcado.endsWith("{//}")).toBe(true);
    // Não sobrou peso do modelo (ele foi descartado com o texto), mas o do código é só pausa.
    expect(g.marcado).not.toContain("{p:");
    // Duas tentativas: a segunda só com o bloco que falhou, com o aviso.
    const chamadas = vi.mocked(cliente.gerarEstruturado).mock.calls;
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1][0].entrada).toContain("ATENÇÃO");
    expect(chamadas[1][0].entrada).toContain("### gancho");
    expect(chamadas[1][0].entrada).not.toContain("### corpo");
    expect(await chamadasDeMarcarFala()).toBe(2);
    // Os outros blocos ficaram com o modelo.
    expect(r.marcas.blocos.slice(1).every((b) => textoIdentico(conteudo()[b.bloco], b.marcado))).toBe(true);
  });

  it("o bloco que o modelo muda só na primeira tentativa sai certo na segunda", async () => {
    const id = await criarRoteiro({ conteudo: conteudo({ gancho: "A mancha voltou ZZUMAVEZ depois da limpeza." }) });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    expect(r.marcas.semModelo).toEqual([]);
    expect(r.marcas.blocos[0].marcado).toContain("{p:");
    expect(vi.mocked(cliente.gerarEstruturado)).toHaveBeenCalledTimes(2);
  });

  it("o erro da IA sobe e nada é guardado, para a pessoa tentar de novo", async () => {
    const id = await criarRoteiro();
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async () => {
      throw new ErroIA("erro da API (402): saldo insuficiente.");
    });
    await expect(marcarFalaDoRoteiro(clienteId, id)).rejects.toBeInstanceOf(ErroIA);
    expect(await marcasGuardadas(id)).toBeNull();
    // A tentativa seguinte funciona.
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r.ok).toBe(true);
  });

  it("o texto falado editado enquanto o modelo escrevia não recebe marca velha", async () => {
    const id = await criarRoteiro();
    const real = (await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente")).gerarEstruturado;
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (parametros) => {
      await db().update(roteiros).set({ conteudo: conteudo({ gancho: "Outro começo, escrito agora." }), editadoEm: new Date() }).where(eq(roteiros.id, id));
      return real(parametros);
    });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r).toEqual({ ok: false, motivo: "editado_no_meio" });
    expect(await marcasGuardadas(id)).toBeNull();
  });

  it("a legenda editada enquanto o modelo escrevia não derruba a marcação (o texto falado é o mesmo)", async () => {
    const id = await criarRoteiro();
    const real = (await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente")).gerarEstruturado;
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (parametros) => {
      await db()
        .update(roteiros)
        .set({ conteudo: conteudo({ legenda: "uma legenda nova" }), editadoEm: new Date() })
        .where(eq(roteiros.id, id));
      return real(parametros);
    });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r.ok).toBe(true);
    expect(await marcasGuardadas(id)).not.toBeNull();
  });

  it("a segunda tentativa que falha não joga fora o que a primeira já pagou", async () => {
    const id = await criarRoteiro({ conteudo: conteudo({ gancho: "A mancha voltou ZZESTRAGA depois da limpeza." }) });
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (parametros) => {
      const real = (await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente")).gerarEstruturado;
      return real(parametros);
    });
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async () => {
      throw new ErroIA("erro da API (429): limite.");
    });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    expect(r.marcas.semModelo).toEqual(["gancho"]);
    // Os outros três blocos ficaram com o que o modelo devolveu na primeira chamada.
    expect(r.marcas.blocos.slice(1).every((b) => b.marcado.includes("{p:"))).toBe(true);
    expect(await chamadasDeMarcarFala()).toBe(1);
    expect(await marcasGuardadas(id)).not.toBeNull();
  });

  it("quem leu antes da marcação anterior gravar encontra as marcas prontas e não paga outra chamada", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    const prontas = await marcasGuardadas(id);
    await db().update(roteiros).set({ marcasDeFala: null }).where(eq(roteiros.id, id));
    vi.mocked(cliente.gerarEstruturado).mockClear();

    // A primeira leitura vê o roteiro sem marcas; logo depois, "outra marcação" grava as marcas.
    const real = (await vi.importActual<typeof import("@/servicos/roteiro")>("@/servicos/roteiro")).roteiroPorId;
    vi.mocked(roteiroPorId).mockImplementationOnce(async (roteiroId, dono) => {
      const linha = await real(roteiroId, dono);
      await db().update(roteiros).set({ marcasDeFala: prontas }).where(eq(roteiros.id, id));
      return linha;
    });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r.ok && r.novas).toBe(false);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("o teto do dia recusa antes de gastar uma chamada", async () => {
    const id = await criarRoteiro();
    const teto = config.regras.roteirosPorDiaMax * 4;
    await db()
      .insert(geracoesIA)
      .values(Array.from({ length: teto }, () => ({ tarefa: "marcarFala", versaoPrompt: "1.0.0", modelo: "mock", clienteId, entradas: {} })));
    await expect(marcarFalaDoRoteiro(clienteId, id)).rejects.toThrow(textosMarcasDeFala.erros.limiteDoDia);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    // De outra marca não conta.
    const outro = await criarRoteiro({ clienteId: outraMarcaId });
    expect((await marcarFalaDoRoteiro(outraMarcaId, outro)).ok).toBe(true);
  });
});

describe("editar o texto apaga as marcas", () => {
  it("editar um bloco falado apaga; editar só a legenda não", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    expect(await marcasGuardadas(id)).not.toBeNull();

    await editarRoteiro(id, { legenda: "uma legenda nova" });
    expect(await marcasGuardadas(id)).not.toBeNull();

    await editarRoteiro(id, { gancho: "A mancha voltou e agora eu explico o porquê." });
    expect(await marcasGuardadas(id)).toBeNull();

    // Ligar de novo escreve as marcas do texto novo.
    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    expect(r.novas).toBe(true);
    expect(textoSemMarcas(r.marcas.blocos[0].marcado)).toBe("A mancha voltou e agora eu explico o porquê.");
  });

  it("editar só a quebra de linha também apaga: as marcas guardam a quebra do texto de que saíram", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    expect(await marcasGuardadas(id)).not.toBeNull();
    await editarRoteiro(id, { corpo: conteudo().corpo.replace(". Passe", ".\nPasse") });
    expect(await marcasGuardadas(id)).toBeNull();
  });

  it("marca velha sobre texto novo (uma edição que não passou por editarRoteiro) não vale e é refeita", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    // Alguém mexe no texto direto no banco: as marcas guardadas ficam velhas.
    const novo = conteudo({ chamadaFinal: "Chame no WhatsApp e peça o kit por R$ 99." });
    await db().update(roteiros).set({ conteudo: novo }).where(and(eq(roteiros.id, id)));
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(marcasValidas(linha.marcasDeFala, linha.conteudo)).toBeNull();

    const r = await marcarFalaDoRoteiro(clienteId, id);
    if (!r.ok) throw new Error("devia marcar");
    expect(r.novas).toBe(true);
    expect(textoSemMarcas(r.marcas.blocos[3].marcado)).toContain("R$ 99");
  });
});

describe("o que a tela recebe (E41 2b)", () => {
  async function linhaDoRoteiro(id: number) {
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    return linha;
  }

  it("sem marcas: pode marcar e não tem marcas; só olhar vale no 'ver como'", async () => {
    const id = await criarRoteiro();
    const fala = falaDoRoteiro(await linhaDoRoteiro(id), false);
    expect(fala).toEqual({ podeMarcar: true, somenteLeitura: false, marcas: null });
    expect(falaDoRoteiro(await linhaDoRoteiro(id), true).somenteLeitura).toBe(true);
  });

  it("com marcas válidas: manda só os blocos marcados, o tom e os avisos (nunca o registro do conserto)", async () => {
    const id = await criarRoteiro({ conteudo: conteudo({ gancho: "Então, a mancha voltou depois da limpeza e ninguém te conta o porquê." }) });
    await marcarFalaDoRoteiro(clienteId, id);
    const fala = falaDoRoteiro(await linhaDoRoteiro(id), false);
    expect(fala.podeMarcar).toBe(true);
    expect(fala.marcas?.blocos.map((b) => Object.keys(b).sort())).toEqual([
      ["bloco", "marcado", "tom"],
      ["bloco", "marcado", "tom"],
      ["bloco", "marcado", "tom"],
      ["bloco", "marcado", "tom"],
    ]);
    expect(Object.keys(fala.marcas ?? {}).sort()).toEqual(["avisos", "blocos"]);
    expect(fala.marcas?.avisos.map((a) => a.regra)).toEqual(["R-FALA-01"]);
    expect(JSON.stringify(fala)).not.toContain("correcoes");
    expect(JSON.stringify(fala)).not.toContain("semModelo");
  });

  it("marcas velhas (o texto mudou por outro caminho) não chegam à tela", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    await db().update(roteiros).set({ conteudo: conteudo({ gancho: "Outro começo." }) }).where(eq(roteiros.id, id));
    const fala = falaDoRoteiro(await linhaDoRoteiro(id), false);
    expect(fala.podeMarcar).toBe(true);
    expect(fala.marcas).toBeNull();
  });

  it("Story e vídeo sem fala não têm o que marcar, e as marcas guardadas nunca chegam", async () => {
    const story = await criarRoteiro({ formato: "story" });
    expect(falaDoRoteiro(await linhaDoRoteiro(story), false)).toEqual({ podeMarcar: false, somenteLeitura: false, marcas: null });
    const semFala = await criarRoteiro({ estilo: "sem_fala" });
    expect(falaDoRoteiro(await linhaDoRoteiro(semFala), false).podeMarcar).toBe(false);
  });

  it("marcasParaATela de nulo é nulo", () => {
    expect(marcasParaATela(null)).toBeNull();
  });
});

describe("o PDF e a imagem com as marcas (E41 2c)", () => {
  async function linhaDoRoteiro(id: number) {
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    return linha;
  }
  async function marcaDoTeste() {
    const [c] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    return c;
  }
  const pedido = (marcas: boolean, cabecalhos: Record<string, string> = {}) =>
    new Request(`http://localhost/api/roteiros/1/pdf${marcas ? "?marcas=1" : ""}`, { headers: cabecalhos });
  const COM = { comMarcas: true, naoDeu: false };
  const SEM = { comMarcas: false, naoDeu: false };
  const NAO_DEU = { comMarcas: false, naoDeu: true };

  it("sem ?marcas=1 não faz nada: nenhuma marca é escrita nem pedida", async () => {
    const id = await criarRoteiro();
    expect(await pedidoComMarcas(pedido(false), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(SEM);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    expect(await marcasGuardadas(id)).toBeNull();
  });

  it("com ?marcas=1 e sem marcas, escreve na hora (uma chamada) e diz que a folha vai com elas", async () => {
    const id = await criarRoteiro();
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(COM);
    expect(vi.mocked(cliente.gerarEstruturado)).toHaveBeenCalledTimes(1);
    expect(await marcasGuardadas(id)).not.toBeNull();
  });

  it("com as marcas já guardadas, não chama a IA de novo", async () => {
    const id = await criarRoteiro();
    await marcarFalaDoRoteiro(clienteId, id);
    vi.mocked(cliente.gerarEstruturado).mockClear();
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(COM);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("no 'ver como' nada é escrito: sem marcas prontas o arquivo sai como sempre (e diz que não deu); com elas, vai com elas", async () => {
    const id = await criarRoteiro();
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), true)).toEqual(NAO_DEU);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    expect(await marcasGuardadas(id)).toBeNull();
    await marcarFalaDoRoteiro(clienteId, id);
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), true)).toEqual(COM);
  });

  it("Story e vídeo sem fala saem sem marcas, sem chamar a IA e sem aviso (não havia o que marcar)", async () => {
    const story = await criarRoteiro({ formato: "story" });
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(story), await marcaDoTeste(), false)).toEqual(SEM);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("o PDF SEMPRE sai: a IA que cai vira 'não deu', sem erro", async () => {
    const id = await criarRoteiro();
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async () => {
      throw new ErroIA("erro da API (429): limite.");
    });
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(NAO_DEU);
    expect(await marcasGuardadas(id)).toBeNull();
  });

  it("o teto do dia também vira 'não deu', sem gastar a chamada", async () => {
    const id = await criarRoteiro();
    const teto = config.regras.roteirosPorDiaMax * 4;
    await db()
      .insert(geracoesIA)
      .values(Array.from({ length: teto }, () => ({ tarefa: "marcarFala", versaoPrompt: "1.0.0", modelo: "mock", clienteId, entradas: {} })));
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(NAO_DEU);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("um erro que não é da marcação continua subindo (não se esconde bug de verdade)", async () => {
    const id = await criarRoteiro();
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async () => {
      throw new TypeError("bug de verdade");
    });
    await expect(pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), false)).rejects.toBeInstanceOf(TypeError);
  });

  it("uma navegação que veio de outro site não escreve marcas: lê as que existem, e só (e diz que não deu)", async () => {
    const id = await criarRoteiro();
    const deOutroSite = pedido(true, { "sec-fetch-site": "cross-site" });
    expect(await pedidoComMarcas(deOutroSite, await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(NAO_DEU);
    expect(vi.mocked(cliente.gerarEstruturado)).not.toHaveBeenCalled();
    expect(await marcasGuardadas(id)).toBeNull();
    // A tela da própria pessoa (mesma origem) escreve; com as marcas já guardadas, a navegação de fora também vai com elas.
    expect(await pedidoComMarcas(pedido(true, { "sec-fetch-site": "same-origin" }), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(COM);
    expect(await pedidoComMarcas(deOutroSite, await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(COM);
  });

  it("se o texto mudou no meio da marcação, tenta de novo com o texto de agora em vez de sair sem as marcas", async () => {
    const id = await criarRoteiro();
    const real = (await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente")).gerarEstruturado;
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (parametros) => {
      await db().update(roteiros).set({ conteudo: conteudo({ gancho: "Um começo novo, escrito no meio." }), editadoEm: new Date() }).where(eq(roteiros.id, id));
      return real(parametros);
    });
    expect(await pedidoComMarcas(pedido(true), await linhaDoRoteiro(id), await marcaDoTeste(), false)).toEqual(COM);
    const guardadas = await marcasGuardadas(id);
    expect(textoSemMarcas(guardadas!.blocos[0].marcado)).toBe("Um começo novo, escrito no meio.");
  });

  it("o endereço de impressão leva ?marcas=1 só quando a folha vai com as marcas", async () => {
    const id = await criarRoteiro();
    const linha = await linhaDoRoteiro(id);
    const c = await marcaDoTeste();
    expect(urlDeImpressao(linha, c, "a4")).not.toContain("marcas=1");
    expect(urlDeImpressao(linha, c, "celular", false)).not.toContain("marcas=1");
    expect(urlDeImpressao(linha, c, "a4", true)).toContain("&marcas=1");
    expect(urlDeImpressao(linha, c, "celular", true)).toContain("formato=celular&marcas=1");
  });
});

describe("as peças do serviço", () => {
  it("blocosFalados tira os blocos vazios e motivoDeNaoMarcar decide o que não se marca", () => {
    expect(blocosFalados(conteudo({ fechamento: "   " })).map((b) => b.bloco)).toEqual(["gancho", "corpo", "chamadaFinal"]);
    expect(motivoDeNaoMarcar({ formato: "reels", estilo: "falado", conteudo: conteudo() })).toBeNull();
    expect(motivoDeNaoMarcar({ formato: "story", estilo: "falado", conteudo: conteudo() })).toBe("story");
    expect(motivoDeNaoMarcar({ formato: "reels", estilo: "sem_fala", conteudo: conteudo() })).toBe("sem_fala");
    expect(motivoDeNaoMarcar({ formato: "reels", estilo: "falado", conteudo: conteudo({ gancho: "", corpo: "", fechamento: "", chamadaFinal: "" }) })).toBe("sem_texto");
  });

  it("marcarBloco descarta o texto do modelo que mudou e nunca devolve um texto diferente do original", () => {
    const original = "A mancha voltou depois da limpeza.";
    const bom = marcarBloco(original, "A {p:mancha} voltou depois da {p:limpeza}.", { chamadaFinal: false, maisDevagar: false });
    expect(bom.usouModelo).toBe(true);
    expect(bom.marcado).toBe("A {p:mancha} voltou depois da limpeza.{//}");
    // Duas palavras de peso numa frase curta: a segunda é tirada pela R-FALA-05.
    expect(bom.correcoes).toEqual(['R-FALA-05: peso tirado de "limpeza."', 'R-FALA-03: pausa longa no fim da frase "...limpeza."']);

    const ruim = marcarBloco(original, "A {p:nódoa} voltou depois da limpeza.", { chamadaFinal: false, maisDevagar: false });
    expect(ruim.usouModelo).toBe(false);
    expect(textoSemMarcas(ruim.marcado)).toBe(original);
    expect(ruim.marcado).not.toContain("nódoa");

    const nulo = marcarBloco(original, null, { chamadaFinal: true, maisDevagar: false });
    expect(nulo.usouModelo).toBe(false);
    expect(textoSemMarcas(nulo.marcado)).toBe(original);
    expect(nulo.marcado).toMatch(/\{v\}\{\/\/\}$/);
  });
});
