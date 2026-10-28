/**
 * E61 PR 1, "o foco da conta" (28/10/2026), contra o Postgres real e a IA em mock:
 *  - o serviço: sugerir (guarda como sugerido, registra a geração, nunca chega ao roteiro), confirmar o texto visto, escrever, corrigir e tirar; o teto por dia; sem briefing não sugere; a IA fora
 *    e a sugestão reprovada duas vezes não guardam nada;
 *  - o roteiro: o foco CONFIRMADO chega ao prompt de sistema, a sugestão sem resposta e a conta sem foco não (e a conta sem foco gera o roteiro como antes);
 *  - o isolamento: duas contas do MESMO setor; o foco, a sugestão e o briefing de uma nunca aparecem na entrada nem no roteiro da outra;
 *  - as Server Actions: a conta vem da sessão; o "ver como" recusa antes de gastar; a marca sem assinatura é barrada pelo portão (a lista geral está em `assinatura-travas.test.ts`).
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
// E61 PR 2: confirmar ou escrever o foco pede os temas do dia da conta pela fila; aqui a fila é um espião (a geração em si tem o próprio teste).
const enviosDaFila = vi.hoisted(() => ({ send: vi.fn<(nome: string, dados: object, opcoes: object) => Promise<string>>(async () => "job") }));
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return { ...original, garantirBossPronto: vi.fn(async () => undefined), boss: vi.fn(() => ({ send: enviosDaFila.send })) };
});
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return { ...original, exigirForaDoVerComo: vi.fn(original.exigirForaDoVerComo) };
});

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, membrosMarca, nichos, roteiros, user, videos, type PerfilCompilado } from "@/db/schema";
import * as cliente from "@/ia/cliente";
import { versao as versaoDoPrompt } from "@/ia/prompts/sugerirFoco";
import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { ErroVerComo, exigirForaDoVerComo } from "@/lib/ver-como";
import { clientePorId } from "@/servicos/clientes";
import {
  confirmarFoco,
  ErroFoco,
  escreverFoco,
  estadoDoFoco,
  focoConfirmado,
  PEDIDOS_DE_FOCO_POR_CONTA_POR_DIA,
  sugerirFoco,
  TAMANHO_MAXIMO_DO_FOCO,
  tirarFoco,
} from "@/servicos/foco-da-conta";
import { gerarRoteiro } from "@/servicos/roteiro";
import { textosBriefing } from "@/textos/briefing";

import { resetarSchema } from "../../scripts/resetar-schema";

const { sugerirFocoAction, confirmarFocoAction, escreverFocoAction, tirarFocoAction } = await import("@/app/(painel)/(completo)/briefing/acoes");

const AGORA = new Date("2026-10-28T15:00:00Z");

let nichoId: number;
let contaA: number; // o Gustavo: marketing e automação com IA
let contaB: number; // o Bruno: outra linha, no mesmo setor
let contaC: number; // sem briefing compilado

const perfil = (oQueVende: string, resumo: string): PerfilCompilado => ({
  fatos: { oQueVende, preco: "mentoria mensal", clienteIdeal: "dono de pequena empresa", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: ["a tela do computador"], concorrentes: [], perfisAdmirados: [] },
  resumo,
  referencias: [],
});

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" }, session: { id: `s-${usuarioId}`, userId: usuarioId } } as never;
}

async function geracoesDeFoco(clienteId?: number) {
  const todas = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "sugerirFoco"));
  return clienteId === undefined ? todas : todas.filter((g) => g.clienteId === clienteId);
}

async function limparFocos() {
  await db().update(clientes).set({ foco: null, focoOrigem: null, focoConfirmadoEm: null });
}

async function focoDe(id: number) {
  const c = await clientePorId(id);
  return { foco: c!.foco, origem: c!.focoOrigem, confirmadoEm: c!.focoConfirmadoEm };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "foco-da-conta", nome: "Empreendedorismo de teste", termos: [] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values([
    { id: "fc-a", name: "Conta A", email: "fc-a@exemplo.teste", role: "cliente" },
    { id: "fc-b", name: "Conta B", email: "fc-b@exemplo.teste", role: "cliente" },
    { id: "fc-c", name: "Conta C", email: "fc-c@exemplo.teste", role: "cliente" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "fc-a", nome: "[teste] Foco A", nichoId, tipo: "pessoa", perfis: { instagram: "conta_a_exemplo", tiktok: null, youtube: null } }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "fc-b", nome: "[teste] Foco B", nichoId, tipo: "pessoa" }).returning();
  const [c] = await db().insert(clientes).values({ usuarioId: "fc-c", nome: "[teste] Foco C", nichoId, tipo: "negocio" }).returning();
  contaA = a.id;
  contaB = b.id;
  contaC = c.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "fc-a", clienteId: contaA, papel: "dono" },
    { usuarioId: "fc-b", clienteId: contaB, papel: "dono" },
    { usuarioId: "fc-c", clienteId: contaC, papel: "dono" },
  ]);
  await db().insert(briefings).values([
    { clienteId: contaA, completo: true, perfil: perfil("automacao de atendimento com inteligencia artificial", "ensina dono de empresa a automatizar o marketing com IA") },
    { clienteId: contaB, completo: true, perfil: perfil("mentoria de posicionamento pessoal", "ensina jovem a construir marca pessoal e negocio na internet") },
    { clienteId: contaC, completo: false },
  ]);
}, 30_000);

beforeEach(async () => {
  await limparFocos();
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  vi.mocked(cliente.gerarEstruturado).mockClear();
  enviosDaFila.send.mockClear();
  vi.mocked(exigirForaDoVerComo).mockClear();
  vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("fc-a"));
  config.cobranca.ativa = false;
});

afterAll(async () => {
  config.cobranca.ativa = false;
  await getPool().end();
});

describe("sugerirFoco: o modelo barato, o registro e o estado 'sugerido'", () => {
  it("guarda a sugestão como sugerida (sem confirmação), registra a geração e nunca a entrega ao roteiro", async () => {
    const foco = await sugerirFoco(contaA, AGORA);
    expect(foco).toContain("Empreendedorismo de teste");

    const conta = await clientePorId(contaA);
    expect(estadoDoFoco(conta!)).toEqual({ estado: "sugerido", texto: foco });
    expect(conta!.focoOrigem).toBe("sugerido");
    expect(conta!.focoConfirmadoEm).toBeNull();
    expect(focoConfirmado(conta!)).toBeNull();

    expect(vi.mocked(cliente.gerarEstruturado).mock.calls[0][0]).toMatchObject({ tarefa: "sugerirFoco", nivel: "barato" });
    const registros = await geracoesDeFoco(contaA);
    expect(registros).toHaveLength(1);
    expect(registros[0].versaoPrompt).toBe(versaoDoPrompt);
    expect(registros[0].modelo).toBe("mock");
    expect(registros[0].ramoId).toBe(nichoId);
  });

  it("a entrada leva o briefing, o ramo e o @ da própria conta, e nada da outra conta do mesmo setor", async () => {
    await sugerirFoco(contaA, AGORA);
    const entrada = String(vi.mocked(cliente.gerarEstruturado).mock.calls[0][0].entrada);
    expect(entrada).toContain("automatizar o marketing com IA");
    expect(entrada).toContain("Ramo (o setor da conta): Empreendedorismo de teste");
    expect(entrada).toContain("@conta_a_exemplo");
    expect(entrada).not.toContain("marca pessoal");
    expect(entrada).not.toContain("Foco B");
  });

  it("pedir outro troca a sugestão e manda a anterior na entrada, para o modelo mudar o recorte", async () => {
    const primeira = await sugerirFoco(contaA, AGORA);
    const segunda = await sugerirFoco(contaA, AGORA);
    expect(segunda).not.toBe(primeira);
    expect(String(vi.mocked(cliente.gerarEstruturado).mock.calls[1][0].entrada)).toContain(primeira);
    expect(estadoDoFoco((await clientePorId(contaA))!)).toEqual({ estado: "sugerido", texto: segunda });
  });

  it("sem briefing compilado não há do que partir: recusa sem chamar o modelo", async () => {
    await expect(sugerirFoco(contaC, AGORA)).rejects.toMatchObject({ motivo: "sem_base" });
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
    expect((await focoDe(contaC)).foco).toBeNull();
  });

  it("quem já confirmou um foco não recebe sugestão por cima", async () => {
    await escreverFoco(contaA, "marketing e automação com IA, para donos de pequena empresa", AGORA);
    await expect(sugerirFoco(contaA, AGORA)).rejects.toMatchObject({ motivo: "ja_confirmado" });
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
    expect((await focoDe(contaA)).foco).toBe("marketing e automação com IA, para donos de pequena empresa");
  });

  it("o teto por conta por dia segura o botão apertado em repetição", async () => {
    for (let i = 0; i < PEDIDOS_DE_FOCO_POR_CONTA_POR_DIA; i += 1) await sugerirFoco(contaA, new Date());
    await expect(sugerirFoco(contaA, new Date())).rejects.toMatchObject({ motivo: "limite_do_dia" });
    expect(await geracoesDeFoco(contaA)).toHaveLength(PEDIDOS_DE_FOCO_POR_CONTA_POR_DIA);
    // O teto é da conta: a outra conta do setor segue podendo.
    await expect(sugerirFoco(contaB, new Date())).resolves.toBeTruthy();
  });

  it("a IA fora do ar não guarda nada", async () => {
    await db().update(clientes).set({ nome: "[teste] Foco A [mock:foco-fora]" }).where(eq(clientes.id, contaA));
    try {
      await expect(sugerirFoco(contaA, AGORA)).rejects.toMatchObject({ motivo: "ia_fora" });
      expect((await focoDe(contaA)).foco).toBeNull();
    } finally {
      await db().update(clientes).set({ nome: "[teste] Foco A" }).where(eq(clientes.id, contaA));
    }
  });

  it("uma sugestão com jargão é reprovada duas vezes, as duas tentativas ficam registradas e nada é guardado", async () => {
    await db().update(clientes).set({ nome: "[teste] Foco A [mock:foco-ruim]" }).where(eq(clientes.id, contaA));
    try {
      await expect(sugerirFoco(contaA, AGORA)).rejects.toMatchObject({ motivo: "ia_fora" });
      expect(await geracoesDeFoco(contaA)).toHaveLength(2);
      expect(String(vi.mocked(cliente.gerarEstruturado).mock.calls[1][0].entrada)).toContain("A tentativa anterior foi reprovada.");
      expect((await focoDe(contaA)).foco).toBeNull();
    } finally {
      await db().update(clientes).set({ nome: "[teste] Foco A" }).where(eq(clientes.id, contaA));
    }
  });
});

describe("confirmar, escrever, corrigir e tirar", () => {
  it("'Está certo' confirma exatamente o texto visto, com a origem 'sugerido'", async () => {
    const foco = await sugerirFoco(contaA, AGORA);
    await expect(confirmarFoco(contaA, foco, AGORA)).resolves.toBe("confirmado");
    const conta = (await clientePorId(contaA))!;
    expect(estadoDoFoco(conta)).toMatchObject({ estado: "confirmado", texto: foco, origem: "sugerido" });
    expect(focoConfirmado(conta)).toBe(foco);
    // Duplo toque: o resultado que a pessoa queria já existe.
    await expect(confirmarFoco(contaA, foco, AGORA)).resolves.toBe("confirmado");
  });

  it("confirmar um texto que já não é o da sugestão volta 'mudou' e não confirma nada", async () => {
    const primeira = await sugerirFoco(contaA, AGORA);
    await sugerirFoco(contaA, AGORA);
    await expect(confirmarFoco(contaA, primeira, AGORA)).resolves.toBe("mudou");
    expect((await focoDe(contaA)).confirmadoEm).toBeNull();
  });

  it("confirmar sem sugestão nenhuma volta 'mudou'", async () => {
    await expect(confirmarFoco(contaA, "qualquer coisa que a tela mostrava", AGORA)).resolves.toBe("mudou");
  });

  it("escrever confirma na hora, com a origem 'escrito', e limpa o texto", async () => {
    await escreverFoco(contaA, "  marketing   e automação\ncom IA <b>para</b> donos de empresa ", AGORA);
    expect(await focoDe(contaA)).toEqual({ foco: "marketing e automação com IA b para /b donos de empresa", origem: "escrito", confirmadoEm: AGORA });
  });

  it("corrigir uma sugestão é escrever: vira 'escrito' e confirmado", async () => {
    await sugerirFoco(contaA, AGORA);
    await escreverFoco(contaA, "automação de atendimento para clínicas", AGORA);
    expect(estadoDoFoco((await clientePorId(contaA))!)).toMatchObject({ estado: "confirmado", texto: "automação de atendimento para clínicas", origem: "escrito" });
  });

  it("curto demais e comprido demais são recusados e nada muda", async () => {
    await escreverFoco(contaA, "automação de atendimento para clínicas", AGORA);
    await expect(escreverFoco(contaA, "IA", AGORA)).rejects.toMatchObject({ motivo: "texto_curto" });
    await expect(escreverFoco(contaA, "a".repeat(TAMANHO_MAXIMO_DO_FOCO + 1), AGORA)).rejects.toMatchObject({ motivo: "texto_longo" });
    expect((await focoDe(contaA)).foco).toBe("automação de atendimento para clínicas");
  });

  it("texto vazio e 'Tirar o foco' devolvem a conta ao que era antes da etapa", async () => {
    await escreverFoco(contaA, "automação de atendimento para clínicas", AGORA);
    await escreverFoco(contaA, "   ", AGORA);
    expect(await focoDe(contaA)).toEqual({ foco: null, origem: null, confirmadoEm: null });

    await sugerirFoco(contaA, AGORA);
    await tirarFoco(contaA);
    expect(await focoDe(contaA)).toEqual({ foco: null, origem: null, confirmadoEm: null });
  });

  it("o erro é nomeado", async () => {
    await expect(escreverFoco(contaA, "IA", AGORA)).rejects.toBeInstanceOf(ErroFoco);
  });
});

describe("isolamento: duas contas do mesmo setor", () => {
  it("o foco, a sugestão e a confirmação de uma conta nunca aparecem na outra", async () => {
    await escreverFoco(contaA, "marketing e automação com IA, para donos de pequena empresa", AGORA);
    const sugestaoB = await sugerirFoco(contaB, AGORA);
    expect(sugestaoB).not.toContain("automação");

    const a = (await clientePorId(contaA))!;
    const b = (await clientePorId(contaB))!;
    expect(focoConfirmado(a)).toBe("marketing e automação com IA, para donos de pequena empresa");
    expect(focoConfirmado(b)).toBeNull();
    expect(estadoDoFoco(b)).toEqual({ estado: "sugerido", texto: sugestaoB });
    expect((await clientePorId(contaC))!.foco).toBeNull();

    // Confirmar na conta B o texto da A não vale: o WHERE leva a conta junto.
    await expect(confirmarFoco(contaB, "marketing e automação com IA, para donos de pequena empresa", AGORA)).resolves.toBe("mudou");
    expect(focoConfirmado((await clientePorId(contaB))!)).toBeNull();

    // Tirar o foco da B não mexe no da A.
    await tirarFoco(contaB);
    expect(focoConfirmado((await clientePorId(contaA))!)).toBe("marketing e automação com IA, para donos de pequena empresa");
  });
});

describe("o roteiro", () => {
  async function criarEvidencia() {
    await db().insert(videos).values({
      plataforma: "youtube",
      idExterno: "fc-ev-1",
      url: "https://exemplo.invalido/fc-ev-1",
      nichoId,
      titulo: "automatizar o atendimento",
      foraDaCurva: "6",
      publicadoEm: new Date(),
      idioma: "pt",
      analise: {
        assunto: "automatizar o atendimento",
        gancho: "olha esse atendimento rodando sozinho",
        estrutura: "gancho, demonstracao, fechamento",
        fechamento: "mostra o resultado",
        chamadaFinal: "comenta se voce ja tentou",
        formato: "fala_para_camera",
        porQueFuncionou: "mostra o problema acontecendo de verdade",
      } as never,
    });
  }

  async function sistemasDoRoteiro(clienteId: number): Promise<string[]> {
    vi.mocked(cliente.gerarEstruturado).mockClear();
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: "automatizar o atendimento", objetivo: "conversao" });
    return vi
      .mocked(cliente.gerarEstruturado)
      .mock.calls.map(([params]) => params)
      .filter((params) => params.tarefa === "roteiro")
      .map((params) => String(params.sistemaEstavel));
  }

  it("o foco confirmado chega ao prompt do roteiro; o de outra conta do setor, uma sugestão sem resposta e a conta sem foco não", async () => {
    await criarEvidencia();
    await escreverFoco(contaA, "marketing e automação com IA, para donos de pequena empresa", AGORA);
    await sugerirFoco(contaB, AGORA); // sugerida e não confirmada

    const daA = await sistemasDoRoteiro(contaA);
    expect(daA.length).toBeGreaterThan(0);
    for (const sistema of daA) {
      expect(sistema).toContain("Foco desta conta, escolhido pela própria pessoa");
      expect(sistema).toContain("marketing e automação com IA, para donos de pequena empresa");
    }

    // A conta C não tem briefing compilado nos outros testes; aqui ela ganha um, só para gerar o roteiro sem foco.
    await db().update(briefings).set({ perfil: perfil("consultoria de vendas", "ajuda pequenas empresas a vender mais") }).where(eq(briefings.clienteId, contaC));
    try {
      for (const id of [contaB, contaC]) {
        const sistemas = await sistemasDoRoteiro(id);
        expect(sistemas.length).toBeGreaterThan(0);
        for (const sistema of sistemas) {
          expect(sistema).not.toContain("Foco desta conta, escolhido pela própria pessoa");
          expect(sistema).not.toContain("para donos de pequena empresa");
        }
      }
    } finally {
      await db().update(briefings).set({ perfil: null }).where(eq(briefings.clienteId, contaC));
    }
  });
});

describe("as Server Actions", () => {
  it("a conta vem da sessão: sugerir, confirmar, escrever e tirar mexem só na conta de quem está logado", async () => {
    const sugerida = await sugerirFocoAction();
    expect(sugerida).toMatchObject({ ok: true, foco: { estado: "sugerido" } });
    const texto = sugerida.foco.estado === "sugerido" ? sugerida.foco.texto : "";

    expect(await confirmarFocoAction(texto)).toMatchObject({ ok: true, foco: { estado: "confirmado", origem: "sugerido", texto } });
    expect((await clientePorId(contaB))!.foco).toBeNull();

    expect(await escreverFocoAction("automação de atendimento para clínicas")).toMatchObject({ ok: true, foco: { estado: "confirmado", origem: "escrito" } });
    expect(await tirarFocoAction()).toEqual({ ok: true, foco: { estado: "sem" } });
  });

  it("confirmar ou escrever o foco pede os temas do dia só dessa conta; sugerir, tirar e o erro não pedem nada", async () => {
    await sugerirFocoAction();
    expect(enviosDaFila.send).not.toHaveBeenCalled();

    const sugerida = (await clientePorId(contaA))!.foco!;
    await confirmarFocoAction(sugerida);
    expect(enviosDaFila.send).toHaveBeenCalledTimes(1);
    expect(enviosDaFila.send).toHaveBeenLastCalledWith("temas-do-dia", { nichoId, clienteId: contaA, aoAbrir: true }, expect.objectContaining({ singletonSeconds: 600 }));

    await escreverFocoAction("automação de atendimento para clínicas");
    expect(enviosDaFila.send).toHaveBeenCalledTimes(2);
    // Nunca o texto do foco na fila: só o id da conta.
    expect(JSON.stringify(enviosDaFila.send.mock.calls)).not.toContain("clínicas");

    await escreverFocoAction("IA");
    await tirarFocoAction();
    expect(enviosDaFila.send).toHaveBeenCalledTimes(2);
  });

  it("a frase do erro vem do motivo, e o foco devolvido é o que o servidor tem", async () => {
    expect(await escreverFocoAction("IA")).toMatchObject({ ok: false, erro: textosBriefing.focoDaConta.textoCurto(8), foco: { estado: "sem" } });
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("fc-c"));
    expect(await sugerirFocoAction()).toMatchObject({ ok: false, erro: textosBriefing.focoDaConta.erroSugerirSemBriefing });
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("fc-a"));
    await sugerirFocoAction();
    expect(await confirmarFocoAction("um texto que a tela não tem mais")).toMatchObject({ ok: false, erro: textosBriefing.focoDaConta.mudouEnquantoLia, foco: { estado: "sugerido" } });
  });

  it("o 'ver como' recusa antes de gastar: nenhuma chamada de IA", async () => {
    vi.mocked(exigirForaDoVerComo).mockRejectedValueOnce(new ErroVerComo("somente leitura"));
    await expect(sugerirFocoAction()).rejects.toBeInstanceOf(ErroVerComo);
    expect(cliente.gerarEstruturado).not.toHaveBeenCalled();
    expect((await clientePorId(contaA))!.foco).toBeNull();
  });
});
