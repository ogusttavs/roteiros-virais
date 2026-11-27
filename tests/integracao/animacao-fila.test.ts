/**
 * E68 A2 e A3, o vídeo de animação de texto: pedir, prévia, aprovar, final, falha, limpeza e as rotas que entregam o arquivo, contra o Postgres local. O motor (Chromium e ffmpeg) é trocado por um
 * escritor de arquivo nos testes de fila; um teste roda a prévia de verdade, com 2 segundos. Prova: isolamento entre marcas (serviço, ações e rotas), fora da lista e com a chave desligada tudo
 * responde 404 e a lista é lida a cada pedido, uma animação em andamento por marca, os estados na ordem, a falha vira frase (e o erro técnico só no log), duas execuções nunca montam a mesma
 * animação, o "ver como" só lê, e a limpeza (7 dias, 48 horas, montagem parada, pedido esquecido, arquivo sem dono).
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string; name: string }; session: { userId: string }; verComo: null | object },
  verComo: false,
  logs: [] as unknown[][],
  enfileirados: [] as { fila: string; dados: unknown; opcoes?: unknown }[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return {
    ...original,
    sessaoDoPainel: async () => estado.sessao,
    recusaDoVerComo: async () => (estado.verComo ? "Desligado no modo ver como." : null),
    modoVerComoLigado: async () => estado.verComo,
  };
});
vi.mock("@/lib/portao-cobranca", async () => ({ exigirAssinaturaValida: async () => undefined, recusaDaCobranca: async () => null }));
vi.mock("@/lib/log", () => {
  const guardar = (...args: unknown[]) => void estado.logs.push(args);
  return { logger: { info: guardar, warn: guardar, error: guardar, debug: guardar, trace: guardar, fatal: guardar } };
});
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return {
    ...original,
    garantirBossPronto: async () => undefined,
    boss: () => ({ send: async (fila: string, dados: unknown, opcoes?: unknown) => void estado.enfileirados.push({ fila, dados, opcoes }) }),
  };
});

import { nomeRelativoDaAnimacao } from "@/animacao/arquivos";
import { ErroDaAnimacao, type EntradaDaAnimacao } from "@/animacao/tipos";
import { aprovarAnimacaoAction, dispensarAnimacaoAction, pedirAnimacaoAction, tentarAnimacaoDeNovoAction } from "@/app/(painel)/(completo)/roteiros/[id]/animacao-acoes";
import { GUARDA_DA_FALHA_MS, GUARDA_DA_PREVIA_MS, GUARDA_DO_FINAL_MS, TENTATIVAS_DA_ANIMACAO } from "@/config/animacao-fila";
import { db } from "@/db";
import { animacoes, clientes, membrosMarca, nichos, roteiros, user } from "@/db/schema";
import { sondarSaida } from "@/edicao/sintetica-video";
import { FILAS } from "@/jobs/fila";
import { rodarLimparEdicoes } from "@/jobs/limpar-edicoes";
import { aprovarAnimacao, arquivoDaAnimacaoParaVer, dispensarAnimacao, pedirAnimacao, tentarAnimacaoDeNovo, visaoDaAnimacao } from "@/servicos/animacao";
import { limparAnimacoes } from "@/servicos/limpar-animacoes";
import { recolherAnimacoesOrfas, rodarRenderizarAnimacao } from "@/servicos/render-animacao";
import { fraseDaAnimacao } from "@/textos/animacao";

import { resetarSchema } from "../../scripts/resetar-schema";

const { GET: statusRota } = await import("@/app/api/animacao/[id]/route");
const { GET: previaRota } = await import("@/app/api/animacao/[id]/previa/route");
const { GET: finalRota } = await import("@/app/api/animacao/[id]/final/route");

let pasta: string;
let volume: string;
let marcaA: number;
let marcaB: number;
let marcaC: number;
let roteiroA: number;
let roteiroA2: number;
let roteiroB: number;
let roteiroLongoA: number;
let roteiroSemTextoA: number;
let roteiroComColcheteA: number;
let roteiroGrandeA: number;
const anterior = { pasta: process.env.EDICAO_PASTA, ativa: process.env.ANIMACAO_ATIVA, contas: process.env.ANIMACAO_CONTAS };

const CONTEUDO = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 40,
  gancho: "Você lava a louça do jeito errado.",
  corpo: "O primeiro erro é deixar de molho a noite toda.\nO segundo é usar esponja suja.",
  fechamento: "Faça diferente hoje.",
  chamadaFinal: "Chame no WhatsApp.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

function entrar(usuarioId: string | null): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: "cliente", name: usuarioId }, session: { userId: usuarioId }, verComo: null } : null;
}

function liberar(...marcas: number[]): void {
  process.env.ANIMACAO_ATIVA = "1";
  process.env.ANIMACAO_CONTAS = marcas.join(",");
}

const contexto = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const semFila = { enfileirar: async () => undefined };

/** Um motor que escreve um arquivo qualquer (o MP4 de mentira) no caminho pedido, para provar a fila sem abrir o navegador. */
const motorFalso = (bytes = "mp4-de-mentira") => async (entrada: EntradaDaAnimacao) => {
  await writeFile(entrada.saida, bytes);
  entrada.aoProgredir?.(50);
  return { saida: entrada.saida, duracaoS: 2, quadros: 60, bytes: bytes.length };
};
const motorQueFalha = (codigo: "navegador" | "entrada" = "navegador") => async (entrada: EntradaDaAnimacao) => {
  await writeFile(entrada.saida, "parcial");
  throw new ErroDaAnimacao("falha tecnica com TEXTO-SECRETO-DA-PESSOA no meio", codigo);
};

async function linha(id: number) {
  const [l] = await db().select().from(animacoes).where(eq(animacoes.id, id));
  return l;
}

async function arquivosDoVolume(): Promise<string[]> {
  return (await readdir(join(volume, "animacao")).catch(() => [])).sort();
}

async function pedir(marca: number, usuario: string, roteiro: number): Promise<number> {
  const r = await pedirAnimacao({ clienteId: marca, usuarioId: usuario, roteiroId: roteiro });
  if (!r.ok) throw new Error(`pedido recusado: ${r.codigo}`);
  return r.animacao.id;
}

/** Uma animação já no estado pedido, com os arquivos que esse estado tem. */
async function criar(clienteId: number, roteiroId: number, estadoInicial: (typeof animacoes.$inferInsert)["estado"], extra: Partial<typeof animacoes.$inferInsert> = {}): Promise<number> {
  const [a] = await db()
    .insert(animacoes)
    .values({ clienteId, roteiroId, estado: estadoInicial, molde: "tipografico-1", cenas: [{ texto: "Olá" }], duracaoS: "2.000", ...extra })
    .returning({ id: animacoes.id });
  return a.id;
}

async function criarArquivo(relativo: string, conteudo = "x"): Promise<void> {
  const caminho = join(volume, ...relativo.split("/"));
  await mkdir(join(caminho, ".."), { recursive: true });
  await writeFile(caminho, conteudo);
}

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "animacao-integracao-"));
  volume = join(pasta, "volume");
  process.env.EDICAO_PASTA = volume;
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "animacao-teste", nome: "Animacao teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "an-dono-a", name: "Dono A", email: "an-dono-a@exemplo.teste", role: "cliente" },
    { id: "an-dono-b", name: "Dono B", email: "an-dono-b@exemplo.teste", role: "cliente" },
    { id: "an-dono-c", name: "Dono C", email: "an-dono-c@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "an-dono-a", nome: "[teste] Marca Alfa", nichoId: nicho.id, perfis },
      { usuarioId: "an-dono-b", nome: "[teste] Marca Beta", nichoId: nicho.id, perfis },
      { usuarioId: "an-dono-c", nome: "[teste] Marca Gama", nichoId: nicho.id, perfis },
    ])
    .returning();
  [marcaA, marcaB, marcaC] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "an-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "an-dono-b", clienteId: marcaB, papel: "dono" },
    { usuarioId: "an-dono-c", clienteId: marcaC, papel: "dono" },
  ]);
  const base = { data: "2026-11-25", tema: "tema", origem: "sugerido" as const, objetivo: "alcance" as const, conteudo: CONTEUDO };
  const inseridos = await db()
    .insert(roteiros)
    .values([
      { ...base, clienteId: marcaA },
      { ...base, clienteId: marcaA },
      { ...base, clienteId: marcaB },
      { ...base, clienteId: marcaA, duracaoDoVideo: "longo" },
      { ...base, clienteId: marcaA, conteudo: { ...CONTEUDO, gancho: " ", corpo: "", fechamento: "", chamadaFinal: "" } },
      { ...base, clienteId: marcaA, conteudo: { ...CONTEUDO, corpo: "O primeiro erro é deixar de molho a noite toda.\n[conte aqui o caso de uma paciente sua, com o resultado que ela teve]" } },
      { ...base, clienteId: marcaA, conteudo: { ...CONTEUDO, corpo: Array.from({ length: 80 }, (_, i) => `Passo numero ${i} do corpo que explica um detalhe do assunto com calma.`).join("\n") } },
    ])
    .returning({ id: roteiros.id });
  [roteiroA, roteiroA2, roteiroB, roteiroLongoA, roteiroSemTextoA, roteiroComColcheteA, roteiroGrandeA] = inseridos.map((r) => r.id);
}, 120_000);

afterAll(async () => {
  for (const [chave, valor] of [
    ["EDICAO_PASTA", anterior.pasta],
    ["ANIMACAO_ATIVA", anterior.ativa],
    ["ANIMACAO_CONTAS", anterior.contas],
  ] as const) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  await rm(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  await db().delete(animacoes);
  await rm(volume, { recursive: true, force: true });
  estado.logs.length = 0;
  estado.enfileirados.length = 0;
  estado.verComo = false;
  liberar(marcaA, marcaB);
  entrar("an-dono-a");
});

describe("quem pode usar", () => {
  it("marca fora da lista (ou com a chave desligada) não vê nada e tudo responde como se não existisse", async () => {
    // Marca C está fora da lista.
    entrar("an-dono-c");
    const r = await pedirAnimacao({ clienteId: marcaC, usuarioId: "an-dono-c", roteiroId: roteiroA });
    expect(r).toMatchObject({ ok: false, codigo: "nao-achou", status: 404 });
    const [roteiroC] = await db().insert(roteiros).values({ clienteId: marcaC, data: "2026-11-25", tema: "t", origem: "sugerido", objetivo: "alcance", conteudo: CONTEUDO }).returning();
    expect(await visaoDaAnimacao({ clienteId: marcaC, roteiro: roteiroC, verComo: false })).toBeNull();
    expect(await pedirAnimacao({ clienteId: marcaC, usuarioId: "an-dono-c", roteiroId: roteiroC.id })).toMatchObject({ ok: false, status: 404 });
    expect(estado.enfileirados).toEqual([]);

    // A animação de uma marca da lista, vista de uma marca de fora: rotas e serviço dão 404.
    const id = await criar(marcaA, roteiroA, "previa_pronta", { caminhoPrevia: nomeRelativoDaAnimacao(0, "previa") });
    const resposta = await statusRota(new Request(`http://localhost/api/animacao/${id}`), contexto(id));
    expect(resposta.status).toBe(404);
    expect((await previaRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);
    expect((await finalRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);
    expect(await aprovarAnimacao(marcaC, id)).toMatchObject({ ok: false, status: 404 });
    expect(await dispensarAnimacao(marcaC, id)).toMatchObject({ ok: false, status: 404 });
    expect(await tentarAnimacaoDeNovo(marcaC, id)).toMatchObject({ ok: false, status: 404 });

    // Na lista, mas com a chave desligada: o mesmo.
    entrar("an-dono-a");
    process.env.ANIMACAO_ATIVA = "0";
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroA })).toMatchObject({ ok: false, status: 404 });
    expect((await statusRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);
    const [roteiroDeA] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroA));
    expect(await visaoDaAnimacao({ clienteId: marcaA, roteiro: roteiroDeA, verComo: false })).toBeNull();
    expect(await pedirAnimacaoAction(roteiroA)).toEqual({ ok: false, erro: fraseDaAnimacao("nao-achou") });
  });

  it("a lista é lida a cada pedido: tirar a marca da lista corta o acesso no pedido seguinte, sem reiniciar", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    expect((await statusRota(new Request("http://localhost/x"), contexto(id))).status).toBe(200);
    process.env.ANIMACAO_CONTAS = String(marcaB);
    expect((await statusRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);
    process.env.ANIMACAO_CONTAS = `${marcaB}, ${marcaA}`;
    expect((await statusRota(new Request("http://localhost/x"), contexto(id))).status).toBe(200);
  });
});

describe("pedir", () => {
  it("o pedido nasce do texto do roteiro (sem IA), com o molde, e põe só a prévia na fila com a chave da animação", async () => {
    const r = await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = await linha(r.animacao.id);
    expect(a).toMatchObject({ clienteId: marcaA, roteiroId: roteiroA, estado: "pedida", molde: "tipografico-2", progresso: null, tentativas: 0, criadaPor: "an-dono-a" });
    expect(a.cenas.map((c) => c.texto)).toEqual(["Você lava a louça do jeito errado.", "O primeiro erro é deixar de molho a noite toda.", "O segundo é usar esponja suja.", "Faça diferente hoje.", "Chame no WhatsApp."]);
    expect(Number(a.duracaoS)).toBeGreaterThan(5);
    expect(estado.enfileirados).toHaveLength(1);
    expect(estado.enfileirados[0]).toMatchObject({ fila: FILAS.renderizarAnimacao, dados: { animacaoId: a.id, perfil: "previa" }, opcoes: { singletonKey: `animacao-previa-${a.id}-0` } });
    // O que a tela recebe não tem caminho nem erro técnico, e já diz quanto leva.
    expect(r.animacao).toMatchObject({ estado: "pedida", progresso: null, motivo: null });
    expect(r.animacao.tempoDaPrevia).toBe("uns 2 minutos");
  });

  it("roteiro de outra marca, vídeo longo e roteiro sem texto são recusados com a frase certa", async () => {
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroB })).toMatchObject({ ok: false, codigo: "nao-achou", status: 404 });
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroLongoA })).toMatchObject({ ok: false, codigo: "longo", status: 409 });
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroSemTextoA })).toMatchObject({ ok: false, codigo: "sem-texto", status: 409 });
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: 999999 })).toMatchObject({ ok: false, codigo: "nao-achou" });
    expect(await db().select().from(animacoes)).toEqual([]);
    // A tela nem mostra o chamado onde não serve.
    const [longo] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroLongoA));
    expect(await visaoDaAnimacao({ clienteId: marcaA, roteiro: longo, verComo: false })).toBeNull();
  });

  it("roteiro com espaço para completar entre colchetes é recusado, e a tela sabe quantos faltam; depois de completar, o pedido sai", async () => {
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroComColcheteA })).toMatchObject({ ok: false, codigo: "colchete", status: 409 });
    expect(fraseDaAnimacao("colchete")).toContain("colchetes");
    expect(await db().select().from(animacoes)).toEqual([]);
    expect(estado.enfileirados).toHaveLength(0);
    const [r] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroComColcheteA));
    expect(await visaoDaAnimacao({ clienteId: marcaA, roteiro: r, verComo: false })).toMatchObject({ colchetes: 1, animacao: null });
    // A ação da tela devolve a mesma frase.
    expect(await pedirAnimacaoAction(roteiroComColcheteA)).toEqual({ ok: false, erro: fraseDaAnimacao("colchete") });
    // A pessoa completa o texto (o salvar da edição troca o conteúdo) e o pedido passa, sem nenhum colchete nas cenas.
    await db().update(roteiros).set({ conteudo: { ...CONTEUDO, corpo: "O primeiro erro é deixar de molho a noite toda.\nUma paciente minha trocou de esponja e o prato saiu limpo." } }).where(eq(roteiros.id, roteiroComColcheteA));
    const id = await pedir(marcaA, "an-dono-a", roteiroComColcheteA);
    expect((await linha(id)).cenas.some((c) => c.texto.includes("[") || c.texto.includes("]"))).toBe(false);
  });

  it("roteiro grande que passa dos limites guarda as frases que ficaram de fora, e a vista da prévia entrega a lista (nada de corte mudo)", async () => {
    const r = await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroGrandeA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = await linha(r.animacao.id);
    expect(a.foraDoVideo.length).toBeGreaterThan(0);
    // Cada frase está ou no vídeo ou na lista de fora, nunca nos dois e nunca em lugar nenhum.
    const nasCenas = a.cenas.map((c) => c.texto).join(" ");
    for (let i = 0; i < 80; i++) {
      const frase = `Passo numero ${i} do corpo que explica um detalhe do assunto com calma.`;
      const noVideo = nasCenas.includes(frase);
      const fora = a.foraDoVideo.some((x) => x.includes(frase));
      expect(noVideo !== fora).toBe(true);
    }
    expect(r.animacao.foraDoVideo).toEqual(a.foraDoVideo);
    // O pedido que coube inteiro não tem lista.
    await db().delete(animacoes);
    const pequeno = await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroA });
    expect(pequeno.ok && pequeno.animacao.foraDoVideo).toEqual([]);
  });

  it("uma animação em andamento por marca: o segundo pedido recebe a frase, e o banco também não deixa", async () => {
    const primeiro = await pedir(marcaA, "an-dono-a", roteiroA);
    expect(await pedirAnimacao({ clienteId: marcaA, usuarioId: "an-dono-a", roteiroId: roteiroA2 })).toMatchObject({ ok: false, codigo: "em-andamento", status: 409 });
    // A outra marca não é afetada.
    await expect(pedir(marcaB, "an-dono-b", roteiroB)).resolves.toBeGreaterThan(0);
    // O índice único parcial é a trava de verdade (uma corrida entre dois pedidos não passa pela conferência acima).
    await expect(criar(marcaA, roteiroA2, "pedida")).rejects.toThrow();
    // Depois que a primeira termina, a marca pode pedir outra.
    await db().update(animacoes).set({ estado: "final_pronta" }).where(eq(animacoes.id, primeiro));
    await expect(pedir(marcaA, "an-dono-a", roteiroA2)).resolves.toBeGreaterThan(primeiro);
    // A tela do primeiro roteiro sabe que há outra em andamento.
    const [r1] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroA));
    const visao = await visaoDaAnimacao({ clienteId: marcaA, roteiro: r1, verComo: false });
    expect(visao).toMatchObject({ outraEmAndamento: true, animacao: { id: primeiro, estado: "final_pronta" } });
  });

  it("pedir de novo no mesmo roteiro, depois de pronto, troca o vídeo velho pelo novo e apaga o arquivo velho", async () => {
    const velho = await criar(marcaA, roteiroA, "final_pronta", { caminhoFinal: nomeRelativoDaAnimacao(1, "final") });
    await criarArquivo(nomeRelativoDaAnimacao(1, "final"));
    await db().update(animacoes).set({ caminhoFinal: nomeRelativoDaAnimacao(velho, "final") }).where(eq(animacoes.id, velho));
    await criarArquivo(nomeRelativoDaAnimacao(velho, "final"));
    const novo = await pedir(marcaA, "an-dono-a", roteiroA);
    expect(await linha(velho)).toBeUndefined();
    expect(await arquivosDoVolume()).not.toContain(`an-${velho}-final.mp4`);
    expect((await linha(novo)).estado).toBe("pedida");
  });
});

describe("o ciclo: prévia, aprovar, final, baixar", () => {
  it("a prévia vem primeiro e é entregue com Range; o final só depois do sim; no final a prévia sai e o vídeo ganha 7 dias", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    // Antes da prévia não há arquivo nenhum para ver.
    expect((await previaRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);

    const resumo = await rodarRenderizarAnimacao(id, "previa", { renderizar: motorFalso("0123456789"), ...semFila });
    expect(resumo).toMatchObject({ animacaoId: id, perfil: "previa", estado: "previa_pronta" });
    expect(await linha(id)).toMatchObject({ estado: "previa_pronta", caminhoPrevia: nomeRelativoDaAnimacao(id, "previa"), progresso: null, tentativas: 0 });
    expect(await arquivosDoVolume()).toEqual([`an-${id}-previa.mp4`]);

    const inteira = await previaRota(new Request("http://localhost/x"), contexto(id));
    expect(inteira.status).toBe(200);
    expect(inteira.headers.get("content-type")).toBe("video/mp4");
    expect(await inteira.text()).toBe("0123456789");
    const pedaco = await previaRota(new Request("http://localhost/x", { headers: { range: "bytes=2-4" } }), contexto(id));
    expect(pedaco.status).toBe(206);
    expect(await pedaco.text()).toBe("234");
    // O final ainda não existe, e rodar o final agora não faz nada (não foi aprovado).
    expect((await finalRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);
    expect(await rodarRenderizarAnimacao(id, "final", { renderizar: motorFalso(), ...semFila })).toMatchObject({ pulou: "previa_pronta" });
    expect(estado.enfileirados.filter((e) => (e.dados as { perfil: string }).perfil === "final")).toHaveLength(0);

    // Aprovar: vai para a fila do final, uma vez só mesmo com dois toques.
    estado.enfileirados.length = 0;
    expect(await aprovarAnimacao(marcaA, id)).toMatchObject({ ok: true, animacao: { estado: "fazendo_final" } });
    expect(await aprovarAnimacao(marcaA, id)).toMatchObject({ ok: false, codigo: "nao-e-a-hora", status: 409 });
    expect(estado.enfileirados).toHaveLength(1);
    expect(estado.enfileirados[0]).toMatchObject({ dados: { animacaoId: id, perfil: "final" }, opcoes: { singletonKey: `animacao-final-${id}-0` } });
    // A prévia continua tocando enquanto o final é feito.
    expect((await previaRota(new Request("http://localhost/x"), contexto(id))).status).toBe(200);

    const antes = Date.now();
    expect(await rodarRenderizarAnimacao(id, "final", { renderizar: motorFalso("FINAL-OK"), ...semFila })).toMatchObject({ estado: "final_pronta", perfil: "final" });
    const pronta = await linha(id);
    expect(pronta).toMatchObject({ estado: "final_pronta", caminhoFinal: nomeRelativoDaAnimacao(id, "final"), caminhoPrevia: null, progresso: null });
    expect(pronta.finalExpiraEm!.getTime()).toBeGreaterThanOrEqual(antes + GUARDA_DO_FINAL_MS - 1000);
    expect(await arquivosDoVolume()).toEqual([`an-${id}-final.mp4`]);

    expect((await previaRota(new Request("http://localhost/x"), contexto(id))).status).toBe(404);
    const baixar = await finalRota(new Request("http://localhost/x?baixar=1"), contexto(id));
    expect(baixar.status).toBe(200);
    expect(baixar.headers.get("content-disposition")).toContain("video-em-animacao.mp4");
    expect(await baixar.text()).toBe("FINAL-OK");
    const status = await statusRota(new Request("http://localhost/x"), contexto(id));
    expect(await status.json()).toMatchObject({ id, estado: "final_pronta" });
  });

  it("com a função desligada (chave geral ou marca fora da lista) o job pula sem reservar, sem gastar tentativa e sem chamar o motor", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    let motorChamado = 0;
    const motor = async (entrada: EntradaDaAnimacao) => {
      motorChamado += 1;
      return motorFalso()(entrada);
    };
    process.env.ANIMACAO_ATIVA = "0";
    expect(await rodarRenderizarAnimacao(id, "previa", { renderizar: motor, ...semFila })).toMatchObject({ pulou: "desligada" });
    liberar(marcaB);
    expect(await rodarRenderizarAnimacao(id, "previa", { renderizar: motor, ...semFila })).toMatchObject({ pulou: "desligada" });
    expect(motorChamado).toBe(0);
    expect(await linha(id)).toMatchObject({ estado: "pedida", tentativas: 0 });
    liberar(marcaA);
    await rodarRenderizarAnimacao(id, "previa", { renderizar: motor, ...semFila });
    expect(motorChamado).toBe(1);
  });

  it("duas execuções do mesmo passo nunca montam o vídeo duas vezes", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    let chamadas = 0;
    const lento = async (entrada: EntradaDaAnimacao) => {
      chamadas += 1;
      await new Promise((r) => setTimeout(r, 150));
      return motorFalso()(entrada);
    };
    const [a, b] = await Promise.all([rodarRenderizarAnimacao(id, "previa", { renderizar: lento, ...semFila }), rodarRenderizarAnimacao(id, "previa", { renderizar: lento, ...semFila })]);
    expect(chamadas).toBe(1);
    expect([a, b].filter((r) => "pulou" in r)).toHaveLength(1);
  });

  it("'Agora não' na prévia apaga a animação e o arquivo; no meio de uma montagem não dispensa", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    expect(await dispensarAnimacao(marcaA, id)).toMatchObject({ ok: false, codigo: "nao-e-a-hora" });
    await rodarRenderizarAnimacao(id, "previa", { renderizar: motorFalso(), ...semFila });
    expect(await arquivosDoVolume()).toHaveLength(1);
    expect(await dispensarAnimacao(marcaA, id)).toEqual({ ok: true });
    expect(await linha(id)).toBeUndefined();
    expect(await arquivosDoVolume()).toEqual([]);
    // E a marca já pode pedir outra.
    await expect(pedir(marcaA, "an-dono-a", roteiroA)).resolves.toBeGreaterThan(id);
  });

  it("o andamento da montagem chega à linha enquanto o motor trabalha", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    let visto: number | null = null;
    const motor = async (entrada: EntradaDaAnimacao) => {
      entrada.aoProgredir?.(40);
      // Espera pela condição (o andamento chegar à linha), com prazo, em vez de um tempo fixo que depende da máquina.
      const prazo = Date.now() + 10_000;
      visto = (await linha(id)).progresso;
      while (visto !== 40 && Date.now() < prazo) {
        await new Promise((r) => setTimeout(r, 25));
        visto = (await linha(id)).progresso;
      }
      return motorFalso()(entrada);
    };
    await rodarRenderizarAnimacao(id, "previa", { renderizar: motor, ...semFila });
    expect(visto).toBe(40);
    expect((await linha(id)).progresso).toBeNull();
  });
});

describe("isolamento entre marcas", () => {
  it("a marca B não vê, não toca, não aprova, não dispensa nem tenta de novo a animação da marca A", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    await rodarRenderizarAnimacao(id, "previa", { renderizar: motorFalso("segredo-da-marca-A"), ...semFila });
    entrar("an-dono-b");
    for (const rota of [statusRota, previaRota, finalRota]) {
      const r = await rota(new Request("http://localhost/x"), contexto(id));
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain("segredo-da-marca-A");
    }
    expect(await arquivoDaAnimacaoParaVer(marcaB, id, "previa")).toBeNull();
    expect(await aprovarAnimacao(marcaB, id)).toMatchObject({ ok: false, status: 404 });
    expect(await dispensarAnimacao(marcaB, id)).toMatchObject({ ok: false, status: 404 });
    expect(await tentarAnimacaoDeNovo(marcaB, id)).toMatchObject({ ok: false, status: 404 });
    // As ações usam a marca da sessão (B), nunca um parâmetro.
    expect(await aprovarAnimacaoAction(id)).toEqual({ ok: false, erro: fraseDaAnimacao("nao-achou") });
    expect(await dispensarAnimacaoAction(id)).toEqual({ ok: false, erro: fraseDaAnimacao("nao-achou") });
    expect(await tentarAnimacaoDeNovoAction(id)).toEqual({ ok: false, erro: fraseDaAnimacao("nao-achou") });
    // O roteiro de A também não vira vídeo de B.
    expect(await pedirAnimacaoAction(roteiroA)).toEqual({ ok: false, erro: fraseDaAnimacao("nao-achou") });
    // Nada mudou para A.
    expect((await linha(id)).estado).toBe("previa_pronta");
    // A tela de B, no roteiro de B, não mostra a animação de A.
    const [rb] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroB));
    expect(await visaoDaAnimacao({ clienteId: marcaB, roteiro: rb, verComo: false })).toMatchObject({ animacao: null, outraEmAndamento: false });
  });

  it("o pedido pela ação segue o fluxo da marca da sessão", async () => {
    const r = await pedirAnimacaoAction(roteiroA);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.dado.animacao) return;
    expect((await linha(r.dado.animacao.id)).clienteId).toBe(marcaA);
  });
});

describe("o ver como só lê", () => {
  it("as ações e os arquivos recusam; a tela recebe a vista com o aviso de leitura", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    await rodarRenderizarAnimacao(id, "previa", { renderizar: motorFalso(), ...semFila });
    estado.verComo = true;
    expect(await pedirAnimacaoAction(roteiroA2)).toEqual({ ok: false, erro: "Desligado no modo ver como." });
    expect(await aprovarAnimacaoAction(id)).toEqual({ ok: false, erro: "Desligado no modo ver como." });
    expect(await dispensarAnimacaoAction(id)).toEqual({ ok: false, erro: "Desligado no modo ver como." });
    expect(await tentarAnimacaoDeNovoAction(id)).toEqual({ ok: false, erro: "Desligado no modo ver como." });
    expect((await previaRota(new Request("http://localhost/x"), contexto(id))).status).toBe(403);
    expect((await finalRota(new Request("http://localhost/x"), contexto(id))).status).toBe(403);
    // Ler o andamento pode (a vista é a da pessoa, sem caminho de arquivo).
    const status = await statusRota(new Request("http://localhost/x"), contexto(id));
    expect(status.status).toBe(200);
    const corpo = JSON.stringify(await status.json());
    expect(corpo).not.toContain("animacao/");
    const [r1] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroA));
    expect(await visaoDaAnimacao({ clienteId: marcaA, roteiro: r1, verComo: true })).toMatchObject({ verComo: true, animacao: { id, estado: "previa_pronta" } });
    expect((await linha(id)).estado).toBe("previa_pronta");
  });
});

describe("a falha", () => {
  it("a primeira falha volta para a vez e reenfileira em 30 segundos; a segunda vira 'falhou' com frase sem jargão, e o erro técnico só no log", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    const fila: { id: number; perfil: string; s: number }[] = [];
    const deps = { renderizar: motorQueFalha(), enfileirar: async (i: number, perfil: string, s: number) => void fila.push({ id: i, perfil, s }) };

    await expect(rodarRenderizarAnimacao(id, "previa", deps)).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "pedida", progresso: null, tentativas: 1, motivo: null });
    expect(fila).toEqual([{ id, perfil: "previa", s: 30 }]);
    expect(await arquivosDoVolume()).toEqual([]);

    await expect(rodarRenderizarAnimacao(id, "previa", deps)).rejects.toThrow();
    const falhou = await linha(id);
    expect(falhou).toMatchObject({ estado: "falhou", progresso: null, tentativas: TENTATIVAS_DA_ANIMACAO, codigoDoErro: "navegador", motivo: fraseDaAnimacao("nao-montou") });
    expect(fila).toHaveLength(1);
    expect(await arquivosDoVolume()).toEqual([]);
    // A pessoa só vê a frase; nada de jargão nem do texto da falha.
    expect(falhou.motivo).not.toMatch(/TEXTO-SECRETO|ffmpeg|chromium|navegador|render|fila|erro \d+/i);
    const status = await (await statusRota(new Request("http://localhost/x"), contexto(id))).json();
    expect(status.motivo).toBe(fraseDaAnimacao("nao-montou"));
    expect(JSON.stringify(status)).not.toContain("navegador");
    // O log leva o código e o nome, nunca a mensagem do motor (que pode ter texto da pessoa).
    expect(JSON.stringify(estado.logs)).not.toContain("TEXTO-SECRETO");
    expect(estado.logs.some((l) => JSON.stringify(l).includes('"codigo":"navegador"'))).toBe(true);
    expect(estado.logs.some((l) => JSON.stringify(l).includes("animacao: o render nao terminou"))).toBe(true);
  });

  it("entrada inválida falha na hora, sem gastar uma segunda tentativa", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    const fila: number[] = [];
    await expect(rodarRenderizarAnimacao(id, "previa", { renderizar: motorQueFalha("entrada"), enfileirar: async (i) => void fila.push(i) })).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "falhou", codigoDoErro: "entrada" });
    expect(fila).toEqual([]);
  });

  it("'Tentar de novo' depois de falhar na prévia recomeça pela prévia; depois de falhar no final, volta direto ao final", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    await db().update(animacoes).set({ estado: "falhou", motivo: fraseDaAnimacao("nao-montou"), codigoDoErro: "ffmpeg", tentativas: 2 }).where(eq(animacoes.id, id));
    estado.enfileirados.length = 0;
    expect(await tentarAnimacaoDeNovo(marcaA, id)).toMatchObject({ ok: true, animacao: { estado: "pedida", motivo: null } });
    expect(await linha(id)).toMatchObject({ estado: "pedida", tentativas: 0, codigoDoErro: null, motivo: null });
    expect(estado.enfileirados[0]).toMatchObject({ dados: { animacaoId: id, perfil: "previa" } });
    // Fora do estado 'falhou' não faz nada.
    expect(await tentarAnimacaoDeNovo(marcaA, id)).toMatchObject({ ok: false, codigo: "nao-e-a-hora" });

    // Falha no final: a prévia já tinha sido aprovada e continua guardada.
    await criarArquivo(nomeRelativoDaAnimacao(id, "previa"));
    await db().update(animacoes).set({ estado: "previa_pronta", caminhoPrevia: nomeRelativoDaAnimacao(id, "previa") }).where(eq(animacoes.id, id));
    await aprovarAnimacao(marcaA, id);
    const fila: string[] = [];
    const deps = { renderizar: motorQueFalha(), enfileirar: async (_i: number, p: string) => void fila.push(p) };
    await expect(rodarRenderizarAnimacao(id, "final", deps)).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "fazendo_final", progresso: null, tentativas: 1 });
    await expect(rodarRenderizarAnimacao(id, "final", deps)).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "falhou", caminhoPrevia: nomeRelativoDaAnimacao(id, "previa") });
    estado.enfileirados.length = 0;
    expect(await tentarAnimacaoDeNovo(marcaA, id)).toMatchObject({ ok: true, animacao: { estado: "fazendo_final" } });
    expect(estado.enfileirados[0]).toMatchObject({ dados: { animacaoId: id, perfil: "final" } });
  });

  it("'Tentar de novo' não passa por cima do limite de uma em andamento por marca", async () => {
    const falha = await criar(marcaA, roteiroA, "falhou", { motivo: fraseDaAnimacao("nao-montou") });
    await criar(marcaA, roteiroA2, "previa_pronta");
    expect(await tentarAnimacaoDeNovo(marcaA, falha)).toMatchObject({ ok: false, codigo: "em-andamento", status: 409 });
    expect((await linha(falha)).estado).toBe("falhou");
  });

  it("com o disco do servidor em nível crítico a animação espera a vez sem gastar tentativa e volta em 10 minutos", async () => {
    const id = await pedir(marcaA, "an-dono-a", roteiroA);
    const fila: { perfil: string; s: number }[] = [];
    const disco = { medir: async () => ({ usadoPercentual: 95 }), limites: { atencao: 80, critico: 90 }, limparAgora: async () => undefined };
    const resumo = await rodarRenderizarAnimacao(id, "previa", { renderizar: motorFalso(), enfileirar: async (_i, perfil, s) => void fila.push({ perfil, s }), disco });
    expect(resumo).toMatchObject({ pulou: "disco-cheio" });
    expect(await linha(id)).toMatchObject({ estado: "pedida", tentativas: 0 });
    expect(fila).toEqual([{ perfil: "previa", s: 600 }]);
    expect(await arquivosDoVolume()).toEqual([]);
  });
});

describe("a limpeza (a de hora em hora que já existe)", () => {

  it("o final passou dos 7 dias, a prévia de 48 horas e a falha de 7 dias saem, com os arquivos; o que está dentro do prazo fica", async () => {
    const agora = new Date("2026-12-10T12:00:00Z");
    const mk = async (roteiro: number, marca: number, estadoInicial: "final_pronta" | "previa_pronta" | "falhou", extra: Partial<typeof animacoes.$inferInsert>, tipo?: "previa" | "final") => {
      const id = await criar(marca, roteiro, estadoInicial, extra);
      if (tipo) {
        const relativo = nomeRelativoDaAnimacao(id, tipo);
        await criarArquivo(relativo);
        await db().update(animacoes).set(tipo === "previa" ? { caminhoPrevia: relativo } : { caminhoFinal: relativo }).where(eq(animacoes.id, id));
      }
      return id;
    };
    const finalVencido = await mk(roteiroA, marcaA, "final_pronta", { finalExpiraEm: new Date(agora.getTime() - 1000) }, "final");
    const finalNoPrazo = await mk(roteiroB, marcaB, "final_pronta", { finalExpiraEm: new Date(agora.getTime() + 3600_000) }, "final");
    const previaVelha = await mk(roteiroA2, marcaA, "previa_pronta", { atualizadaEm: new Date(agora.getTime() - GUARDA_DA_PREVIA_MS - 1000) }, "previa");
    const falhaVelha = await mk(roteiroLongoA, marcaA, "falhou", { atualizadaEm: new Date(agora.getTime() - GUARDA_DA_FALHA_MS - 1000) });
    const resumo = await limparAnimacoes(agora, semFila);
    expect(resumo.animacoesApagadas).toBe(3);
    expect(await linha(finalVencido)).toBeUndefined();
    expect(await linha(previaVelha)).toBeUndefined();
    expect(await linha(falhaVelha)).toBeUndefined();
    expect(await linha(finalNoPrazo)).toBeDefined();
    expect(await arquivosDoVolume()).toEqual([`an-${finalNoPrazo}-final.mp4`]);
  });

  it("a montagem sem sinal volta para a vez e é enfileirada; na última tentativa falha; o pedido esquecido é enfileirado de novo", async () => {
    const agora = new Date("2026-12-10T12:00:00Z");
    const velho = new Date(agora.getTime() - 41 * 60_000);
    const parada = await criar(marcaA, roteiroA, "fazendo_previa", { progresso: 30, tentativas: 1, atualizadaEm: velho });
    const paradaNaUltima = await criar(marcaB, roteiroB, "fazendo_final", { progresso: 30, tentativas: 2, atualizadaEm: velho });
    const fila: { id: number; perfil: string }[] = [];
    const enfileirar = async (id: number, perfil: string) => void fila.push({ id, perfil });
    const resumo = await limparAnimacoes(agora, { enfileirar: enfileirar as never });
    expect(resumo).toMatchObject({ animacoesDevolvidas: 1, animacoesDesistidas: 1 });
    expect(await linha(parada)).toMatchObject({ estado: "pedida", progresso: null });
    expect(await linha(paradaNaUltima)).toMatchObject({ estado: "falhou", codigoDoErro: "parou", motivo: fraseDaAnimacao("nao-montou") });
    expect(fila).toContainEqual({ id: parada, perfil: "previa" });

    // Esperando a vez há mais de 10 minutos: enfileira de novo (sem mexer no estado).
    fila.length = 0;
    await db().update(animacoes).set({ atualizadaEm: new Date(agora.getTime() - 11 * 60_000) }).where(eq(animacoes.id, parada));
    const r2 = await limparAnimacoes(agora, { enfileirar: enfileirar as never });
    expect(r2.animacoesReenfileiradas).toBe(1);
    expect(fila).toEqual([{ id: parada, perfil: "previa" }]);
    expect((await linha(parada)).estado).toBe("pedida");
  });

  it("com a função desligada a limpeza não devolve nem enfileira o que está parado ou esquecido, mas continua apagando o que venceu", async () => {
    const agora = new Date("2026-12-10T12:00:00Z");
    const velho = new Date(agora.getTime() - 41 * 60_000);
    const parada = await criar(marcaA, roteiroA, "fazendo_previa", { progresso: 30, tentativas: 1, atualizadaEm: velho });
    const esquecida = await criar(marcaB, roteiroB, "pedida", { atualizadaEm: velho });
    const vencida = await criar(marcaC, roteiroA2, "final_pronta", { finalExpiraEm: new Date(agora.getTime() - 1000) });
    const fila: number[] = [];
    process.env.ANIMACAO_ATIVA = "0";
    const resumo = await limparAnimacoes(agora, { enfileirar: (async (id: number) => void fila.push(id)) as never });
    expect(resumo).toMatchObject({ animacoesApagadas: 1, animacoesDevolvidas: 0, animacoesReenfileiradas: 0 });
    expect(fila).toEqual([]);
    expect(await linha(parada)).toMatchObject({ estado: "fazendo_previa", progresso: 30 });
    expect(await linha(esquecida)).toMatchObject({ estado: "pedida" });
    expect(await linha(vencida)).toBeUndefined();
  });

  it("varre a pasta: arquivo sem linha e .parte velho saem; o que tem dono e o que é novo ficam", async () => {
    const agora = new Date();
    const id = await criar(marcaA, roteiroA, "previa_pronta", { caminhoPrevia: nomeRelativoDaAnimacao(7777, "previa") });
    await criarArquivo(nomeRelativoDaAnimacao(7777, "previa"));
    await criarArquivo("animacao/an-9999-final.mp4");
    await criarArquivo("animacao/an-9998-final.mp4");
    await criarArquivo("animacao/an-5.aabbccddeeff.parte");
    await criarArquivo("animacao/guardado-por-outra-coisa.txt");
    const velho = new Date(agora.getTime() - 3_600_000);
    for (const nome of ["an-9999-final.mp4", "an-5.aabbccddeeff.parte", "an-7777-previa.mp4", "guardado-por-outra-coisa.txt"]) await utimes(join(volume, "animacao", nome), velho, velho);
    const resumo = await limparAnimacoes(agora, semFila);
    expect(resumo).toMatchObject({ animacoesArquivosSemDono: 1, animacoesPartesVelhas: 1 });
    expect(await arquivosDoVolume()).toEqual(["an-7777-previa.mp4", "an-9998-final.mp4", "guardado-por-outra-coisa.txt"]);
    expect(await linha(id)).toBeDefined();
  });

  it("a limpeza de hora em hora da edição chama a da animação e devolve os números dela", async () => {
    await criar(marcaA, roteiroA, "final_pronta", { finalExpiraEm: new Date(Date.now() - 1000) });
    const resumo = await rodarLimparEdicoes({ enfileirar: async () => undefined, enfileirarDecisao: async () => undefined, enfileirarRender: async () => undefined });
    expect(resumo.animacoesApagadas).toBe(1);
    expect(await db().select().from(animacoes)).toEqual([]);
  });

  it("na partida do contêiner de render, o que ficou no meio volta para a vez e é enfileirado", async () => {
    const previa = await criar(marcaA, roteiroA, "fazendo_previa", { progresso: 10, tentativas: 1 });
    const final = await criar(marcaB, roteiroB, "fazendo_final", { progresso: 10, tentativas: 1 });
    const espera = await criar(marcaC, roteiroA2, "fazendo_final", { progresso: null });
    const fila: { id: number; perfil: string }[] = [];
    expect(await recolherAnimacoesOrfas({ enfileirar: async (id, perfil) => void fila.push({ id, perfil }) })).toBe(2);
    expect(await linha(previa)).toMatchObject({ estado: "pedida", progresso: null });
    expect(await linha(final)).toMatchObject({ estado: "fazendo_final", progresso: null });
    expect(await linha(espera)).toMatchObject({ estado: "fazendo_final", progresso: null });
    expect(fila.sort((a, b) => a.id - b.id)).toEqual([
      { id: previa, perfil: "previa" },
      { id: final, perfil: "final" },
    ]);
  });
});

describe("a partida do contêiner de render com tentativas esgotadas", () => {
  it("quem já gastou todas as tentativas e estava no meio vira falhou (não volta para a fila: laço de memória)", async () => {
    const previa = await criar(marcaA, roteiroA, "fazendo_previa", { progresso: 10, tentativas: 2 });
    const final = await criar(marcaB, roteiroB, "fazendo_final", { progresso: 10, tentativas: 2 });
    const viva = await criar(marcaC, roteiroA2, "fazendo_previa", { progresso: 10, tentativas: 1 });
    const fila: number[] = [];
    expect(await recolherAnimacoesOrfas({ enfileirar: async (id) => void fila.push(id) })).toBe(1);
    expect(await linha(previa)).toMatchObject({ estado: "falhou", progresso: null, motivo: fraseDaAnimacao("nao-montou"), codigoDoErro: "parou" });
    expect(await linha(final)).toMatchObject({ estado: "falhou", progresso: null, motivo: fraseDaAnimacao("nao-montou") });
    expect(await linha(viva)).toMatchObject({ estado: "pedida" });
    expect(fila).toEqual([viva]);
  });
});

describe("o motor de verdade", () => {
  it("a prévia de 2 segundos sai pelo caminho completo da fila: 540 por 960, abre no ffprobe e vira previa_pronta", async () => {
    const [a] = await db()
      .insert(animacoes)
      .values({ clienteId: marcaA, roteiroId: roteiroA, estado: "pedida", molde: "tipografico-1", cenas: [{ texto: "Você sabia disso?", duracaoS: 2 }], duracaoS: "2.000" })
      .returning({ id: animacoes.id });
    const resumo = await rodarRenderizarAnimacao(a.id, "previa", semFila);
    expect(resumo).toMatchObject({ estado: "previa_pronta" });
    const depois = await linha(a.id);
    expect(depois).toMatchObject({ estado: "previa_pronta", caminhoPrevia: nomeRelativoDaAnimacao(a.id, "previa") });
    const caminho = join(volume, "animacao", `an-${a.id}-previa.mp4`);
    const sonda = await sondarSaida(caminho);
    expect(sonda.largura).toBe(540);
    expect(sonda.altura).toBe(960);
    expect(Math.abs(sonda.duracaoS - 2)).toBeLessThan(0.2);
    expect((await stat(caminho)).size).toBeGreaterThan(1000);
    const cabecalho = (await readFile(caminho)).subarray(4, 8).toString("latin1");
    expect(cabecalho).toBe("ftyp");
    expect(await arquivosDoVolume()).toEqual([`an-${a.id}-previa.mp4`]);
  }, 120_000);
});
