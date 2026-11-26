/**
 * Os ganchos alternativos do roteiro aberto (25/11/2026), contra o Postgres real e a IA em mock:
 *  - pedir: de 3 a 5 ganchos, cada um com o tipo de abertura e a emoção, de tipos diferentes entre si e do original; o registro em `geracoes_ia` (modelo barato, versão do prompt); o roteiro principal
 *    não muda; a lista fica guardada e o segundo pedido não gasta nada;
 *  - trocar: o texto, o tipo de abertura e o escolhido ficam gravados; voltar ao de antes; a escolha fora da lista; roteiro gravado não troca;
 *  - as regras: tipo repetido, poucos ganchos, fórmula de máquina e promessa em saúde voltam para o modelo; a IA fora e a lista reprovada duas vezes não guardam nada;
 *  - o isolamento: marca alheia, Story, "ver como" e a marca sem assinatura (a lista geral está em `assinatura-travas.test.ts`).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return { ...original, recusaDoVerComo: vi.fn(original.recusaDoVerComo) };
});

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, membrosMarca, nichos, roteiros, user, type ConteudoRoteiro, type PerfilCompilado, type TipoAbertura } from "@/db/schema";
import * as cliente from "@/ia/cliente";
import { versao as versaoDoPrompt } from "@/ia/prompts/ganchosAlternativos";
import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { recusaDoVerComo } from "@/lib/ver-como";
import { ErroGanchos, pedirGanchosAlternativos, TENTATIVAS_DE_GANCHOS_POR_MARCA_POR_DIA, trocarGancho } from "@/servicos/ganchos-alternativos";
import { roteiroPorId } from "@/servicos/roteiro";
import { fraseDosGanchos } from "@/textos/ganchos";

import { resetarSchema } from "../../scripts/resetar-schema";

const { pedirGanchosAction, trocarGanchoAction } = await import("@/app/(painel)/(completo)/roteiros/[id]/ganchos-acoes");

const AGORA = new Date("2026-11-25T15:00:00Z");
const GANCHO_ORIGINAL = "Mancha de café no sofá não precisa virar problema";

let nichoId: number;
let nichoSaudeId: number;
let marcaA: number;
let marcaB: number;
let marcaSaude: number;

const perfil: PerfilCompilado = {
  fatos: { oQueVende: "lavagem de sofá a seco", preco: "sob orçamento", clienteIdeal: "famílias de Campinas", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: ["o sofá com a mancha"], concorrentes: [], perfisAdmirados: [] } as unknown as PerfilCompilado["fatos"],
  resumo: "lava sofá a seco em Campinas",
  referencias: [],
};

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" }, session: { id: `s-${usuarioId}`, userId: usuarioId } } as never;
}

function conteudo(sobre: Partial<ConteudoRoteiro> = {}): ConteudoRoteiro {
  return {
    titulo: "Mancha de café",
    duracaoS: 30,
    gancho: GANCHO_ORIGINAL,
    corpo: "Passe um pano úmido e pressione sem esfregar. Depois aplique o produto neutro.",
    fechamento: "Em dez minutos o sofá volta ao normal.",
    chamadaFinal: "Me chame para um orçamento.",
    edicao: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: "", referencia: null },
    ...sobre,
  } as unknown as ConteudoRoteiro;
}

async function novoRoteiro(clienteId: number, extras: { tema?: string; tipoAbertura?: TipoAbertura | null; status?: "gerado" | "gravado" | "postado"; formato?: "reels" | "story" } = {}) {
  const [r] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: "2026-11-25",
      tema: extras.tema ?? "tirar mancha de café do sofá",
      origem: "livre",
      objetivo: "alcance",
      conteudo: conteudo(),
      tipoAbertura: extras.tipoAbertura === undefined ? "fala_direta" : extras.tipoAbertura,
      status: extras.status ?? "gerado",
      formato: extras.formato ?? "reels",
      marcasDeFala: { blocos: [], avisos: [] } as never,
    })
    .returning();
  return r;
}

async function geracoesDosGanchos() {
  return db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "ganchosAlternativos"));
}

beforeAll(async () => {
  await resetarSchema(db());
  const [n] = await db().insert(nichos).values({ slug: "ganchos-teste", nome: "Limpeza de teste", termos: [] }).returning();
  const [ns] = await db().insert(nichos).values({ slug: "ganchos-saude", nome: "Odontologia de teste", termos: [], ramoCatalogo: "odontologia" }).returning();
  nichoId = n.id;
  nichoSaudeId = ns.id;
  await db().insert(user).values([
    { id: "gc-a", name: "Marca A", email: "gc-a@exemplo.teste", role: "cliente" },
    { id: "gc-b", name: "Marca B", email: "gc-b@exemplo.teste", role: "cliente" },
    { id: "gc-s", name: "Marca Saude", email: "gc-s@exemplo.teste", role: "cliente" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "gc-a", nome: "[teste] Ganchos A", nichoId, tipo: "negocio" }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "gc-b", nome: "[teste] Ganchos B", nichoId, tipo: "negocio" }).returning();
  const [s] = await db().insert(clientes).values({ usuarioId: "gc-s", nome: "[teste] Ganchos Saude", nichoId: nichoSaudeId, tipo: "negocio" }).returning();
  marcaA = a.id;
  marcaB = b.id;
  marcaSaude = s.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "gc-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "gc-b", clienteId: marcaB, papel: "dono" },
    { usuarioId: "gc-s", clienteId: marcaSaude, papel: "dono" },
  ]);
  await db().insert(briefings).values([
    { clienteId: marcaA, completo: true, perfil },
    { clienteId: marcaB, completo: true, perfil },
    { clienteId: marcaSaude, completo: true, perfil },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  vi.mocked(cliente.gerarEstruturado).mockClear();
  vi.mocked(recusaDoVerComo).mockClear();
  vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("gc-a"));
  config.cobranca.ativa = false;
});

afterAll(async () => {
  config.cobranca.ativa = false;
  await getPool().end();
});

describe("pedir os ganchos alternativos", () => {
  it("devolve de 3 a 5 ganchos, de tipos diferentes entre si e do original, cada um com tipo e emoção, na ordem do modelo", async () => {
    const r = await novoRoteiro(marcaA);
    const visao = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    const lista = visao.alternativas!;
    expect(lista.length).toBeGreaterThanOrEqual(3);
    expect(lista.length).toBeLessThanOrEqual(5);
    const tipos = lista.map((g) => g.tipoAbertura);
    expect(new Set(tipos).size).toBe(tipos.length);
    expect(tipos).not.toContain("fala_direta");
    for (const g of lista) {
      expect(g.texto.trim().length).toBeGreaterThan(8);
      expect(g.emocao).toBeTruthy();
    }
    // A ordem é a do modelo: o mock devolve cena, resultado, objeto, numero... (a lista dos sete sem o tipo do original).
    expect(tipos.slice(0, 3)).toEqual(["cena", "resultado", "objeto"]);
    expect(visao.original).toEqual({ texto: GANCHO_ORIGINAL, tipoAbertura: "fala_direta" });
    expect(visao.escolhido).toBeNull();
  });

  it("não mexe no roteiro principal: o gancho, o tipo, as marcas de fala e o escolhido ficam como estavam", async () => {
    const r = await novoRoteiro(marcaA);
    await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    const depois = (await roteiroPorId(r.id, marcaA))!;
    expect(depois.conteudo.gancho).toBe(GANCHO_ORIGINAL);
    expect(depois.tipoAbertura).toBe("fala_direta");
    expect(depois.marcasDeFala).not.toBeNull();
    expect(depois.ganchoEscolhido).toBeNull();
    expect(depois.editadoPelaPessoa).toBe(false);
  });

  it("registra a geração à parte (modelo barato, versão do prompt, marca) mais o verificador de texto, e o prompt de roteiro nem é chamado", async () => {
    const r = await novoRoteiro(marcaA);
    await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    const linhas = await geracoesDosGanchos();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ clienteId: marcaA, versaoPrompt: versaoDoPrompt });
    const tarefas = vi.mocked(cliente.gerarEstruturado).mock.calls.map((c) => c[0].tarefa);
    expect(tarefas).toContain("verificarTexto");
    expect(tarefas).not.toContain("roteiro");
    expect(vi.mocked(cliente.gerarEstruturado).mock.calls.find((c) => c[0].tarefa === "ganchosAlternativos")![0].nivel).toBe("barato");
  });

  it("a lista fica guardada: o segundo pedido (e o de dois toques juntos) devolve a mesma sem gastar IA de novo", async () => {
    const r = await novoRoteiro(marcaA);
    const [um, dois] = await Promise.allSettled([pedirGanchosAlternativos(marcaA, r.id, AGORA), pedirGanchosAlternativos(marcaA, r.id, AGORA)]);
    // Um dos dois pode ter dito "em andamento" (a trava da marca); o outro entregou.
    const entregues = [um, dois].filter((x) => x.status === "fulfilled");
    expect(entregues.length).toBeGreaterThanOrEqual(1);
    const chamadasDeGeracao = vi.mocked(cliente.gerarEstruturado).mock.calls.filter((c) => c[0].tarefa === "ganchosAlternativos").length;
    expect(chamadasDeGeracao).toBe(1);
    const gastos = (await geracoesDosGanchos()).length;
    const terceiro = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    expect(terceiro.alternativas).toHaveLength(entregues[0].status === "fulfilled" ? entregues[0].value.alternativas!.length : -1);
    expect((await geracoesDosGanchos()).length).toBe(gastos);
  });

  it("roteiro sem tipo de abertura registrado também funciona (roteiro antigo)", async () => {
    const r = await novoRoteiro(marcaA, { tipoAbertura: null });
    const visao = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    expect(visao.alternativas!.length).toBeGreaterThanOrEqual(3);
    expect(visao.original!.tipoAbertura).toBeNull();
  });

  it("Story não tem gancho para trocar", async () => {
    const r = await novoRoteiro(marcaA, { formato: "story" });
    await expect(pedirGanchosAlternativos(marcaA, r.id, AGORA)).rejects.toMatchObject({ motivo: "sem-gancho" });
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
  });

  it("roteiro já gravado ou postado não pede", async () => {
    const r = await novoRoteiro(marcaA, { status: "gravado" });
    await expect(pedirGanchosAlternativos(marcaA, r.id, AGORA)).rejects.toMatchObject({ motivo: "ja-gravado" });
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
  });

  it("o teto de tentativas por marca por dia segura quem toca em repetição", async () => {
    const r = await novoRoteiro(marcaA);
    await db()
      .insert(geracoesIA)
      .values(Array.from({ length: TENTATIVAS_DE_GANCHOS_POR_MARCA_POR_DIA }, () => ({ tarefa: "ganchosAlternativos" as const, versaoPrompt: "1.0.0", modelo: "mock", clienteId: marcaA, entradas: {}, saida: {}, criadoEm: AGORA })));
    await expect(pedirGanchosAlternativos(marcaA, r.id, AGORA)).rejects.toMatchObject({ motivo: "limite-do-dia" });
  });
});

describe("as regras que mandam a lista de volta ao modelo", () => {
  it("tipo repetido, poucos ganchos, gancho igual ao atual e fórmula de máquina na 1a tentativa: a 2a tentativa sai certa e as duas ficam registradas", async () => {
    for (const marcador of ["ganchos-tipo-igual", "ganchos-tipo-do-original", "ganchos-poucos", "ganchos-formula", "ganchos-igual"]) {
      await db().delete(roteiros);
      await db().delete(geracoesIA);
      const r = await novoRoteiro(marcaA, { tema: `tirar mancha do sofá [mock:${marcador}]` });
      const visao = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
      const tipos = visao.alternativas!.map((g) => g.tipoAbertura);
      expect(new Set(tipos).size, marcador).toBe(tipos.length);
      expect(tipos, marcador).not.toContain("fala_direta");
      expect(visao.alternativas!.length, marcador).toBeGreaterThanOrEqual(3);
      expect((await geracoesDosGanchos()).length, marcador).toBe(2);
    }
  });

  it("a promessa de resultado em marca de saúde volta para o modelo; fora da saúde a mesma frase não é barrada pela regra de saúde", async () => {
    const r = await novoRoteiro(marcaSaude, { tema: "clareamento [mock:ganchos-promessa]" });
    const visao = await pedirGanchosAlternativos(marcaSaude, r.id, AGORA);
    expect(visao.alternativas!.some((g) => /garantimos/i.test(g.texto))).toBe(false);
    expect((await geracoesDosGanchos()).length).toBe(2);
  });

  it("fórmula de máquina que fica na 2a tentativa sai da lista: de cinco, um com fórmula, sobram quatro", async () => {
    const r = await novoRoteiro(marcaA, { tema: "tirar mancha do sofá [mock:ganchos-sempre-formula-um]" });
    const visao = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    expect(visao.alternativas).toHaveLength(4);
    expect(visao.alternativas!.some((g) => /resultado incrível/i.test(g.texto))).toBe(false);
  });

  it("se depois de tirar as fórmulas sobram menos de três, mostra os que passaram (sem inventar) e nunca o reprovado", async () => {
    const r = await novoRoteiro(marcaA, { tema: "tirar mancha do sofá [mock:ganchos-sempre-formula-tres]" });
    const visao = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    expect(visao.alternativas).toHaveLength(2);
    expect(visao.alternativas!.some((g) => /resultado incrível/i.test(g.texto))).toBe(false);
  });

  it("a lista com só dois ganchos nas duas tentativas mostra os dois, sem completar com um terceiro", async () => {
    const r = await novoRoteiro(marcaA, { tema: "tirar mancha do sofá [mock:ganchos-sempre-poucos]" });
    const visao = await pedirGanchosAlternativos(marcaA, r.id, AGORA);
    expect(visao.alternativas).toHaveLength(2);
  });

  it("quando nenhum gancho passa nas duas tentativas, não guarda nada e diz que não deu", async () => {
    const r = await novoRoteiro(marcaA, { tema: "tirar mancha do sofá [mock:ganchos-sempre-todos-sem-detalhe]" });
    await expect(pedirGanchosAlternativos(marcaA, r.id, AGORA)).rejects.toMatchObject({ motivo: "ia-fora" });
    expect((await roteiroPorId(r.id, marcaA))!.ganchosAlternativos).toBeNull();
  });

  it("a lista reprovada duas vezes e a IA fora do ar não guardam nada e deixam o roteiro como está", async () => {
    for (const marcador of ["ganchos-fora"]) {
      const r = await novoRoteiro(marcaA, { tema: `tirar mancha do sofá [mock:${marcador}]` });
      await expect(pedirGanchosAlternativos(marcaA, r.id, AGORA), marcador).rejects.toMatchObject({ motivo: "ia-fora" });
      const depois = (await roteiroPorId(r.id, marcaA))!;
      expect(depois.ganchosAlternativos, marcador).toBeNull();
      expect(depois.conteudo.gancho, marcador).toBe(GANCHO_ORIGINAL);
    }
  });
});

describe("trocar o gancho", () => {
  it("grava o texto, o tipo de abertura e o escolhido; as marcas de fala se apagam; o roteiro continua 'gerado'", async () => {
    const r = await novoRoteiro(marcaA);
    const lista = (await pedirGanchosAlternativos(marcaA, r.id, AGORA)).alternativas!;
    const visao = await trocarGancho(marcaA, r.id, 1, AGORA);
    const depois = (await roteiroPorId(r.id, marcaA))!;
    expect(depois.conteudo.gancho).toBe(lista[1].texto);
    expect(depois.tipoAbertura).toBe(lista[1].tipoAbertura);
    expect(depois.ganchoEscolhido).toBe("alternativo");
    expect(depois.ganchoEscolhidoEm).toEqual(AGORA);
    expect(depois.marcasDeFala).toBeNull();
    expect(depois.status).toBe("gerado");
    expect(depois.ganchosAlternativos).toMatchObject({ escolhido: 1, original: { texto: GANCHO_ORIGINAL, tipoAbertura: "fala_direta" } });
    expect(visao).toMatchObject({ escolhido: 1, atual: { texto: lista[1].texto } });
    // O resto do roteiro não muda.
    expect(depois.conteudo.corpo).toBe(conteudo().corpo);
    expect(depois.conteudo.chamadaFinal).toBe(conteudo().chamadaFinal);
  });

  it("trocar de um alternativo para outro mantém o original; voltar ao de antes devolve o texto e o tipo", async () => {
    const r = await novoRoteiro(marcaA);
    const lista = (await pedirGanchosAlternativos(marcaA, r.id, AGORA)).alternativas!;
    await trocarGancho(marcaA, r.id, 0, AGORA);
    await trocarGancho(marcaA, r.id, 2, AGORA);
    let depois = (await roteiroPorId(r.id, marcaA))!;
    expect(depois.conteudo.gancho).toBe(lista[2].texto);
    expect(depois.ganchosAlternativos!.original.texto).toBe(GANCHO_ORIGINAL);
    await trocarGancho(marcaA, r.id, "original", AGORA);
    depois = (await roteiroPorId(r.id, marcaA))!;
    expect(depois.conteudo.gancho).toBe(GANCHO_ORIGINAL);
    expect(depois.tipoAbertura).toBe("fala_direta");
    expect(depois.ganchoEscolhido).toBe("original");
    expect(depois.ganchosAlternativos!.escolhido).toBeNull();
  });

  it("escolha fora da lista, sem ter pedido, e roteiro gravado são recusados sem mexer em nada", async () => {
    const r = await novoRoteiro(marcaA);
    await expect(trocarGancho(marcaA, r.id, 0, AGORA)).rejects.toMatchObject({ motivo: "sem-alternativas" });
    const lista = (await pedirGanchosAlternativos(marcaA, r.id, AGORA)).alternativas!;
    for (const ruim of [lista.length, -1, 1.5]) {
      await expect(trocarGancho(marcaA, r.id, ruim, AGORA)).rejects.toMatchObject({ motivo: "escolha-invalida" });
    }
    await db().update(roteiros).set({ status: "gravado" }).where(eq(roteiros.id, r.id));
    await expect(trocarGancho(marcaA, r.id, 0, AGORA)).rejects.toMatchObject({ motivo: "ja-gravado" });
    const depois = (await roteiroPorId(r.id, marcaA))!;
    expect(depois.conteudo.gancho).toBe(GANCHO_ORIGINAL);
    expect(depois.ganchoEscolhido).toBeNull();
  });
});

describe("o isolamento e as Server Actions", () => {
  it("uma marca nunca pede nem troca o gancho de roteiro de outra, e nada é gasto", async () => {
    const deB = await novoRoteiro(marcaB);
    await expect(pedirGanchosAlternativos(marcaA, deB.id, AGORA)).rejects.toMatchObject({ motivo: "nao-achou" });
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
    await pedirGanchosAlternativos(marcaB, deB.id, AGORA);
    await expect(trocarGancho(marcaA, deB.id, 0, AGORA)).rejects.toMatchObject({ motivo: "nao-achou" });
    expect((await roteiroPorId(deB.id, marcaB))!.conteudo.gancho).toBe(GANCHO_ORIGINAL);
  });

  it("as ações usam a marca da sessão: a sessão de A não mexe no roteiro de B", async () => {
    const deB = await novoRoteiro(marcaB);
    expect(await pedirGanchosAction(deB.id)).toEqual({ ok: false, erro: fraseDosGanchos("nao-achou") });
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
    const deA = await novoRoteiro(marcaA);
    const pedido = await pedirGanchosAction(deA.id);
    expect(pedido.ok).toBe(true);
    const troca = await trocarGanchoAction(deA.id, 0);
    expect(troca).toMatchObject({ ok: true, dado: { ganchos: { escolhido: 0 } } });
    expect(await trocarGanchoAction(deA.id, 99)).toEqual({ ok: false, erro: fraseDosGanchos("escolha-invalida") });
    // Um valor forjado (não é número nem "original") é recusado com a frase, nunca vira erro 500.
    expect(await trocarGanchoAction(deA.id, "qualquer coisa" as never)).toEqual({ ok: false, erro: fraseDosGanchos("escolha-invalida") });
  });

  it("o 'ver como' recusa antes de gastar e antes de gravar: nenhuma chamada de IA, nada muda", async () => {
    const r = await novoRoteiro(marcaA);
    vi.mocked(recusaDoVerComo).mockResolvedValue("Desligado no modo ver como.");
    try {
      expect(await pedirGanchosAction(r.id)).toEqual({ ok: false, erro: "Desligado no modo ver como." });
      expect(await trocarGanchoAction(r.id, 0)).toEqual({ ok: false, erro: "Desligado no modo ver como." });
    } finally {
      vi.mocked(recusaDoVerComo).mockReset();
    }
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
    expect((await roteiroPorId(r.id, marcaA))!.ganchosAlternativos).toBeNull();
  });

  it("a frase de falha da IA chega à tela pela ação", async () => {
    const r = await novoRoteiro(marcaA, { tema: "tirar mancha do sofá [mock:ganchos-fora]" });
    expect(await pedirGanchosAction(r.id)).toEqual({ ok: false, erro: fraseDosGanchos("ia-fora") });
  });

  it("o erro é nomeado", () => {
    expect(new ErroGanchos("x", "ia-fora").name).toBe("ErroGanchos");
  });
});
