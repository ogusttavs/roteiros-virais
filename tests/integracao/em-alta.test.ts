/**
 * O cartão "Em alta hoje" e o roteiro do tema do momento (E55 PR 2, parte a), contra o Postgres real e com o simulador de IA: o cartão (de onde vem o assunto, o número do Google, desde quando, o
 * roteiro que a marca já criou), o roteiro que guarda o assunto de onde nasceu, a reescrita que continua pedindo o formato fácil de gravar hoje (a decisão 272 do PR 1), o roteiro do momento que não
 * muda de dia, e o cartão que some quando a pessoa arquiva ou quando o assunto sai da lista.
 */
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, roteiros, temasDia, tendenciasAvaliadas, tendenciasBrasil, user, type Cliente, type TemaDoDia } from "@/db/schema";
import { atualizarTemaDoMomento } from "@/jobs/tema-do-momento";
import { hojeISO } from "@/lib/config";
import { cartaoEmAltaDaMarca } from "@/servicos/em-alta";
import { agendaDoDia, arquivarRoteiro, ErroRoteiro, gerarRoteiro, mudarDataRoteiro, reprovarERescrever, roteiroDoMomentoDeHoje, semanaPlanoDaAgenda } from "@/servicos/roteiro";
import { temasParaCliente } from "@/servicos/temas";
import { chaveDoAssunto } from "@/servicos/tendencias";
import { textosHoje } from "@/textos/hoje";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA = 60 * 60 * 1000;

let nichoId: number;
let clienteId: number;

function temaComum(n: number): TemaDoDia {
  return { titulo: `tema comum ${n}`, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
}

async function rodada(quando: Date, assuntos: { assunto: string; termos?: string[]; fonte?: "google" | "youtube"; trafego?: string | null }[]): Promise<void> {
  await db()
    .insert(tendenciasBrasil)
    .values(
      assuntos.map((a, i) => ({
        coletadaEm: quando,
        assunto: a.assunto,
        chave: chaveDoAssunto(a.assunto),
        termos: a.termos ?? [a.assunto],
        fontes: [{ fonte: a.fonte ?? ("google" as const), titulo: a.assunto, url: "https://g1.globo.com/a", trafego: a.trafego === undefined ? "2000+" : a.trafego, posicao: i + 1 }],
        posicao: i + 1,
        sensivel: false,
      })),
    );
}

async function limpar(): Promise<void> {
  await db().delete(tendenciasAvaliadas);
  await db().delete(tendenciasBrasil);
  await db().delete(temasDia);
  await db().delete(roteiros);
  await db().delete(geracoesIA);
}

async function clienteDaMarca(): Promise<Cliente> {
  return (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
}

/** O assunto em alta de agora, com o tema do momento criado para o setor (a coleta e o job já rodaram). */
async function prepararTemaDoMomento(assunto = "Frente fria", opcoes: { termos?: string[]; fonte?: "google" | "youtube"; trafego?: string | null } = {}): Promise<number> {
  await limpar();
  await rodada(new Date(Date.now() - HORA), [{ assunto, ...opcoes }]);
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
  expect(await atualizarTemaDoMomento({ id: nichoId, nome: "Produtos de limpeza", termos: [] })).toBe("criado");
  const resultado = await temasParaCliente(await clienteDaMarca());
  if (resultado.status !== "ok") throw new Error("sem tema");
  return resultado.temas.findIndex((t) => t.doMomento);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "em-alta-teste", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values({ id: "em-alta-usuario", name: "Marca", email: "em-alta@exemplo.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "em-alta-usuario", nome: "Marca", nichoId }).returning();
  clienteId = cliente.id;
  await db()
    .insert(briefings)
    .values({
      clienteId,
      completo: true,
      perfil: {
        fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "produtos de limpeza",
        referencias: [],
      },
    });
}, 60_000);

beforeEach(async () => {
  await limpar();
});

afterAll(async () => {
  await getPool().end();
});

describe("o cartão Em alta hoje", () => {
  it("sem tema do momento (nenhum assunto cabe, ou a lista não tem nada), não há cartão", async () => {
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    expect(await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO())).toBeNull();
  });

  it("com o tema do momento: o assunto, de onde vem, o número do Google, o tema do ramo e o índice dele na lista de temas de hoje; ainda sem roteiro", async () => {
    const indice = await prepararTemaDoMomento("Frente fria", { termos: ["frente fria", "frio"] });
    const cartao = await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO());
    expect(cartao).not.toBeNull();
    expect(cartao).toMatchObject({ assunto: "Frente fria", doGoogle: true, doYoutube: false, buscas: "2.000", roteiro: null });
    expect(cartao!.tema.indice).toBe(indice);
    expect(cartao!.tema.titulo.length).toBeGreaterThan(0);
    expect(cartao!.tema.descricao.length).toBeGreaterThan(0);
  });

  it("o número e as fontes são os do mesmo assunto, não os de outro da lista que divide uma palavra com ele", async () => {
    await limpar();
    // "Copa do Brasil" (do YouTube, sem número) e, acima dele na lista, "Brasil x Argentina" (do Google, 500K+) que também tem o termo "copa".
    await rodada(new Date(Date.now() - HORA), [
      { assunto: "Brasil x Argentina", termos: ["brasil x argentina", "copa"], trafego: "500K+" },
      { assunto: "Copa do Brasil", termos: ["copa do brasil", "copa"], fonte: "youtube", trafego: null },
    ]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    await db()
      .update(temasDia)
      .set({
        temas: [
          temaComum(1),
          {
            ...temaComum(2),
            doMomento: { chave: chaveDoAssunto("Copa do Brasil"), assunto: "Copa do Brasil", termos: ["copa do brasil", "copa"], fonte: "Em alta no YouTube no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 9 },
          },
        ],
      })
      .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
    const cartao = await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO());
    expect(cartao).toMatchObject({ assunto: "Copa do Brasil", doGoogle: false, doYoutube: true, buscas: null });
  });

  it("assunto que só o YouTube traz: sem número de buscas, e a fonte diz YouTube", async () => {
    await prepararTemaDoMomento("Trailer da série", { fonte: "youtube", trafego: null });
    const cartao = await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO());
    expect(cartao).toMatchObject({ doGoogle: false, doYoutube: true, buscas: null });
  });

  it("desde quando: a primeira das rodadas que vêm seguidas com o assunto, e não a rodada em que o tema nasceu", async () => {
    await limpar();
    const agora = Date.now();
    // Uma rodada antiga sem o assunto, e três com ele (10, 6 e 1 hora atrás): o "desde" é a de 10 horas atrás.
    await rodada(new Date(agora - 30 * HORA), [{ assunto: "Outro assunto" }]);
    await rodada(new Date(agora - 10 * HORA), [{ assunto: "Frente fria", termos: ["frente fria", "frio"] }]);
    await rodada(new Date(agora - 6 * HORA), [{ assunto: "Frente fria", termos: ["frente fria", "frio"] }]);
    await rodada(new Date(agora - HORA), [{ assunto: "Frente fria", termos: ["frente fria", "frio"] }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    await atualizarTemaDoMomento({ id: nichoId, nome: "Produtos de limpeza", termos: [] });

    const cartao = await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO(), new Date(agora));
    const esperado = new Date(agora - 10 * HORA);
    const horaEsperada = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(esperado)) % 24;
    expect(cartao?.desde?.hora).toBe(horaEsperada);
    expect(["hoje", "ontem"]).toContain(cartao?.desde?.dia);
  });

  it("some quando o assunto sai da lista: a rodada nova não o tem mais", async () => {
    await prepararTemaDoMomento("Frente fria");
    expect(await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO())).not.toBeNull();
    await rodada(new Date(), [{ assunto: "Jogo do Flamengo", termos: ["flamengo"] }]);
    expect(await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO())).toBeNull();
  });
});

describe("o roteiro do tema do momento", () => {
  it("guarda o assunto de onde nasceu (sem o encaixe), e a agenda e a semana do plano o marcam como do momento", async () => {
    const indice = await prepararTemaDoMomento("Frente fria", { termos: ["frente fria", "frio"] });
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" });

    expect(roteiro.temaDoMomento).toMatchObject({ chave: chaveDoAssunto("Frente fria"), assunto: "Frente fria", termos: ["frente fria", "frio"], fonte: "Em alta no Google no Brasil" });
    expect(roteiro.temaDoMomento).not.toHaveProperty("encaixe");
    expect(typeof roteiro.temaDoMomento?.coletadaEm).toBe("string");

    const agenda = await agendaDoDia(clienteId, hojeISO());
    expect(agenda.reels.map((r) => [r.id, r.doMomento])).toEqual([[roteiro.id, true]]);
    const semana = await semanaPlanoDaAgenda(clienteId, hojeISO());
    expect(semana.flatMap((d) => d.itens).filter((i) => i.id === roteiro.id).map((i) => i.doMomento)).toEqual([true]);
  });

  it("o roteiro de um tema comum não guarda assunto nenhum e não é do momento", async () => {
    await prepararTemaDoMomento();
    const resultado = await temasParaCliente(await clienteDaMarca());
    if (resultado.status !== "ok") throw new Error("sem tema");
    const comum = resultado.temas.findIndex((t) => !t.doMomento);
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: comum, objetivo: "alcance" });
    expect(roteiro.temaDoMomento).toBeNull();
    expect((await agendaDoDia(clienteId, hojeISO())).reels[0].doMomento).toBe(false);
  });

  it("o cartão encontra o roteiro que a marca já criou do assunto (a versão mais nova da série) e some quando a pessoa arquiva", async () => {
    const indice = await prepararTemaDoMomento();
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" });
    expect((await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO()))?.roteiro).toEqual({ id: roteiro.id, status: "gerado" });
    expect(await roteiroDoMomentoDeHoje(clienteId, hojeISO(), roteiro.temaDoMomento!.chave)).toEqual({ id: roteiro.id, status: "gerado", arquivado: false });

    await arquivarRoteiro(roteiro.id);
    // Arquivar é a saída do assunto do momento: o cartão não volta a oferecer o mesmo assunto no mesmo dia.
    expect(await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO())).toBeNull();
    expect((await roteiroDoMomentoDeHoje(clienteId, hojeISO(), roteiro.temaDoMomento!.chave))?.arquivado).toBe(true);
  });

  it("a reescrita (Não gostei, quero outro) continua sendo do momento: guarda o mesmo assunto e pede de novo o formato fácil de gravar hoje", async () => {
    const indice = await prepararTemaDoMomento();
    const primeiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" });
    const nova = await reprovarERescrever(primeiro.id, ["gancho_fraco"]);

    expect(nova.versaoDe).toBe(primeiro.id);
    expect(nova.temaDoMomento).toEqual(primeiro.temaDoMomento);
    // Na entrada da IA, as duas gerações trazem o pedido de ser curto e fácil de gravar hoje (antes a reescrita o perdia).
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro")).orderBy(desc(geracoesIA.id));
    expect(geracoes.length).toBe(2);
    for (const geracao of geracoes) expect(JSON.stringify(geracao.entradas)).toContain("Este é um tema do momento");
    // A ponta da série é a versão nova, e o cartão fala dela.
    expect((await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO()))?.roteiro?.id).toBe(nova.id);
  });

  it("com três versões da série, só a ponta aparece: a v2 reprovada não fica na agenda ao lado do cartão, e arquivar a ponta tira o assunto do dia", async () => {
    const indice = await prepararTemaDoMomento();
    const v1 = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" });
    const v2 = await reprovarERescrever(v1.id, ["gancho_fraco"]);
    const v3 = await reprovarERescrever(v2.id, ["gancho_fraco"]);
    // As três apontam `versaoDe` para a raiz (v1): "ninguém aponta para este id" deixava a v2 de pé ao lado da v3.
    expect([v2.versaoDe, v3.versaoDe]).toEqual([v1.id, v1.id]);

    expect((await cartaoEmAltaDaMarca(await clienteDaMarca(), hojeISO()))?.roteiro?.id).toBe(v3.id);
    const agenda = await agendaDoDia(clienteId, hojeISO());
    expect(agenda.reels.map((item) => item.id)).toEqual([v3.id]);
    expect((await roteiroDoMomentoDeHoje(clienteId, hojeISO(), v1.temaDoMomento!.chave))?.id).toBe(v3.id);

    await arquivarRoteiro(v3.id);
    expect((await agendaDoDia(clienteId, hojeISO())).reels).toEqual([]);
  });

  it("não muda de dia: o servidor recusa com a frase da tela, e trazer para hoje continua valendo", async () => {
    const indice = await prepararTemaDoMomento();
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" });
    const amanha = new Date(Date.now() + 24 * HORA).toISOString().slice(0, 10);

    await expect(mudarDataRoteiro(roteiro.id, amanha)).rejects.toThrow(textosHoje.emAlta.naoMudaDeDia);
    await expect(mudarDataRoteiro(roteiro.id, amanha)).rejects.toBeInstanceOf(ErroRoteiro);
    const [depois] = await db().select({ data: roteiros.data }).from(roteiros).where(eq(roteiros.id, roteiro.id));
    expect(depois.data).toBe(hojeISO());
    await mudarDataRoteiro(roteiro.id, hojeISO());
  });

  it("o roteiro de um tema comum muda de dia como sempre", async () => {
    await prepararTemaDoMomento();
    const resultado = await temasParaCliente(await clienteDaMarca());
    if (resultado.status !== "ok") throw new Error("sem tema");
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: resultado.temas.findIndex((t) => !t.doMomento), objetivo: "alcance" });
    const amanha = new Date(Date.now() + 24 * HORA).toISOString().slice(0, 10);
    await mudarDataRoteiro(roteiro.id, amanha);
    const [depois] = await db().select({ data: roteiros.data }).from(roteiros).where(and(eq(roteiros.id, roteiro.id)));
    expect(depois.data).toBe(amanha);
  });
});
