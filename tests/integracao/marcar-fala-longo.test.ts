/**
 * A marcação de fala do roteiro do vídeo longo (E52, PR 5), contra o Postgres real e com o simulador de IA: só se marca o que a pessoa diz COMO ESTÁ ESCRITO (o gancho do vídeo, a frase de cada
 * capítulo que segura até o próximo e a chamada final); os pontos de cada capítulo (direção, não fala) nunca são tocados; a trava vale (o texto sem as marcas é idêntico ao original);
 * editar uma frase apaga as marcas e editar só os pontos não.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, roteiros, user, type CapituloDoRoteiro, type ConteudoRoteiro, type MarcasDeFala } from "@/db/schema";
import * as cliente from "@/ia/cliente";
import { camposCorridosDosCapitulos } from "@/lib/capitulos-do-roteiro";
import { blocosFaladosDoConteudo, ganchosDosCapitulos, normalizar, textoIdentico, textoSemMarcas } from "@/lib/marcas-de-fala";
import { falaDoRoteiro, marcarFalaDoRoteiro, motivoDeNaoMarcar } from "@/servicos/marcar-fala";
import { editarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return { ...original, garantirBossPronto: vi.fn(async () => undefined), boss: vi.fn(() => ({ send: vi.fn(async () => null) })) };
});

let clienteId: number;

const CAPITULOS: CapituloDoRoteiro[] = [
  { nome: "A mancha que volta", inicioS: 0, duracaoS: 60, tom: "direto", pontos: ["Mostre o sofá com a mancha de volta", "Conte o que você fez da primeira vez"], naImagem: "o sofá com a mancha", ganchoParaOProximo: "Fica até o fim que eu te mostro os três erros.", comoEditar: "Corte a cada 5 segundos" },
  { nome: "Erro 1: esfregar antes do tempo", inicioS: 60, duracaoS: 90, tom: "calmo", pontos: ["Aplique e mostre o relógio", "Explique que esfregar espalha a sujeira"], naImagem: "o relógio na parede", ganchoParaOProximo: "E o erro 2 é o que quase todo mundo comete com o melhor produto.", comoEditar: "Acelere a espera" },
  { nome: "Erro 2: produto demais", inicioS: 150, duracaoS: 90, tom: "calmo", pontos: ["Mostre a quantidade certa na tampa", "Compare com a que as pessoas usam"], naImagem: "duas tampas lado a lado", ganchoParaOProximo: "O terceiro erro acontece depois que a mancha já saiu.", comoEditar: "Nenhum efeito" },
  { nome: "O que fazer amanhã", inicioS: 240, duracaoS: 60, tom: "firme", pontos: ["Resuma os erros em uma frase cada", "Peça a mensagem com a foto da mancha"], naImagem: "você olhando para a câmera", ganchoParaOProximo: null, comoEditar: "Termine olhando para a câmera" },
];

function conteudoLongo(extra: Partial<ConteudoRoteiro> = {}): ConteudoRoteiro {
  const corridos = camposCorridosDosCapitulos(CAPITULOS);
  return {
    titulo: "Os erros que fazem a mancha voltar",
    duracaoS: 300,
    gancho: "Se a mancha volta dois dias depois, o problema não é o produto.",
    corpo: corridos.corpo,
    fechamento: corridos.fechamento,
    chamadaFinal: "Me manda a foto da sua mancha que eu digo o que usar por R$ 89.",
    cartoes: null,
    porQueAssim: [],
    cenas: corridos.cenas,
    ondeGravar: "na sala de casa",
    edicao: { textoNaTela: [], ritmoDeCorte: "mais calmo", recursos: [], audio: null, referencia: null },
    evidencias: [],
    semEvidencia: true,
    forcaEvidencia: null,
    capitulos: CAPITULOS,
    miniatura: "o sofá com a mancha",
    ...extra,
  };
}

async function criarLongo(c: ConteudoRoteiro = conteudoLongo()): Promise<number> {
  const [linha] = await db()
    .insert(roteiros)
    .values({ clienteId, data: "2026-10-14", tema: "a mancha que volta", origem: "livre", objetivo: "alcance", duracaoDoVideo: "longo", conteudo: c })
    .returning({ id: roteiros.id });
  return linha.id;
}

async function marcasGuardadas(id: number): Promise<MarcasDeFala | null> {
  const [linha] = await db().select({ marcas: roteiros.marcasDeFala }).from(roteiros).where(eq(roteiros.id, id));
  return linha.marcas;
}

async function chamadas(): Promise<number> {
  return (await db().select({ id: geracoesIA.id }).from(geracoesIA).where(eq(geracoesIA.tarefa, "marcarFala"))).length;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "marcar-fala-longo", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  await db().insert(user).values({ id: "mfl-usuario", name: "Marca", email: "mfl@exemplo.teste" });
  const [marca] = await db().insert(clientes).values({ usuarioId: "mfl-usuario", nome: "Marca", nichoId: nicho.id }).returning();
  clienteId = marca.id;
  await db()
    .insert(briefings)
    .values({
      clienteId,
      completo: true,
      perfil: {
        fatos: { oQueVende: "kit tira-mancha", preco: "89 reais", clienteIdeal: "mora em apartamento e tem 35 anos", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "produtos de limpeza",
        referencias: [],
      } as never,
    });
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA).where(eq(geracoesIA.tarefa, "marcarFala"));
  vi.mocked(cliente.gerarEstruturado).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("o que se marca no roteiro longo", () => {
  it("os blocos são o gancho do vídeo, as frases dos capítulos (uma por parágrafo, o último capítulo não tem) e a chamada final; os pontos nunca entram", () => {
    const c = conteudoLongo();
    expect(ganchosDosCapitulos(c).map((g) => g.indice)).toEqual([0, 1, 2]);
    const blocos = blocosFaladosDoConteudo(c);
    expect(blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "chamadaFinal"]);
    expect(blocos[1].texto.split(String.fromCharCode(10))).toEqual(CAPITULOS.slice(0, 3).map((x) => x.ganchoParaOProximo));
    for (const ponto of CAPITULOS.flatMap((x) => x.pontos)) expect(blocos.some((b) => b.texto.includes(ponto))).toBe(false);
  });

  it("um roteiro curto continua com os quatro blocos de sempre", () => {
    const curto = { ...conteudoLongo(), capitulos: null, corpo: "meio do vídeo", fechamento: "fecho" };
    expect(blocosFaladosDoConteudo(curto).map((b) => b.bloco)).toEqual(["gancho", "corpo", "fechamento", "chamadaFinal"]);
  });

  it("o roteiro longo tem fala para marcar; sem nenhuma frase falada, não", async () => {
    const id = await criarLongo();
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(motivoDeNaoMarcar(linha)).toBeNull();
    expect(falaDoRoteiro(linha, false).podeMarcar).toBe(true);
    const vazio = conteudoLongo({ gancho: "", chamadaFinal: "", capitulos: CAPITULOS.map((c) => ({ ...c, ganchoParaOProximo: null })) });
    expect(motivoDeNaoMarcar({ formato: "reels", estilo: "falado", conteudo: vazio })).toBe("sem_texto");
  });

  it("uma chave na frase de um capítulo (a sintaxe das marcas) não se marca", () => {
    const c = conteudoLongo({ capitulos: CAPITULOS.map((x, i) => (i === 1 ? { ...x, ganchoParaOProximo: "E o erro {2} é pior." } : x)) });
    expect(motivoDeNaoMarcar({ formato: "reels", estilo: "falado", conteudo: c })).toBe("chave_no_texto");
  });
});

describe("marcar a fala do roteiro longo", () => {
  it("escreve as marcas dos três blocos sem mudar uma letra e guarda; os capítulos ficam como estavam", async () => {
    const id = await criarLongo();
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.novas).toBe(true);
    expect(r.marcas.blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "chamadaFinal"]);
    const original = blocosFaladosDoConteudo(conteudoLongo());
    for (const b of r.marcas.blocos) {
      const texto = original.find((o) => o.bloco === b.bloco)!.texto;
      // A trava: o texto sem as marcas é o texto do roteiro, palavra por palavra.
      expect(textoSemMarcas(b.marcado)).toBe(normalizar(texto));
      expect(textoIdentico(texto, b.marcado)).toBe(true);
    }
    // um parágrafo por capítulo que tem a frase, na ordem
    const corpo = r.marcas.blocos.find((b) => b.bloco === "corpo")!;
    expect(corpo.marcado.split(String.fromCharCode(10)).filter(Boolean)).toHaveLength(3);
    // guardado e igual ao que voltou
    expect((await marcasGuardadas(id))?.blocos.map((b) => b.bloco)).toEqual(["gancho", "corpo", "chamadaFinal"]);
    // os capítulos (e os pontos) não mudaram
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(linha.conteudo.capitulos).toEqual(CAPITULOS);
    expect(linha.conteudo.gancho).toBe(conteudoLongo().gancho);
  });

  it("a segunda chamada devolve as guardadas, sem chamar a IA de novo", async () => {
    const id = await criarLongo();
    await marcarFalaDoRoteiro(clienteId, id);
    const antes = await chamadas();
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r.ok && r.novas).toBe(false);
    expect(await chamadas()).toBe(antes);
  });

  it("o que a IA recebe é só a fala: nenhum ponto de nenhum capítulo vai na entrada", async () => {
    const id = await criarLongo();
    await marcarFalaDoRoteiro(clienteId, id);
    const entrada = String(vi.mocked(cliente.gerarEstruturado).mock.calls[0][0].entrada);
    expect(entrada).toContain("Fica até o fim que eu te mostro os três erros.");
    for (const ponto of CAPITULOS.flatMap((x) => x.pontos)) expect(entrada).not.toContain(ponto);
  });

  it("a tela recebe as marcas válidas; marca velha sobre texto novo não vale", async () => {
    const id = await criarLongo();
    await marcarFalaDoRoteiro(clienteId, id);
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(falaDoRoteiro(linha, false).marcas?.blocos).toHaveLength(3);
    // um conserto no banco que muda uma frase sem passar por `editarRoteiro`: as marcas deixam de valer
    const mexido = { ...linha, conteudo: { ...linha.conteudo, capitulos: linha.conteudo.capitulos!.map((c, i) => (i === 0 ? { ...c, ganchoParaOProximo: "Outra frase inteira." } : c)) } };
    expect(falaDoRoteiro(mexido, false).marcas).toBeNull();
  });
});

describe("editar um roteiro longo marcado", () => {
  it("editar os pontos de um capítulo não apaga as marcas (os pontos não são fala)", async () => {
    const id = await criarLongo();
    await marcarFalaDoRoteiro(clienteId, id);
    await editarRoteiro(id, { capitulo: { indice: 1, pontos: ["Um ponto novo", "Outro ponto novo"] } });
    expect(await marcasGuardadas(id)).not.toBeNull();
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
    expect(falaDoRoteiro(linha, false).marcas?.blocos).toHaveLength(3);
  });

  it("editar a frase que segura até o próximo apaga as marcas, e a edição pede as novas", async () => {
    const id = await criarLongo();
    await marcarFalaDoRoteiro(clienteId, id);
    await editarRoteiro(id, { capitulo: { indice: 1, ganchoParaOProximo: "E o erro seguinte pega até quem já sabe.", pontos: CAPITULOS[1].pontos } });
    expect(await marcasGuardadas(id)).toBeNull();
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r.ok && r.novas).toBe(true);
    if (r.ok) expect(r.marcas.blocos.find((b) => b.bloco === "corpo")!.marcado).toContain("seguinte");
  });

  it("editar o gancho do vídeo ou a chamada final também apaga", async () => {
    const id = await criarLongo();
    await marcarFalaDoRoteiro(clienteId, id);
    await editarRoteiro(id, { gancho: "Um gancho novo para o vídeo inteiro." });
    expect(await marcasGuardadas(id)).toBeNull();
    await marcarFalaDoRoteiro(clienteId, id);
    await editarRoteiro(id, { chamadaFinal: "Chama no direct agora." });
    expect(await marcasGuardadas(id)).toBeNull();
  });

  it("se a frase de um capítulo é editada enquanto a IA escreve, as marcas não são gravadas sobre o texto novo", async () => {
    const id = await criarLongo();
    const { gerarEstruturado } = await vi.importActual<typeof import("@/ia/cliente")>("@/ia/cliente");
    vi.mocked(cliente.gerarEstruturado).mockImplementationOnce(async (...args: Parameters<typeof gerarEstruturado>) => {
      await db()
        .update(roteiros)
        .set({ conteudo: conteudoLongo({ capitulos: CAPITULOS.map((c, i) => (i === 2 ? { ...c, ganchoParaOProximo: "Uma frase que mudou no meio da marcação." } : c)) }) })
        .where(eq(roteiros.id, id));
      return (gerarEstruturado as unknown as (...a: unknown[]) => Promise<never>)(...args);
    });
    const r = await marcarFalaDoRoteiro(clienteId, id);
    expect(r).toEqual({ ok: false, motivo: "editado_no_meio" });
    expect(await marcasGuardadas(id)).toBeNull();
  });
});
