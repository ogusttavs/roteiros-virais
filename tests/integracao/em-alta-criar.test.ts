/**
 * O assunto em alta no Criar, no Tema livre e na tela do roteiro (E55 PR 2, parte b), contra o Postgres real e com o simulador de IA: a lista do que não coube no ramo, o assunto trazido preso ao Tema livre
 * (que faz o roteiro nascer do momento e não deixa mudar de dia), o momento do roteiro (ainda em alta, ou já passou, com as fontes e a ligação com o ramo) e o selo do Histórico.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, roteiros, temasDia, tendenciasAvaliadas, tendenciasBrasil, user, type Cliente, type TemaDoDia } from "@/db/schema";
import { atualizarTemaDoMomento } from "@/jobs/tema-do-momento";
import { hojeISO } from "@/lib/config";
import { assuntoPresoDaLista, assuntosSemEncaixe, momentoDoRoteiro } from "@/servicos/em-alta";
import { ErroRoteiro, gerarRoteiro, roteirosDoCliente } from "@/servicos/roteiro";
import { temasParaCliente } from "@/servicos/temas";
import { chaveDoAssunto } from "@/servicos/tendencias";
import { textosHoje } from "@/textos/hoje";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA = 60 * 60 * 1000;

let nichoId: number;
let clienteId: number;

type AssuntoDaRodada = { assunto: string; termos?: string[]; fonte?: "google" | "youtube"; trafego?: string | null; sensivel?: boolean };

async function rodada(quando: Date, assuntos: AssuntoDaRodada[]): Promise<void> {
  await db()
    .insert(tendenciasBrasil)
    .values(
      assuntos.map((a, i) => ({
        coletadaEm: quando,
        assunto: a.assunto,
        chave: chaveDoAssunto(a.assunto),
        termos: a.termos ?? [a.assunto],
        fontes: [{ fonte: a.fonte ?? ("google" as const), titulo: a.assunto.toLowerCase(), url: "https://g1.globo.com/a", trafego: a.trafego === undefined ? "2000+" : a.trafego, posicao: i + 1 }],
        posicao: i + 1,
        sensivel: a.sensivel ?? false,
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

function temaComum(n: number): TemaDoDia {
  return { titulo: `tema comum ${n}`, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
}

async function marcarAvaliada(resultado: "tema" | "sem_encaixe" | "sem_assunto", rodadaEm: Date): Promise<void> {
  await db().insert(tendenciasAvaliadas).values({ nichoId, rodadaEm, resultado });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "em-alta-criar-teste", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values({ id: "em-alta-criar-usuario", name: "Marca", email: "em-alta-criar@exemplo.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "em-alta-criar-usuario", nome: "Marca", nichoId }).returning();
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

describe("o que está em alta e não coube no ramo", () => {
  it("só quando o setor avaliou a lista de agora e deu 'sem encaixe': até três, do mais alto para baixo, sem os delicados, com de onde vem e desde quando", async () => {
    const antes = new Date(Date.now() - 8 * HORA);
    const agora = new Date(Date.now() - 60_000);
    await rodada(antes, [{ assunto: "Estreia da novela" }, { assunto: "Desfile de 7 de Setembro", fonte: "youtube", trafego: null }]);
    await rodada(agora, [
      { assunto: "Eleições 2026", termos: ["eleição"], sensivel: true },
      { assunto: "Final da Copa do Brasil" },
      { assunto: "Estreia da novela" },
      { assunto: "Desfile de 7 de Setembro", fonte: "youtube", trafego: null },
      { assunto: "Quarto assunto" },
    ]);
    await marcarAvaliada("sem_encaixe", agora);

    const lista = await assuntosSemEncaixe(await clienteDaMarca(), hojeISO());
    expect(lista.map((a) => a.assunto)).toEqual(["Final da Copa do Brasil", "Estreia da novela", "Desfile de 7 de Setembro"]);
    expect(lista[0]).toMatchObject({ chave: "final da copa do brasil", doGoogle: true, doYoutube: false });
    expect(lista[2]).toMatchObject({ doGoogle: false, doYoutube: true });
    for (const assunto of lista) expect(assunto.desde).not.toBeNull();
  });

  it("sem avaliação, ou com a avaliação 'tema' (nasceu um tema do momento), ou 'sem assunto', a lista é vazia", async () => {
    const agora = new Date(Date.now() - 60_000);
    await rodada(agora, [{ assunto: "Final da Copa do Brasil" }]);
    expect(await assuntosSemEncaixe(await clienteDaMarca(), hojeISO())).toEqual([]);
    for (const resultado of ["tema", "sem_assunto"] as const) {
      await db().delete(tendenciasAvaliadas);
      await marcarAvaliada(resultado, agora);
      expect(await assuntosSemEncaixe(await clienteDaMarca(), hojeISO()), resultado).toEqual([]);
    }
  });

  it("a lista de agora passou de 18 horas: nada a dizer", async () => {
    const velha = new Date(Date.now() - 20 * HORA);
    await rodada(velha, [{ assunto: "Final da Copa do Brasil" }]);
    await marcarAvaliada("sem_encaixe", velha);
    expect(await assuntosSemEncaixe(await clienteDaMarca(), hojeISO())).toEqual([]);
  });
});

describe("o assunto trazido para o ramo (Tema livre com o assunto preso)", () => {
  it("acha o assunto na lista de agora, com a fonte e desde quando; o delicado e o que já saiu da lista não vêm", async () => {
    const agora = new Date(Date.now() - 60_000);
    await rodada(agora, [{ assunto: "Final da Copa do Brasil", fonte: "youtube", trafego: null }, { assunto: "Eleições 2026", termos: ["eleição"], sensivel: true }]);
    expect(await assuntoPresoDaLista("final da copa do brasil", hojeISO())).toMatchObject({ assunto: "Final da Copa do Brasil", doGoogle: false, doYoutube: true });
    expect(await assuntoPresoDaLista("eleicoes 2026", hojeISO())).toBeNull();
    expect(await assuntoPresoDaLista("assunto que saiu", hojeISO())).toBeNull();
  });

  it("o roteiro de um Tema livre com o assunto preso nasce do momento (guarda o assunto) e não muda de dia", async () => {
    await rodada(new Date(Date.now() - 60_000), [{ assunto: "Frente fria", termos: ["frente fria", "frio"] }]);
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "o frio traz mofo para o armário do cliente", objetivo: "alcance", assuntoEmAlta: "frente fria" });
    expect(roteiro.temaDoMomento).toMatchObject({ chave: "frente fria", assunto: "Frente fria", ligacao: null });
    const entradas = JSON.stringify((await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro")))[0].entradas);
    expect(entradas).toContain("Este é um tema do momento");

    const amanha = new Date(Date.now() + 24 * HORA).toISOString().slice(0, 10);
    const outroDia = { origem: "livre" as const, textoTema: "outro texto", objetivo: "alcance" as const, assuntoEmAlta: "frente fria", data: amanha };
    await expect(gerarRoteiro(clienteId, outroDia)).rejects.toThrow(textosHoje.emAlta.naoMudaDeDia);
    await expect(gerarRoteiro(clienteId, outroDia)).rejects.toBeInstanceOf(ErroRoteiro);
  });

  it("o assunto que já saiu da lista vira um Tema livre comum: sem selo do momento e podendo ir para outro dia", async () => {
    await rodada(new Date(Date.now() - 60_000), [{ assunto: "Outro assunto" }]);
    const amanha = new Date(Date.now() + 24 * HORA).toISOString().slice(0, 10);
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "o frio traz mofo", objetivo: "alcance", assuntoEmAlta: "frente fria", data: amanha });
    expect(roteiro.temaDoMomento).toBeNull();
    expect(roteiro.data).toBe(amanha);
  });

  it("a chave de um assunto delicado, mesmo mandada na mão, não faz o roteiro nascer do momento", async () => {
    await rodada(new Date(Date.now() - 60_000), [{ assunto: "Eleições 2026", termos: ["eleição"], sensivel: true }]);
    const amanha = new Date(Date.now() + 24 * HORA).toISOString().slice(0, 10);
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "o que a eleição muda para o meu negócio", objetivo: "alcance", assuntoEmAlta: "eleicoes 2026", data: amanha });
    expect(roteiro.temaDoMomento).toBeNull();
    expect(roteiro.data).toBe(amanha);
  });

  it("o roteiro de um Tema livre comum nunca guarda assunto, mesmo com um assunto na lista de agora", async () => {
    await rodada(new Date(Date.now() - 60_000), [{ assunto: "Frente fria" }]);
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "como tirar mancha de sofá", objetivo: "alcance" });
    expect(roteiro.temaDoMomento).toBeNull();
  });
});

describe("o tema do momento pela chave, não só pelo índice", () => {
  it("com a chave, o roteiro é do assunto que a pessoa viu mesmo que o índice aponte para outro tema; sem o assunto na lista de hoje, a frase da tela e nenhum roteiro", async () => {
    await rodada(new Date(Date.now() - 60_000), [{ assunto: "Frente fria", termos: ["frente fria", "frio"] }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    expect(await atualizarTemaDoMomento({ id: nichoId, nome: "Produtos de limpeza", termos: [] })).toBe("criado");
    const resultado = await temasParaCliente(await clienteDaMarca());
    if (resultado.status !== "ok") throw new Error("sem tema");
    const indiceDoComum = resultado.temas.findIndex((t) => !t.doMomento);
    const chave = resultado.temas.find((t) => t.doMomento)!.doMomento!.chave;

    // O índice certo seria o do tema do momento; mandando o do tema comum com a chave, vale a chave.
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indiceDoComum, temaChave: chave, objetivo: "alcance" });
    expect(roteiro.temaDoMomento?.chave).toBe(chave);

    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indiceDoComum, temaChave: "assunto que saiu", objetivo: "alcance" })).rejects.toThrow(textosHoje.emAlta.saiuNaHora);
    // Sem a chave, o índice vale como sempre.
    const comum = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indiceDoComum, objetivo: "alcance" });
    expect(comum.temaDoMomento).toBeNull();
  });
});

describe("o momento do roteiro e o selo do Histórico", () => {
  async function roteiroDoTemaDoMomento(assunto = "Frente fria", opcoes: { fonte?: "google" | "youtube"; trafego?: string | null } = {}) {
    await rodada(new Date(Date.now() - 60_000), [{ assunto, termos: [assunto.toLowerCase(), "frio"], ...opcoes }]);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: [temaComum(1)] });
    expect(await atualizarTemaDoMomento({ id: nichoId, nome: "Produtos de limpeza", termos: [] })).toBe("criado");
    const resultado = await temasParaCliente(await clienteDaMarca());
    if (resultado.status !== "ok") throw new Error("sem tema");
    const indice = resultado.temas.findIndex((t) => t.doMomento);
    return { roteiro: await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: indice, objetivo: "alcance" }), porQue: resultado.temas[indice].porQue };
  }

  it("com o assunto ainda em alta: as fontes dele (o termo e o número do Google), desde quando e a ligação com o ramo que o modelo escreveu", async () => {
    const { roteiro, porQue } = await roteiroDoTemaDoMomento("Frente fria", { trafego: "500K+" });
    const momento = await momentoDoRoteiro({ data: roteiro.data, temaDoMomento: roteiro.temaDoMomento! }, hojeISO());
    expect(momento).toMatchObject({ assunto: "Frente fria", estado: "vivo", doYoutube: false, saiuEm: null, ligacao: porQue });
    expect(momento.fonteGoogle).toEqual({ termo: "frente fria", buscas: "500.000" });
    expect(momento.desde).not.toBeNull();
  });

  it("depois que o assunto sai da lista: já passou, e diz a hora da primeira rodada sem ele; as fontes são as da última rodada em que apareceu", async () => {
    const { roteiro } = await roteiroDoTemaDoMomento("Frente fria", { trafego: "2000+" });
    // Uma rodada nova, sem o assunto, é a lista de agora.
    await rodada(new Date(Date.now() - 30_000), [{ assunto: "Jogo do Flamengo" }]);
    const momento = await momentoDoRoteiro({ data: roteiro.data, temaDoMomento: roteiro.temaDoMomento! }, hojeISO());
    expect(momento.estado).toBe("passou");
    expect(momento.saiuEm).not.toBeNull();
    expect(momento.fonteGoogle).toEqual({ termo: "frente fria", buscas: "2.000" });
  });

  it("roteiro de outro dia nunca está vivo: com o assunto ainda na lista é 'outroDia' (ele não saiu), e fora da lista é 'passou'", async () => {
    const { roteiro } = await roteiroDoTemaDoMomento();
    const deOutroDia = await momentoDoRoteiro({ data: "2026-01-01", temaDoMomento: roteiro.temaDoMomento! }, hojeISO());
    expect(deOutroDia.estado).toBe("outroDia");
    expect(deOutroDia.saiuEm).toBeNull();
    await rodada(new Date(Date.now() - 30_000), [{ assunto: "Jogo do Flamengo" }]);
    expect((await momentoDoRoteiro({ data: "2026-01-01", temaDoMomento: roteiro.temaDoMomento! }, hojeISO())).estado).toBe("passou");
  });

  it("o Histórico leva o nome do assunto do roteiro que nasceu de um momento, e nulo nos outros", async () => {
    const { roteiro } = await roteiroDoTemaDoMomento("Frente fria");
    const comum = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "como tirar mancha de sofá", objetivo: "alcance" });
    const linhas = await roteirosDoCliente(clienteId);
    expect(linhas.find((l) => l.id === roteiro.id)?.assuntoDoMomento).toBe("Frente fria");
    expect(linhas.find((l) => l.id === comum.id)?.assuntoDoMomento).toBeNull();
  });
});
