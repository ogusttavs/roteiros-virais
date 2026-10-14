/**
 * O roteiro longo do YouTube (E52, PR 3), contra o Postgres real e com a IA simulada (`AI_PROVIDER=mock`): a duração-alvo vem da medida dos vídeos longos do próprio ramo (e sem
 * medida o roteiro não sai), as referências são só as lidas do ramo da marca, os capítulos são conferidos por código (três ou mais, 10 segundos ou mais cada, a soma na duração) com
 * a segunda tentativa recebendo o motivo, e a reescrita, o momento e o curto de sempre seguem cada um o seu caminho. Os vídeos são inventados (o repositório é público).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, contas, geracoesIA, modelosNicho, nichos, roteiros, user, videos, type AnaliseVideoLonga, type ModeloNicho } from "@/db/schema";
import { OBJETIVOS_EM_ORDEM } from "@/ia/enums";
import { ErroIA } from "@/ia/erro";
import * as verificador from "@/ia/verificador";
import { lerCapitulosDaDescricao } from "@/lib/capitulos-da-descricao";
import { capitulosParaCopiar, iniciosDosCapitulos, somaDosCapitulos } from "@/lib/capitulos-do-roteiro";
import { criarPesquisa, executarPesquisa } from "@/servicos/pesquisa-na-hora";
import { falaDoRoteiro } from "@/servicos/marcar-fala";
import { editarRoteiro, ErroRoteiro, gerarRoteiro, reprovarERescrever } from "@/servicos/roteiro";
import { folhaDoRoteiro } from "@/servicos/folha-do-roteiro";
import { longoDoRamo } from "@/servicos/roteiro-longo";
import { textosRoteiro } from "@/textos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para o verificador de verdade, mas deixa ver o que cada tarefa recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

const DIA_MS = 24 * 60 * 60 * 1000;
const TEMA = "como tirar mancha de sofá sem estragar o tecido";

let nichoId: number;
let outroNichoId: number;
let contaId: number;
let outraContaId: number;
let clienteId: number;
let sequencia = 0;

const analise = (assunto: string): AnaliseVideoLonga => ({
  versaoPrompt: "1.0.0",
  origemDosCapitulos: "descricao",
  assunto,
  abertura: { promessa: "mostra o antes e o depois da mancha", entregaAteS: 20, tipo: "resultado" },
  capitulos: [
    { inicioS: 0, nome: "O antes e o depois", oQueFaz: "mostra o resultado primeiro", gancho: "mas o erro que estraga o tecido vem a seguir" },
    { inicioS: 90, nome: "O que usar", oQueFaz: "lista o que precisa", gancho: "e o passo que ninguém conta" },
    { inicioS: 240, nome: "O passo a passo", oQueFaz: "faz ao vivo", gancho: null },
  ],
  lacos: [{ abertoEmS: 15, pagoEmS: 300, oQue: "promete mostrar o erro mais comum" }],
  ondeSairia: [{ segundo: 120, porQue: "a lista de produtos é longa" }],
  fechamento: { oQueFaz: "pede o comentário com a dúvida", apontaParaProximoVideo: true },
  porQueFuncionou: "mostra o resultado antes de explicar",
});

async function semearCurto(assunto: string) {
  sequencia += 1;
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: `curto-roteiro-${sequencia}`,
      url: `https://exemplo.invalido/curto-roteiro-${sequencia}`,
      nichoId,
      contaId,
      titulo: assunto,
      views: 200_000,
      foraDaCurva: "6.000",
      duracaoS: 40,
      publicadoEm: new Date(),
      idioma: "pt",
      analise: {
        assunto,
        gancho: "olha essa mancha saindo do estofado",
        estrutura: "gancho, demonstracao, fechamento",
        fechamento: "mostra o resultado sem falar nada",
        chamadaFinal: "comenta se voce ja passou por isso",
        formato: "fala_para_camera",
        porQueFuncionou: "mostra o problema acontecendo de verdade",
      } as never,
      origem: "coleta",
    })
    .returning();
  return v.id;
}

async function semearLongo(opcoes: { duracaoS: number; nicho?: number; conta?: number; comLeitura?: boolean; titulo?: string; diasAtras?: number; idioma?: string; foraDaCurva?: string }) {
  sequencia += 1;
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: `longo-roteiro-${sequencia}`,
      url: `https://exemplo.invalido/longo-roteiro-${sequencia}`,
      nichoId: opcoes.nicho ?? nichoId,
      contaId: opcoes.conta ?? contaId,
      titulo: opcoes.titulo ?? `[exemplo] longo ${sequencia}`,
      descricao: null,
      views: 100_000,
      foraDaCurva: opcoes.foraDaCurva ?? "3.000",
      duracaoS: opcoes.duracaoS,
      publicadoEm: new Date(Date.now() - (opcoes.diasAtras ?? 5) * DIA_MS),
      idioma: opcoes.idioma ?? "pt",
      analiseLonga: opcoes.comLeitura ? analise(`assunto ${sequencia}`) : undefined,
      analiseLongaEm: opcoes.comLeitura ? new Date() : undefined,
      origem: "coleta",
    })
    .returning();
  return v;
}

function chamadasDoLongo() {
  return vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === "roteiroLongo");
}

function chamadasDoCurto() {
  return vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === "roteiro");
}

function ultimaChamadaDoLongo() {
  const chamadas = chamadasDoLongo();
  expect(chamadas.length).toBeGreaterThan(0);
  const [params] = chamadas[chamadas.length - 1];
  return { entrada: String(params.entrada), sistema: String(params.sistemaEstavel), fontes: String(params.fontesDosFatos ?? ""), params };
}

async function geracoesDa(tarefa: string) {
  return db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, tarefa)).orderBy(geracoesIA.id);
}

beforeAll(async () => {
  await resetarSchema(db());
  // O outro setor nasce primeiro (id menor): uma consulta que esquecesse o filtro por setor devolveria o dele.
  const [outro] = await db().insert(nichos).values({ slug: "longo-outro-setor", nome: "Odontologia", termos: ["dentista"] }).returning();
  const [nicho] = await db().insert(nichos).values({ slug: "longo-roteiro", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  outroNichoId = outro.id;
  const [conta] = await db().insert(contas).values({ plataforma: "youtube", handle: "longo-roteiro-a", nichoId, pais: "BR", idiomaPrincipal: "pt" }).returning();
  const [outraConta] = await db().insert(contas).values({ plataforma: "youtube", handle: "longo-roteiro-b", nichoId: outroNichoId, pais: "BR", idiomaPrincipal: "pt" }).returning();
  contaId = conta.id;
  outraContaId = outraConta.id;
  await db().insert(user).values({ id: "longo-usuario", name: "Marca", email: "longo@exemplo.teste" });
  const [marca] = await db().insert(clientes).values({ usuarioId: "longo-usuario", nome: "Marca", nichoId }).returning();
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
  await db().delete(modelosNicho);
  await db().delete(geracoesIA);
  await db().delete(videos);
  await db().update(nichos).set({ pisoViews: null });
  vi.mocked(verificador.gerarComVerificacao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

/** Quatro longos medidos no ramo: 8, 9, 10 e 11 minutos, mediana de 9:30 (570 s); só os dois primeiros com a leitura da estrutura. */
async function medirORamo() {
  const a = await semearLongo({ duracaoS: 480, comLeitura: true });
  const b = await semearLongo({ duracaoS: 540, comLeitura: true });
  const c = await semearLongo({ duracaoS: 600 });
  const d = await semearLongo({ duracaoS: 660 });
  return { lidos: [a.id, b.id], semLeitura: [c.id, d.id] };
}

describe("a duração-alvo vem da medida do ramo", () => {
  it("sem vídeos longos medidos (menos de três), o roteiro longo não sai: a frase diz o motivo e a IA nunca é chamada para escrever", async () => {
    await semearLongo({ duracaoS: 600 });
    await semearLongo({ duracaoS: 700 });

    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" })).rejects.toMatchObject({
      name: "Error",
      message: textosRoteiro.longo.semLongos,
    });
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" })).rejects.toBeInstanceOf(ErroRoteiro);

    expect(chamadasDoLongo()).toHaveLength(0);
    expect(await geracoesDa("roteiroLongo")).toHaveLength(0);
    // nem o filtro de evidência dos curtos (uma chamada de IA) rodou
    expect(await geracoesDa("filtrarEvidenciaPorMarca")).toHaveLength(0);
    expect(await db().select().from(roteiros)).toHaveLength(0);
  });

  it("a recusa vem ANTES de resolver o tema do dia: o tema sugerido de um ramo sem medida recebe a frase do longo, não a do tema", async () => {
    await semearLongo({ duracaoS: 600 });
    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance", duracao: "longo" })).rejects.toThrow(textosRoteiro.longo.semLongos);
    // o mesmo pedido sem a duração longa vai até o tema do dia (e diz que não há tema), o que prova a ordem
    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance" })).rejects.not.toThrow(textosRoteiro.longo.semLongos);
    expect(await geracoesDa("roteiroLongo")).toHaveLength(0);
  });

  it("o vídeo longo de outro setor não entra na medida: três longos, mas dois são do ramo da marca", async () => {
    await semearLongo({ duracaoS: 600 });
    await semearLongo({ duracaoS: 700 });
    await semearLongo({ duracaoS: 2000, nicho: outroNichoId, conta: outraContaId });

    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" })).rejects.toThrow(textosRoteiro.longo.semLongos);
  });

  it("com a medida, a duração do roteiro é a mediana do ramo (de 30 em 30 segundos) e os capítulos somam essa duração", async () => {
    await medirORamo();
    // vídeos curtos com análise no ramo: a evidência dos curtos (e o filtro dela, uma chamada de IA) não rodam para o longo
    const curto = await semearCurto(TEMA);
    // um longo de outro setor, longe do ramo da marca: se vazasse para a medida, a mediana mudaria
    await semearLongo({ duracaoS: 2300, nicho: outroNichoId, conta: outraContaId });

    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });

    const { entrada } = ultimaChamadaDoLongo();
    expect(entrada).toContain("Duração do vídeo: 570 segundos (9:30)");
    expect(entrada).toContain("4 vídeos longos do ramo");
    expect(entrada).toContain("com mediana de 9:30");

    expect(entrada).not.toContain(`id ${curto}:`);
    expect(await geracoesDa("filtrarEvidenciaPorMarca")).toHaveLength(0);

    expect(roteiro.duracaoDoVideo).toBe("longo");
    const capitulos = roteiro.conteudo.capitulos!;
    expect(capitulos.length).toBeGreaterThanOrEqual(3);
    expect(capitulos[0].inicioS).toBe(0);
    expect(somaDosCapitulos(capitulos)).toBe(roteiro.conteudo.duracaoS);
    expect(Math.abs(roteiro.conteudo.duracaoS - 570)).toBeLessThanOrEqual(570 * 0.15);
    // o início de cada capítulo é a soma dos de antes, calculada pelo código
    expect(capitulos.map((c) => c.inicioS)).toEqual(iniciosDosCapitulos(capitulos));
    capitulos.forEach((c, i) => {
      expect(c.duracaoS).toBeGreaterThanOrEqual(10);
      if (i > 0) expect(c.inicioS).toBeGreaterThan(capitulos[i - 1].inicioS);
    });
    expect(roteiro.conteudo.miniatura).toBeTruthy();
  });
});

describe("longoDoRamo (o que a tela do 'Quanto tempo?' lê)", () => {
  it("sem ramo, ou com menos de três vídeos longos, o longo não está disponível e a tela diz isso com calma", async () => {
    expect(await longoDoRamo(null)).toEqual({ disponivel: false, duracaoS: null });
    await semearLongo({ duracaoS: 600 });
    await semearLongo({ duracaoS: 700 });
    expect(await longoDoRamo(nichoId)).toEqual({ disponivel: false, duracaoS: null });
  });

  it("com a medida, diz a duração que o roteiro vai pedir (a mesma do roteiro, de 30 em 30 segundos), só com os vídeos do ramo", async () => {
    await medirORamo();
    await semearLongo({ duracaoS: 2300, nicho: outroNichoId, conta: outraContaId });
    expect(await longoDoRamo(nichoId)).toEqual({ disponivel: true, duracaoS: 570 });
    expect(await longoDoRamo(outroNichoId)).toEqual({ disponivel: false, duracaoS: null });
  });
});

describe("o roteiro longo escrito", () => {
  it("guarda a tarefa própria, a versão do prompt e uma cena por capítulo, com o texto corrido que o resto do produto lê", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });

    const geracoes = await geracoesDa("roteiroLongo");
    expect(geracoes).toHaveLength(1);
    expect(geracoes[0].versaoPrompt).toBe("1.0.0");
    expect(roteiro.geracaoId).toBe(geracoes[0].id);

    const capitulos = roteiro.conteudo.capitulos!;
    expect(roteiro.conteudo.cenas).toHaveLength(capitulos.length);
    expect(roteiro.conteudo.cenas[0].momento).toBe("0 segundos");
    // o corpo é o resumo de capítulos (gancho, corpo e fechamento seguem lidos pelo resto do produto)
    expect(roteiro.conteudo.corpo).toContain(`1. ${capitulos[0].nome}`);
    expect(roteiro.conteudo.gancho).toBeTruthy();
    expect(roteiro.conteudo.chamadaFinal).toBeTruthy();
    // o último capítulo não tem gancho; os outros têm a frase inteira
    expect(capitulos[capitulos.length - 1].ganchoParaOProximo).toBeNull();
    capitulos.slice(0, -1).forEach((c) => expect(c.ganchoParaOProximo?.split(/\s+/).length).toBeGreaterThanOrEqual(4));
    // e o resto do capítulo vem em pontos curtos
    capitulos.forEach((c) => {
      expect(c.pontos.length).toBeGreaterThanOrEqual(2);
      expect(c.pontos.length).toBeLessThanOrEqual(4);
      c.pontos.forEach((p) => expect(p.split(/\s+/).length).toBeLessThanOrEqual(20));
    });
  });

  it("o 'Copiar os capítulos' sai na forma das quatro regras e a leitura que mede os vídeos dos outros devolve os mesmos capítulos", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
    const capitulos = roteiro.conteudo.capitulos!;

    const texto = capitulosParaCopiar(capitulos);
    const linhas = texto.split("\n");
    expect(linhas).toHaveLength(capitulos.length);
    expect(linhas[0].startsWith("00:00 ")).toBe(true);
    const lidos = lerCapitulosDaDescricao(texto, roteiro.conteudo.duracaoS);
    expect(lidos.map((c) => c.inicioS)).toEqual(capitulos.map((c) => c.inicioS));
    expect(lidos.map((c) => c.titulo)).toEqual(capitulos.map((c) => c.nome));
  });

  it("as referências entram com o id e a estrutura lida, só as do ramo e só as que têm leitura, e a referência escolhida é uma delas", async () => {
    const { lidos, semLeitura } = await medirORamo();
    // um longo de outro setor COM leitura: nunca aparece na entrada
    const deOutroSetor = await semearLongo({ duracaoS: 700, nicho: outroNichoId, conta: outraContaId, comLeitura: true });

    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });

    const { entrada, fontes } = ultimaChamadaDoLongo();
    for (const id of lidos) expect(entrada).toContain(`id ${id}:`);
    for (const id of semLeitura) expect(entrada).not.toContain(`id ${id}:`);
    expect(entrada).not.toContain(`id ${deOutroSetor.id}:`);
    expect(entrada).toContain("mostra o antes e o depois da mancha");
    expect(entrada).toContain("tempos exatos");
    // o que a estrutura de outra pessoa afirma nunca é fato deste roteiro: nem entra nas fontes dos fatos
    expect(fontes).not.toContain("mostra o antes e o depois da mancha");

    expect(roteiro.conteudo.semEvidencia).toBe(false);
    expect(roteiro.conteudo.forcaEvidencia).toBe("media");
    expect(roteiro.conteudo.evidencias.every((id) => lidos.includes(id))).toBe(true);
    expect(roteiro.conteudo.evidencias.length).toBeGreaterThan(0);
    expect(lidos).toContain(roteiro.referenciaVideoId);
  });

  it("sem nenhuma leitura de estrutura no ramo, o roteiro sai sem evidência e a entrada não deixa o modelo afirmar que existe vídeo", async () => {
    await semearLongo({ duracaoS: 480 });
    await semearLongo({ duracaoS: 540 });
    await semearLongo({ duracaoS: 600 });

    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });

    const { entrada } = ultimaChamadaDoLongo();
    expect(entrada).toContain("Não há leitura da estrutura de vídeo longo do ramo ainda");
    expect(entrada).not.toMatch(/\bid \d+:/);
    expect(roteiro.conteudo.semEvidencia).toBe(true);
    expect(roteiro.conteudo.evidencias).toEqual([]);
    expect(roteiro.conteudo.forcaEvidencia).toBeNull();
    expect(roteiro.referenciaVideoId).toBeNull();
    expect(roteiro.conteudo.edicao.referencia).toBeNull();
  });

  it("só as três leituras mais fora da curva entram; a de outro idioma não entra", async () => {
    const a = await semearLongo({ duracaoS: 480, comLeitura: true });
    const b = await semearLongo({ duracaoS: 540, comLeitura: true });
    const c = await semearLongo({ duracaoS: 600, comLeitura: true });
    const d = await semearLongo({ duracaoS: 660, comLeitura: true });
    const deOutroIdioma = await semearLongo({ duracaoS: 700, comLeitura: true, idioma: "outro", foraDaCurva: "9.000" });
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });

    const { entrada } = ultimaChamadaDoLongo();
    const citados = [a, b, c, d].filter((v) => entrada.includes(`id ${v.id}:`));
    expect(citados).toHaveLength(3);
    expect(entrada).not.toContain(`id ${deOutroIdioma.id}:`);
  });

  it("a referência de edição que o modelo inventa, fora das referências da entrada, é descartada e nunca trocada por outra", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: TEMA,
      objetivo: "alcance",
      duracao: "longo",
      observacao: "simule um id de referencia fora da lista de evidencia",
    });
    expect(roteiro.referenciaVideoId).toBeNull();
    expect(roteiro.conteudo.edicao.referencia).toBeNull();
  });

  it("o curto continua o de sempre: a duração padrão é curta, sem capítulos, e a tarefa é a do roteiro", async () => {
    await medirORamo();
    // o mesmo ramo, com um vídeo curto analisado: o curto usa a evidência dele (o controle do teste do longo, onde ela não entra)
    const curto = await semearCurto(TEMA);
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(chamadasDoCurto().some(([params]) => String(params.entrada).includes(`id ${curto}:`))).toBe(true);
    expect(roteiro.duracaoDoVideo).toBe("curto");
    expect(roteiro.conteudo.capitulos ?? null).toBeNull();
    expect(await geracoesDa("roteiroLongo")).toHaveLength(0);
    expect((await geracoesDa("roteiro")).length).toBeGreaterThan(0);
  });
});

describe("o verificador confere os capítulos por código", () => {
  it("um capítulo de 4 segundos reprova a primeira tentativa, a segunda recebe o motivo e passa", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:capitulo-curto]" });

    const tentativas = await geracoesDa("roteiroLongo");
    expect(tentativas).toHaveLength(2);
    const primeira = tentativas[0].saida as { capitulos: { duracaoS: number }[] };
    const segunda = tentativas[1].saida as { capitulos: { duracaoS: number }[] };
    expect(Math.min(...primeira.capitulos.map((c) => c.duracaoS))).toBe(4);
    expect(Math.min(...segunda.capitulos.map((c) => c.duracaoS))).toBeGreaterThanOrEqual(10);
    expect(roteiro.geracaoId).toBe(tentativas[1].id);
    expect(roteiro.conteudo.capitulos!.every((c) => c.duracaoS >= 10)).toBe(true);
  });

  it("a soma errada, menos de três capítulos e o gancho que falta também reprovam a primeira e passam na segunda", async () => {
    await medirORamo();
    for (const marcador of ["[mock:soma-errada]", "[mock:dois-capitulos]", "[mock:sem-gancho]", "[mock:ponto-longo]", "[mock:gancho-curto]", "[mock:nome-com-tempo]", "[mock:nome-com-colchete]"]) {
      await db().delete(roteiros);
      await db().delete(geracoesIA);
      const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: marcador });
      expect(await geracoesDa("roteiroLongo"), marcador).toHaveLength(2);
      expect(roteiro.conteudo.capitulos!.length, marcador).toBeGreaterThanOrEqual(3);
    }
  });

  it("com referências na entrada, citar nenhuma reprova a primeira tentativa (a segunda cita)", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:sem-evidencia]" });
    const tentativas = await geracoesDa("roteiroLongo");
    expect(tentativas).toHaveLength(2);
    expect((tentativas[0].saida as { evidencias: number[] }).evidencias).toEqual([]);
    expect(roteiro.conteudo.evidencias.length).toBeGreaterThan(0);
  });

  it("um travessão num ponto é corrigido por código, sem segunda tentativa nem travessão no que se grava", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:travessao]" });
    expect(await geracoesDa("roteiroLongo")).toHaveLength(1);
    const texto = JSON.stringify(roteiro.conteudo.capitulos);
    expect(texto).not.toContain("\u2014");
    expect(texto).toContain("sem rodeio");
  });

  it("na segunda tentativa a soma que vier vale (a duração do roteiro é a soma real), desde que seja a de um vídeo longo", async () => {
    await medirORamo();
    // a duração do ramo é 570 s; o simulador escreve 40% a mais nas duas tentativas (798 s): a primeira reprova pela soma, a segunda é aceita
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:soma-errada-sempre]" });
    expect(await geracoesDa("roteiroLongo")).toHaveLength(2);
    expect(roteiro.conteudo.duracaoS).toBeGreaterThan(570 * 1.15);
    expect(roteiro.conteudo.duracaoS).toBe(somaDosCapitulos(roteiro.conteudo.capitulos!));
  });

  it("mas a segunda tentativa que passa do limite do vídeo longo reprova: nada de roteiro longo de uma hora", async () => {
    await semearLongo({ duracaoS: 2300, comLeitura: true });
    await semearLongo({ duracaoS: 2350, comLeitura: true });
    await semearLongo({ duracaoS: 2400, comLeitura: true });
    await expect(
      gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:soma-errada-sempre]" }),
    ).rejects.toBeInstanceOf(ErroIA);
    expect(await geracoesDa("roteiroLongo")).toHaveLength(2);
    expect(await db().select().from(roteiros)).toHaveLength(0);
  });

  it("o longo não grava tipo de abertura (a rotação de aberturas é do curto) e guarda a ficha só para escolher o objetivo", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", ficha: "guardem" });
    expect(roteiro.tipoAbertura).toBeNull();
    // a ficha "que guardem para depois" escolhe o objetivo de engajamento, mas não é gravada: o prompt do longo não a segue
    expect(roteiro.ficha).toBeNull();
    expect(roteiro.objetivo).toBe(OBJETIVOS_EM_ORDEM[1]);
  });

  it("o modelo do nicho que o longo lê não traz a duração nem as estruturas dos vídeos curtos (o curto continua trazendo)", async () => {
    const modelo: ModeloNicho = {
      resumo: "Vídeos curtos de limpeza que mostram o antes e o depois.",
      ganchos: [{ tipo: "resultado", exemplo: "olha essa mancha saindo", frequencia: "alta" }],
      duracaoTipicaS: { min: 20, max: 45 },
      estruturas: ["gancho, demonstracao, fechamento"],
      fechamentos: ["mostra o resultado"],
      chamadasFinais: ["comenta se ja passou por isso"],
      formatos: [{ formato: "fala_para_camera", participacao: "70%" }],
      edicao: { textoNaTela: "pouco", ritmoDeCorte: "rapido", recursos: [], audio: null },
      assuntosQuentes: [],
      baseadoEm: 12,
      acimaDoLimiar: 12,
    };
    await db().insert(modelosNicho).values({ nichoId, semana: "2026-08-31", modelo });
    await medirORamo();

    // o curto primeiro: o longo que vem depois escolhe uma primeira palavra de gancho que o curto não usou
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    const doCurto = String(chamadasDoCurto()[chamadasDoCurto().length - 1][0].sistemaEstavel);
    expect(doCurto).toContain("Duração típica: de 20 a 45 segundos.");
    expect(doCurto).toContain("Estruturas que funcionam");

    await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} de novo`, objetivo: "alcance", duracao: "longo" });
    const doLongo = ultimaChamadaDoLongo().sistema;
    expect(doLongo).toContain("Vídeos curtos de limpeza que mostram o antes e o depois.");
    expect(doLongo).not.toContain("Duração típica");
    expect(doLongo).not.toContain("Estruturas que funcionam");
  });

  it("o Brasil primeiro: das referências com leitura, o vídeo em português vem antes do internacional, mesmo que o de fora esteja mais fora da curva", async () => {
    const de1 = await semearLongo({ duracaoS: 540, comLeitura: true });
    const de2 = await semearLongo({ duracaoS: 600, comLeitura: true });
    const de3 = await semearLongo({ duracaoS: 660, comLeitura: true });
    const deFora = await semearLongo({ duracaoS: 700, comLeitura: true, idioma: "en", foraDaCurva: "9.000" });
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });

    const { entrada } = ultimaChamadaDoLongo();
    for (const v of [de1, de2, de3]) expect(entrada).toContain(`id ${v.id}:`);
    expect(entrada).not.toContain(`id ${deFora.id}:`);
  });

  it("sem brasileiro com leitura, o internacional serve de referência (o Brasil primeiro não esvazia a lista)", async () => {
    await semearLongo({ duracaoS: 540 });
    await semearLongo({ duracaoS: 600 });
    const deFora = await semearLongo({ duracaoS: 700, comLeitura: true, idioma: "en" });
    // um vídeo de outro idioma (que o produto não trata) com a leitura e a maior curva: seria o primeiro da fila se o corte do idioma não valesse
    const deOutroIdioma = await semearLongo({ duracaoS: 720, comLeitura: true, idioma: "outro", foraDaCurva: "9.000" });
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
    const { entrada } = ultimaChamadaDoLongo();
    expect(entrada).toContain(`id ${deFora.id}:`);
    expect(entrada).not.toContain(`id ${deOutroIdioma.id}:`);
  });

  it("um nome de capítulo que a lista da descrição leria errado reprova a primeira tentativa, com o capítulo dito", async () => {
    await medirORamo();
    await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:nome-com-tempo]" });
    const tentativas = await geracoesDa("roteiroLongo");
    expect(tentativas).toHaveLength(2);
    expect(JSON.stringify(tentativas[0].saida)).toContain("10:30 da manhã");
    expect(JSON.stringify(tentativas[1].saida)).not.toContain("10:30 da manhã");
  });

  it("reprovar nas duas tentativas é erro de IA e nada é gravado", async () => {
    await medirORamo();
    await expect(
      gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", observacao: "[mock:capitulo-curto-sempre]" }),
    ).rejects.toBeInstanceOf(ErroIA);

    expect(await geracoesDa("roteiroLongo")).toHaveLength(2);
    expect(await db().select().from(roteiros)).toHaveLength(0);
  });
});

describe("o que o longo não aceita", () => {
  it("Story e vídeo sem fala não viram vídeo longo, e a recusa não gasta IA de escrita", async () => {
    await medirORamo();
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", formato: "story" })).rejects.toThrow(textosRoteiro.longo.soVideoFalado);
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", estilo: "sem_fala" })).rejects.toThrow(textosRoteiro.longo.soVideoFalado);
    expect(chamadasDoLongo()).toHaveLength(0);
    expect(await geracoesDa("roteiroLongo")).toHaveLength(0);
  });

  it("Story ou sem fala com o tema sugerido: a recusa vem antes do tema do dia, com a frase do longo", async () => {
    await medirORamo();
    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance", duracao: "longo", formato: "story" })).rejects.toThrow(textosRoteiro.longo.soVideoFalado);
    await expect(gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance", duracao: "longo", estilo: "sem_fala" })).rejects.toThrow(textosRoteiro.longo.soVideoFalado);
  });

  it("a pesquisa na hora ainda não vale para o longo", async () => {
    await medirORamo();
    const criada = await criarPesquisa(clienteId, { pedido: "dados de 2026 sobre o preço dos produtos de limpeza", tema: TEMA }, { enfileirar: async () => {} });
    await executarPesquisa(criada.id);
    await expect(
      gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo", pesquisaId: criada.id }),
    ).rejects.toThrow(textosRoteiro.longo.comPesquisa);
    expect(chamadasDoLongo()).toHaveLength(0);
  });
});

describe("o momento e a reescrita", () => {
  it("o momento descrito vira vídeo longo: a cena é a fonte, o tema curto vem do modelo e a entrada não leva o tema", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, {
      origem: "momento",
      objetivo: "alcance",
      duracao: "longo",
      momento: { onde: "na sala de um cliente", oQueEstaAcontecendo: "tirando uma mancha de vinho do sofá", oQueDaParaMostrar: "a mancha saindo aos poucos" },
    });
    expect(roteiro.duracaoDoVideo).toBe("longo");
    expect(roteiro.tema).toContain("tirando uma mancha de vinho do sofá");
    const { entrada, fontes } = ultimaChamadaDoLongo();
    expect(entrada).toContain("O momento que a pessoa descreveu agora:");
    expect(entrada).not.toContain("Tema escolhido:");
    expect(fontes).toContain("tirando uma mancha de vinho do sofá");
  });

  it("com o momento, o gancho do vídeo tem de citar algo da cena descrita: o que não cita reprova a primeira tentativa", async () => {
    await medirORamo();
    const roteiro = await gerarRoteiro(clienteId, {
      origem: "momento",
      objetivo: "alcance",
      duracao: "longo",
      momento: { onde: "na sala de um cliente", oQueEstaAcontecendo: "tirando uma mancha de vinho do sofá", oQueDaParaMostrar: "a mancha saindo aos poucos" },
      observacao: "[mock:gancho-fora-da-cena]",
    });
    const tentativas = await geracoesDa("roteiroLongo");
    expect(tentativas).toHaveLength(2);
    expect((tentativas[0].saida as { gancho: string }).gancho).toContain("assunto qualquer");
    expect(roteiro.conteudo.gancho).toContain("mancha");
  });

  it("a reescrita de um longo cujo ramo perdeu a medida diz a frase do longo e a versão anterior continua inteira", async () => {
    await medirORamo();
    const v1 = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
    // os longos saem da janela (ou do banco): a medida some, e a reescrita não passa pela porta de `montarRoteiro`
    await db().update(videos).set({ publicadoEm: new Date(Date.now() - 400 * DIA_MS) });
    await expect(reprovarERescrever(v1.id, ["gancho_fraco"])).rejects.toThrow(textosRoteiro.longo.semLongos);
    await expect(reprovarERescrever(v1.id, ["gancho_fraco"])).rejects.toBeInstanceOf(ErroRoteiro);
    const [depois] = await db().select().from(roteiros).where(eq(roteiros.id, v1.id));
    expect(depois.reprovadoEm).toBeNull();
    expect(await db().select().from(roteiros)).toHaveLength(1);
  });

  it("a reescrita também recusa um longo que deixou de ser vídeo falado (a porta do miolo vale para quem chega sem passar por montarRoteiro)", async () => {
    await medirORamo();
    const v1 = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
    await db().update(roteiros).set({ estilo: "sem_fala" }).where(eq(roteiros.id, v1.id));
    await expect(reprovarERescrever(v1.id, ["gancho_fraco"])).rejects.toThrow(textosRoteiro.longo.soVideoFalado);
    expect((await geracoesDa("roteiroLongo")).length).toBe(1);
  });

  it("reprovar e reescrever mantém o vídeo longo: a v2 é longa, com capítulos, e a entrada pede outra divisão sem repetir o gancho", async () => {
    await medirORamo();
    const v1 = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
    const v2 = await reprovarERescrever(v1.id, ["gancho_fraco"]);

    expect(v2.versao).toBe(2);
    expect(v2.duracaoDoVideo).toBe("longo");
    expect(v2.conteudo.capitulos!.length).toBeGreaterThanOrEqual(3);
    const { entrada } = ultimaChamadaDoLongo();
    expect(entrada).toContain("reprovou a versão anterior");
    expect(entrada).toContain(`A versão reprovada abre com: "${v1.conteudo.gancho}"`);
    expect(v2.conteudo.gancho).not.toBe(v1.conteudo.gancho);
    expect((await geracoesDa("roteiroLongo")).length).toBe(2);
  });
});

describe("a edição de um capítulo e o que sai para fora (E52, PR 4b)", () => {
  async function longoPronto() {
    await medirORamo();
    return gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", duracao: "longo" });
  }

  it("editar um capítulo muda só ele (o gancho e os pontos) e refaz o texto corrido, as cenas e o fechamento a partir dos capítulos", async () => {
    const antes = await longoPronto();
    const caps = antes.conteudo.capitulos!;
    const depois = await editarRoteiro(antes.id, { capitulo: { indice: 1, ganchoParaOProximo: "E o erro seguinte é o que ninguém percebe até ser tarde", pontos: ["Primeiro ponto novo", "Segundo ponto novo"] } });

    const novos = depois.conteudo.capitulos!;
    expect(novos).toHaveLength(caps.length);
    expect(novos[1].ganchoParaOProximo).toBe("E o erro seguinte é o que ninguém percebe até ser tarde");
    expect(novos[1].pontos).toEqual(["Primeiro ponto novo", "Segundo ponto novo"]);
    // os outros capítulos ficam como estavam, inclusive os tempos
    novos.forEach((c, i) => {
      if (i !== 1) expect(c).toEqual(caps[i]);
    });
    expect(novos[1].nome).toBe(caps[1].nome);
    expect(novos[1].inicioS).toBe(caps[1].inicioS);
    expect(novos[1].naImagem).toBe(caps[1].naImagem);
    // o texto corrido acompanha: o corpo tem os pontos novos, as cenas seguem uma por capítulo
    expect(depois.conteudo.corpo).toContain("2. " + novos[1].nome + ": Primeiro ponto novo; Segundo ponto novo");
    expect(depois.conteudo.cenas).toEqual(antes.conteudo.cenas);
    expect(depois.conteudo.fechamento).toBe(antes.conteudo.fechamento);
    expect(depois.conteudo.duracaoS).toBe(antes.conteudo.duracaoS);
    // o original fica guardado e a edição é da pessoa
    expect(depois.editadoPelaPessoa).toBe(true);
    expect(depois.conteudoOriginal?.capitulos?.[1].pontos).toEqual(caps[1].pontos);
  });

  it("editar o último capítulo refaz o fechamento, e o gancho que chega para ele é ignorado (a chamada não segura até nenhum próximo)", async () => {
    const antes = await longoPronto();
    const ultimo = antes.conteudo.capitulos!.length - 1;
    const depois = await editarRoteiro(antes.id, { capitulo: { indice: ultimo, ganchoParaOProximo: "Isto não vale", pontos: ["Resuma o que viu", "Peça a mensagem"] } });
    expect(depois.conteudo.capitulos![ultimo].ganchoParaOProximo).toBeNull();
    expect(depois.conteudo.fechamento).toBe("Resuma o que viu; Peça a mensagem");
  });

  it("o corpo e o fechamento que chegam de fora não valem num roteiro longo: o texto corrido é sempre o dos capítulos", async () => {
    const antes = await longoPronto();
    const depois = await editarRoteiro(antes.id, { corpo: "texto solto que não é dos capítulos", fechamento: "outro texto solto", gancho: "Um gancho novo para o vídeo inteiro" });
    expect(depois.conteudo.corpo).toBe(antes.conteudo.corpo);
    expect(depois.conteudo.fechamento).toBe(antes.conteudo.fechamento);
    expect(depois.conteudo.gancho).toBe("Um gancho novo para o vídeo inteiro");
  });

  it("índice fora da lista, nenhum ponto ou pontos demais é recusado com a frase, e nada é gravado", async () => {
    const antes = await longoPronto();
    const total = antes.conteudo.capitulos!.length;
    await expect(editarRoteiro(antes.id, { capitulo: { indice: total, pontos: ["a"] } })).rejects.toThrow(textosRoteiro.editando.capituloInexistente);
    await expect(editarRoteiro(antes.id, { capitulo: { indice: -1, pontos: ["a"] } })).rejects.toThrow(textosRoteiro.editando.capituloInexistente);
    await expect(editarRoteiro(antes.id, { capitulo: { indice: 0, pontos: [] } })).rejects.toThrow(ErroRoteiro);
    await expect(editarRoteiro(antes.id, { capitulo: { indice: 0, pontos: ["   ", ""] } })).rejects.toThrow(ErroRoteiro);
    await expect(editarRoteiro(antes.id, { capitulo: { indice: 0, pontos: Array.from({ length: 9 }, (_, i) => `ponto ${i}`) } })).rejects.toThrow(ErroRoteiro);
    const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, antes.id));
    expect(linha.editadoPelaPessoa).toBe(false);
    expect(linha.conteudo.capitulos).toEqual(antes.conteudo.capitulos);
  });

  it("um roteiro curto não aceita a edição por capítulo", async () => {
    const curto = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    await expect(editarRoteiro(curto.id, { capitulo: { indice: 0, pontos: ["a"] } })).rejects.toThrow(textosRoteiro.editando.capituloInexistente);
  });

  it("a folha do PDF do longo tem uma seção por capítulo, com o tempo no título, e termina com a lista para colar na descrição, numa página nova", async () => {
    const roteiro = await longoPronto();
    const folha = folhaDoRoteiro(roteiro, "Marca", null);
    const caps = roteiro.conteudo.capitulos!;
    const inicios = iniciosDosCapitulos(caps);
    // o nome de cada capítulo abre uma seção, com o tempo "de a ate" ao lado
    const aberturas = folha.unidades.filter((u) => u.rotulo !== null && u.tempo !== null);
    expect(aberturas.map((u) => u.rotulo)).toEqual(caps.map((c) => c.nome));
    expect(aberturas[0].tempo).toMatch(/^0:00 a \d+:\d{2}$/);
    // a lista para colar é a última seção, em página nova, e é exatamente o texto do "Copiar os capítulos"
    const colar = folha.unidades.filter((u) => u.rotulo === textosRoteiro.capitulos.paraColar || u.novaPagina);
    expect(colar[0].novaPagina).toBe(true);
    const linhasFinais = folha.unidades.slice(folha.unidades.indexOf(colar[0])).map((u) => u.fala);
    expect(linhasFinais.join(String.fromCharCode(10))).toBe(capitulosParaCopiar(caps));
    expect(folha.unidades[folha.unidades.length - 1].fimDoBloco).toBe(true);
    expect(inicios[0]).toBe(0);
    // os chips dizem que é vídeo longo, sem "segundos"
    expect(folha.chips[0]).toBe(textosRoteiro.capitulos.chipYoutube);
    expect(folha.chips.some((c) => /segundos/.test(c))).toBe(false);
    // e o "Como editar o vídeo inteiro" continua na folha
    expect(folha.comoEditar).not.toBeNull();
  });

  it("não há marcas de fala no longo (são do PR 5): a tela não oferece a chave", async () => {
    const roteiro = await longoPronto();
    expect(falaDoRoteiro(roteiro, false).podeMarcar).toBe(false);
  });
});
