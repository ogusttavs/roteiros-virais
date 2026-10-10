/**
 * A pergunta do público presa ao Tema livre (E28, parte 3), contra o Postgres real e com o simulador de IA: a chave que vem do navegador é achada de novo nas vozes DO SETOR da marca (e só
 * enquanto passa do piso e a leitura vale); o roteiro guarda a cópia, a nota e o roteiro a recebem como dado datado, a reescrita mantém a pergunta de origem, e a chave de outro setor, a
 * desconhecida e a leitura velha viram um tema livre comum.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, noticias, roteiros, tendenciasBrasil, user, type VozesDoSetor } from "@/db/schema";
import * as verificador from "@/ia/verificador";
import { diaPorExtenso } from "@/servicos/noticias-assuntos";
import { gerarRoteiro, reprovarERescrever } from "@/servicos/roteiro";
import { avaliarTema } from "@/servicos/temas";
import { chaveDoAssunto } from "@/servicos/tendencias";
import { gerarOutraVersao, gerarVersoes } from "@/servicos/versoes";
import { chaveDaVoz, perguntaDoPublicoPelaChave, perguntasDaTelaSemFalha } from "@/servicos/vozes-do-publico";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para o verificador de verdade, mas deixa ver o que cada tarefa recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

const DIA_MS = 24 * 60 * 60 * 1000;
const PERGUNTA = "Serve em tecido de camurça?";
const RESPOSTA = "Serve, mas só depois de testar num canto escondido, com pouco produto e pano seco";

let nichoId: number;
let outroNichoId: number;
let clienteId: number;
const CHAVE = chaveDaVoz("duvida", PERGUNTA);

const voz = (texto: string, vezes: number) => ({ texto, vezes, videos: [1, 2], plataformas: ["youtube" as const] });
const vozes = (duvidas: ReturnType<typeof voz>[], objecoes: ReturnType<typeof voz>[] = []): VozesDoSetor => ({ duvidas, objecoes, pedidos: [], videos: 12, comentarios: 840, plataformas: ["youtube"] });

async function porVozes(setor: number, v: VozesDoSetor | null, vozesEm: Date | null = new Date()) {
  await db().update(nichos).set({ vozes: v, vozesEm: v ? vozesEm : null }).where(eq(nichos.id, setor));
}

function ultimaChamada(tarefa: "roteiro" | "avaliarTema") {
  const chamadas = vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === tarefa);
  expect(chamadas.length).toBeGreaterThan(0);
  const [params] = chamadas[chamadas.length - 1];
  return { entrada: String(params.entrada), fontes: String(params.fontesDosFatos ?? "") };
}

beforeAll(async () => {
  await resetarSchema(db());
  // O outro setor nasce primeiro (id menor): uma busca que esquecesse o setor da marca pegaria o dele.
  const [outro] = await db().insert(nichos).values({ slug: "pergunta-presa-outro", nome: "Outro setor", termos: ["outro"] }).returning();
  const [nicho] = await db().insert(nichos).values({ slug: "pergunta-presa", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  outroNichoId = outro.id;
  nichoId = nicho.id;
  await db().insert(user).values({ id: "pp-usuario", name: "Marca", email: "pp@exemplo.teste" });
  const [marca] = await db().insert(clientes).values({ usuarioId: "pp-usuario", nome: "Marca", nichoId }).returning();
  clienteId = marca.id;
  await db().insert(briefings).values({
    clienteId,
    completo: true,
    perfil: {
      fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [] },
      resumo: "produtos de limpeza",
      referencias: [],
    } as never,
  });
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await porVozes(nichoId, vozes([voz(PERGUNTA, 14)], [voz("A mancha voltou depois de secar", 7)]));
  await porVozes(outroNichoId, null);
  vi.mocked(verificador.gerarComVerificacao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("perguntaDoPublicoPelaChave", () => {
  it("acha a voz do setor da marca e devolve a cópia que o roteiro guarda, com o dia da leitura", async () => {
    const quando = new Date(Date.now() - 2 * DIA_MS);
    await porVozes(nichoId, vozes([voz(PERGUNTA, 14)]), quando);
    const pergunta = await perguntaDoPublicoPelaChave(nichoId, CHAVE);
    expect(pergunta).toEqual({ chave: CHAVE, tipo: "duvida", texto: PERGUNTA, vezes: 14, plataformas: ["youtube"], lidaEm: quando.toISOString() });
  });

  it("chave que não é de nenhuma voz, voz abaixo do piso, leitura velha, setor sem vozes e chave vazia dão nulo", async () => {
    expect(await perguntaDoPublicoPelaChave(nichoId, "000000000000")).toBeNull();
    expect(await perguntaDoPublicoPelaChave(nichoId, undefined)).toBeNull();
    expect(await perguntaDoPublicoPelaChave(null, CHAVE)).toBeNull();
    await porVozes(nichoId, vozes([voz(PERGUNTA, 4)]));
    expect(await perguntaDoPublicoPelaChave(nichoId, CHAVE)).toBeNull();
    await porVozes(nichoId, vozes([voz(PERGUNTA, 14)]), new Date(Date.now() - 20 * DIA_MS));
    expect(await perguntaDoPublicoPelaChave(nichoId, CHAVE)).toBeNull();
    await porVozes(nichoId, null);
    expect(await perguntaDoPublicoPelaChave(nichoId, CHAVE)).toBeNull();
  });

  it("a voz sem plataforma gravada (uma leitura antiga) herda a do setor: nunca fica sem dizer de onde vem", async () => {
    const semPlataforma = { texto: PERGUNTA, vezes: 14, videos: [1, 2] } as never;
    await porVozes(nichoId, { ...vozes([]), duvidas: [semPlataforma] });
    expect((await perguntaDoPublicoPelaChave(nichoId, CHAVE))?.plataformas).toEqual(["youtube"]);
  });

  it("a voz de OUTRO setor nunca vale para esta marca", async () => {
    await porVozes(nichoId, null);
    await porVozes(outroNichoId, vozes([voz(PERGUNTA, 14)]));
    expect(await perguntaDoPublicoPelaChave(nichoId, CHAVE)).toBeNull();
  });
});

describe("perguntasDaTelaSemFalha (as telas)", () => {
  it("devolve até três, as que passaram do piso, com a quantos vídeos, de que plataforma e o dia da leitura por extenso", async () => {
    const quando = new Date(Date.now() - 2 * DIA_MS);
    await porVozes(
      nichoId,
      vozes([voz(PERGUNTA, 14), voz("Quanto tempo tem que esperar?", 9), voz("Tem em galão?", 6), voz("Pergunta de quatro comentários?", 4)], [voz("A mancha voltou depois de secar", 7)]),
      quando,
    );
    const dados = await perguntasDaTelaSemFalha(nichoId);
    expect(dados).not.toBeNull();
    expect(dados!.perguntas.map((p) => [p.texto, p.vezes, p.tipo])).toEqual([
      [PERGUNTA, 14, "duvida"],
      ["Quanto tempo tem que esperar?", 9, "duvida"],
      ["A mancha voltou depois de secar", 7, "objecao"],
    ]);
    expect(dados!.videos).toBe(12);
    expect(dados!.plataformas).toEqual(["youtube"]);
    expect(dados!.lidasEm).toBe(diaPorExtenso(quando));
  });

  it("sem leitura, com a leitura velha, sem nenhuma que passou do piso, sem setor ou malformada: nulo, sem lançar", async () => {
    await porVozes(nichoId, null);
    expect(await perguntasDaTelaSemFalha(nichoId)).toBeNull();
    await porVozes(nichoId, vozes([voz(PERGUNTA, 14)]), new Date(Date.now() - 20 * DIA_MS));
    expect(await perguntasDaTelaSemFalha(nichoId)).toBeNull();
    await porVozes(nichoId, vozes([voz(PERGUNTA, 4)]));
    expect(await perguntasDaTelaSemFalha(nichoId)).toBeNull();
    expect(await perguntasDaTelaSemFalha(null)).toBeNull();
    await db().update(nichos).set({ vozes: { videos: 1 } as never, vozesEm: new Date() }).where(eq(nichos.id, nichoId));
    expect(await perguntasDaTelaSemFalha(nichoId)).toBeNull();
  });
});

describe("o roteiro que responde a uma pergunta do público", () => {
  it("guarda a cópia da pergunta e a entrada traz o bloco datado, sem o bloco geral das vozes", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE });
    expect(roteiro.perguntaDoPublico).toMatchObject({ chave: CHAVE, tipo: "duvida", texto: PERGUNTA, vezes: 14, plataformas: ["youtube"] });

    const { entrada, fontes } = ultimaChamada("roteiro");
    expect(entrada).toContain("A pessoa quer responder em vídeo esta pergunta, lida nos comentários de vídeos do YouTube do setor em");
    expect(entrada).toContain(`<pergunta_do_publico>${PERGUNTA}</pergunta_do_publico>`);
    expect(entrada).toContain("com 14 comentários.");
    expect(entrada).toContain(`O tema escolhido acima é a resposta dela`);
    expect(entrada).not.toContain("vozes_do_publico");
    expect(fontes).toContain(`${PERGUNTA} (14 comentários)`);
    const dia = diaPorExtenso(new Date(roteiro.perguntaDoPublico!.lidaEm));
    expect(entrada).toContain(`em ${dia}`);
  });

  it("sem a chave, o roteiro é o de antes: nenhuma cópia, e o bloco geral das vozes continua", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance" });
    expect(roteiro.perguntaDoPublico).toBeNull();
    const { entrada } = ultimaChamada("roteiro");
    expect(entrada).not.toContain("quer responder em vídeo");
    expect(entrada).toContain("vozes_do_publico");
  });

  it("chave desconhecida, de outro setor ou de leitura velha: tema livre comum, sem erro e sem cópia", async () => {
    const desconhecida = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: "000000000000" });
    expect(desconhecida.perguntaDoPublico).toBeNull();

    await porVozes(nichoId, null);
    await porVozes(outroNichoId, vozes([voz(PERGUNTA, 14)]));
    const deOutroSetor = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE });
    expect(deOutroSetor.perguntaDoPublico).toBeNull();
    expect(ultimaChamada("roteiro").entrada).not.toContain(PERGUNTA);

    await porVozes(outroNichoId, null);
    await porVozes(nichoId, vozes([voz(PERGUNTA, 14)]), new Date(Date.now() - 20 * DIA_MS));
    const velha = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE });
    expect(velha.perguntaDoPublico).toBeNull();
  });

  it("a reescrita mantém a pergunta de origem, mesmo que a leitura de hoje não tenha mais a mesma voz", async () => {
    const primeiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE });
    await porVozes(nichoId, vozes([voz("Outra pergunta que apareceu depois?", 20)]));
    vi.mocked(verificador.gerarComVerificacao).mockClear();

    const novo = await reprovarERescrever(primeiro.id, ["gancho_fraco"]);
    expect(novo.perguntaDoPublico).toMatchObject({ chave: CHAVE, texto: PERGUNTA, vezes: 14 });
    const { entrada } = ultimaChamada("roteiro");
    expect(entrada).toContain(`<pergunta_do_publico>${PERGUNTA}</pergunta_do_publico>`);
    expect(entrada).not.toContain("Outra pergunta que apareceu depois?");
  });

  it("'Gerar outra' escreve a mesma pergunta, mesmo que a leitura mude depois das três primeiras", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE }, 1);
    expect(versoes).toHaveLength(1);
    expect(ultimaChamada("roteiro").entrada).toContain(`<pergunta_do_publico>${PERGUNTA}</pergunta_do_publico>`);

    // a leitura da semana seguinte já não tem a voz (e tem outra): o grupo continua respondendo à pergunta que a pessoa escolheu
    await porVozes(nichoId, vozes([voz("Outra pergunta que apareceu depois?", 20)]));
    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await gerarOutraVersao(clienteId, grupo);

    const { entrada } = ultimaChamada("roteiro");
    expect(entrada).toContain(`<pergunta_do_publico>${PERGUNTA}</pergunta_do_publico>`);
    expect(entrada).toContain("com 14 comentários.");
    expect(entrada).not.toContain("Outra pergunta que apareceu depois?");
  });

  it("o assunto em alta que ainda está na lista tem a vez antes: o roteiro nasce do momento e a pergunta fica de fora", async () => {
    await db().delete(tendenciasBrasil);
    await db()
      .insert(tendenciasBrasil)
      .values({
        coletadaEm: new Date(Date.now() - 60_000),
        assunto: "Frente fria",
        chave: chaveDoAssunto("Frente fria"),
        termos: ["frente fria"],
        fontes: [{ fonte: "google" as const, titulo: "frente fria", url: "https://g1.globo.com/a", trafego: "2000+", posicao: 1 }],
        posicao: 1,
        sensivel: false,
      });
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE, assuntoEmAlta: chaveDoAssunto("Frente fria") });
    expect(roteiro.temaDoMomento).not.toBeNull();
    expect(roteiro.perguntaDoPublico).toBeNull();
    expect(ultimaChamada("roteiro").entrada).not.toContain("quer responder em vídeo");
    await db().delete(tendenciasBrasil);
  });

  it("uma voz que só pede (pedido) nunca vira a pergunta presa de um roteiro", async () => {
    const pedido = { texto: "Quero ver um vídeo de cada produto", vezes: 12, videos: [1, 2], plataformas: ["youtube" as const] };
    await porVozes(nichoId, { ...vozes([voz(PERGUNTA, 14)]), pedidos: [pedido] });
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: chaveDaVoz("pedido", pedido.texto) });
    // o pedido existe nas vozes, mas a tela só oferece dúvidas e reclamações: a chave dele não prende nada se alguém a forjar
    expect(roteiro.perguntaDoPublico).toBeNull();
  });

  it("uma origem só por roteiro: com uma notícia presa a pergunta fica de fora; sem a notícia achada, vale", async () => {
    const [noticia] = await db()
      .insert(noticias)
      .values({ nichoId, titulo: "[teste] novidade do setor", url: `https://exemplo.invalido/pp-${Math.random()}`, fonte: "[teste] Jornal", publicadoEm: new Date(), resumo: "Resumo curto.", relevante: true })
      .returning();
    const comNoticia = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE, noticiaId: noticia.id });
    expect(comNoticia.noticiaId).toBe(noticia.id);
    expect(comNoticia.perguntaDoPublico).toBeNull();
    expect(ultimaChamada("roteiro").entrada).not.toContain("quer responder em vídeo");

    const semNoticiaAchada = await gerarRoteiro(clienteId, { origem: "livre", textoTema: RESPOSTA, objetivo: "alcance", perguntaChave: CHAVE, noticiaId: 999999 });
    expect(semNoticiaAchada.perguntaDoPublico).toMatchObject({ chave: CHAVE });
  });
});

describe("a nota do tema que responde a uma pergunta do público", () => {
  it("a entrada da nota traz a pergunta, datada, e diz que não é prova de viralizar", async () => {
    await avaliarTema(await clienteComNicho(), RESPOSTA, undefined, undefined, CHAVE);
    const { entrada } = ultimaChamada("avaliarTema");
    expect(entrada).toContain("A pessoa quer responder em vídeo esta pergunta, lida nos comentários de vídeos do YouTube do setor em");
    expect(entrada).toContain(`<pergunta_do_publico>${PERGUNTA}</pergunta_do_publico>`);
    expect(entrada).toContain("com 14 comentários.");
    expect(entrada).toContain("não é prova de que vai viralizar");
  });

  it("uma origem só: a notícia presa tem a vez antes da pergunta; o assunto em alta que ainda está na lista também; o que saiu da lista, não", async () => {
    const cliente = await clienteComNicho();
    const noticia = { titulo: "[teste] novidade do setor", resumo: "Resumo curto.", angulo: null, veiculo: "[teste] Jornal", dia: "11 de outubro", origem: "setor" as const };
    await avaliarTema(cliente, RESPOSTA, noticia, undefined, CHAVE);
    expect(ultimaChamada("avaliarTema").entrada).not.toContain("quer responder em vídeo");

    const agora = new Date(Date.now() - 60_000);
    await db().delete(tendenciasBrasil);
    await db()
      .insert(tendenciasBrasil)
      .values({
        coletadaEm: agora,
        assunto: "Frente fria",
        chave: chaveDoAssunto("Frente fria"),
        termos: ["frente fria"],
        fontes: [{ fonte: "google" as const, titulo: "frente fria", url: "https://g1.globo.com/a", trafego: "2000+", posicao: 1 }],
        posicao: 1,
        sensivel: false,
      });
    await avaliarTema(cliente, RESPOSTA, undefined, chaveDoAssunto("Frente fria"), CHAVE);
    expect(ultimaChamada("avaliarTema").entrada).not.toContain("quer responder em vídeo");

    // o assunto que já saiu da lista não prende nada: a pergunta vale
    await avaliarTema(cliente, RESPOSTA, undefined, chaveDoAssunto("Assunto que saiu"), CHAVE);
    expect(ultimaChamada("avaliarTema").entrada).toContain(`<pergunta_do_publico>${PERGUNTA}</pergunta_do_publico>`);
  });

  it("sem a chave, ou com a chave de outro setor, a nota é a de antes", async () => {
    const cliente = await clienteComNicho();
    await avaliarTema(cliente, RESPOSTA);
    expect(ultimaChamada("avaliarTema").entrada).not.toContain("quer responder em vídeo");

    await porVozes(nichoId, null);
    await porVozes(outroNichoId, vozes([voz(PERGUNTA, 14)]));
    await avaliarTema(cliente, RESPOSTA, undefined, undefined, CHAVE);
    expect(ultimaChamada("avaliarTema").entrada).not.toContain("quer responder em vídeo");
  });
});

async function clienteComNicho() {
  const [linha] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
  return linha;
}
