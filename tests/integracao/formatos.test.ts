/**
 * Os formatos de vídeo e as chaves da marca (E44 PR 1), contra o Postgres real: o padrão do estudo (oito ligadas), a resposta do cliente, a correção do admin por
 * cima e "voltar ao que o cliente escolheu"; o filtro por formato ligado nos três lugares onde a marca lê o banco (evidência do roteiro, prova do tema e as
 * Referências), com uma marca que desligou "humor e meme" e outra que ligou; e o vídeo ainda sem formato passando pela regra antiga (o corte da H4).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CHAVES_DE_FORMATO, CHAVES_LIGADAS_POR_PADRAO } from "@/config/formatos";
import { db, getPool } from "@/db";
import { clientes, contas, formatosDaMarca, nichos, user, videos } from "@/db/schema";
import { aplicarResultadoExtracao } from "@/jobs/extracao-comum";
import {
  chavesLigadasDaMarca,
  definirFormato,
  ErroFormato,
  filtroDeFormatosDaMarca,
  formatosDaMarcaComEstado,
  responderFormatosDoCliente,
  voltarFormatoAoDoCliente,
} from "@/servicos/formatos";
import { evidenciaParaRoteiro, evidenciaParaTema, evidenciaPorIds, referenciasDoNicho, todosOsVideosDoNicho } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);

const ANALISE = {
  assunto: "limpeza de estofado com vinagre",
  gancho: "gancho",
  estrutura: "estrutura",
  fechamento: "fechamento",
  chamadaFinal: "comenta se voce ja passou por isso",
  porQueFuncionou: "funcionou",
  formato: "fala_para_camera",
};

let nichoId: number;
let marcaSemResposta: number;
let marcaSemMeme: number;
let marcaComMeme: number;

const ids: Record<string, number> = {};

async function criarMarca(nome: string): Promise<number> {
  const usuario = `formatos-${nome}`;
  await db().insert(user).values({ id: usuario, name: nome, email: `${usuario}@exemplo.teste` });
  const [c] = await db().insert(clientes).values({ usuarioId: usuario, nome, nichoId }).returning();
  return c.id;
}

async function criarVideo(chave: string, opcoes: { formato: string | null; serveDeModelo?: boolean | null; tipoConteudo?: "original" | "meme" | "recorte" | null }) {
  // Uma conta por vídeo: as Referências limitam quantos vídeos da mesma conta aparecem (a diversidade da lista).
  const [conta] = await db().insert(contas).values({ plataforma: "tiktok", handle: `formatos-conta-${chave}`, nichoId }).returning();
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno: `formatos-${chave}`,
      url: `https://exemplo.invalido/formatos-${chave}`,
      contaId: conta.id,
      nichoId,
      views: 100_000,
      publicadoEm: diasAtras(1),
      foraDaCurva: "9",
      idioma: "pt",
      analise: { ...ANALISE, assunto: `limpeza de estofado ${chave}` } as never,
      formatoCatalogo: opcoes.formato,
      serveDeModelo: opcoes.serveDeModelo ?? null,
      tipoConteudo: opcoes.tipoConteudo ?? null,
    })
    .returning();
  ids[chave] = v.id;
  return v.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "formatos-teste", nome: "Formatos teste", termos: [] }).returning();
  nichoId = nicho.id;

  marcaSemResposta = await criarMarca("sem-resposta");
  marcaSemMeme = await criarMarca("sem-meme");
  marcaComMeme = await criarMarca("com-meme");

  await criarVideo("passo", { formato: "passo_a_passo", serveDeModelo: true, tipoConteudo: "original" });
  await criarVideo("meme", { formato: "humor_e_meme", serveDeModelo: false, tipoConteudo: "meme" });
  await criarVideo("recorte", { formato: "recorte_de_outro", serveDeModelo: false, tipoConteudo: "recorte" });
  await criarVideo("semfala", { formato: "sem_fala_processo", serveDeModelo: true, tipoConteudo: "original" });
  // Ainda sem formato: passa como hoje, pelo corte da H4 (o `false` explícito sai, o nulo entra).
  await criarVideo("antigoNulo", { formato: null, serveDeModelo: null, tipoConteudo: null });
  await criarVideo("antigoMeme", { formato: null, serveDeModelo: false, tipoConteudo: "meme" });

  await responderFormatosDoCliente(marcaSemMeme, { humor_e_meme: false, passo_a_passo: true }, "formatos-sem-meme");
  await responderFormatosDoCliente(marcaComMeme, { humor_e_meme: true }, "formatos-com-meme");
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("as chaves da marca", () => {
  it("sem resposta, vale o padrão do estudo: as oito ligadas, as cinco desligadas", async () => {
    const estado = await formatosDaMarcaComEstado(marcaSemResposta);
    expect(estado).toHaveLength(13);
    expect(estado.filter((f) => f.ligada).map((f) => f.chave)).toEqual(CHAVES_LIGADAS_POR_PADRAO);
    expect(CHAVES_LIGADAS_POR_PADRAO).toHaveLength(8);
    expect(estado.every((f) => f.quem === "padrao")).toBe(true);
    expect((await filtroDeFormatosDaMarca(marcaSemResposta)).temResposta).toBe(false);
  });

  it("a resposta do cliente vale; a correção do admin vale por cima; voltar ao que o cliente escolheu apaga a do admin", async () => {
    const marca = await criarMarca("camadas");
    await responderFormatosDoCliente(marca, { opiniao_direta: true, lista: false }, "formatos-camadas");
    let estado = await formatosDaMarcaComEstado(marca);
    expect(estado.find((f) => f.chave === "opiniao_direta")).toMatchObject({ ligada: true, quem: "cliente", respostaDoCliente: true });
    expect(estado.find((f) => f.chave === "lista")).toMatchObject({ ligada: false, quem: "cliente" });
    expect((await filtroDeFormatosDaMarca(marca)).temResposta).toBe(true);

    // O admin corrige as duas, em sentidos opostos: a dele vale.
    await definirFormato(marca, "opiniao_direta", false, "admin", "formatos-camadas");
    await definirFormato(marca, "lista", true, "admin", "formatos-camadas");
    estado = await formatosDaMarcaComEstado(marca);
    expect(estado.find((f) => f.chave === "opiniao_direta")).toMatchObject({ ligada: false, quem: "admin", respostaDoCliente: true });
    expect(estado.find((f) => f.chave === "lista")).toMatchObject({ ligada: true, quem: "admin", respostaDoCliente: false });

    // Decidir de novo é a mesma linha (não duplica).
    await definirFormato(marca, "lista", true, "admin", "formatos-camadas");
    expect(await db().select().from(formatosDaMarca).where(eq(formatosDaMarca.clienteId, marca))).toHaveLength(4);

    // Voltar ao que o cliente escolheu.
    await voltarFormatoAoDoCliente(marca, "opiniao_direta");
    await voltarFormatoAoDoCliente(marca, "lista");
    estado = await formatosDaMarcaComEstado(marca);
    expect(estado.find((f) => f.chave === "opiniao_direta")).toMatchObject({ ligada: true, quem: "cliente" });
    expect(estado.find((f) => f.chave === "lista")).toMatchObject({ ligada: false, quem: "cliente" });
    expect((await chavesLigadasDaMarca(marca)).includes("lista")).toBe(false);
  });

  it("uma chave que não existe é recusada, e as marcas não se misturam", async () => {
    await expect(definirFormato(marcaSemResposta, "formato_inventado", true, "admin", null)).rejects.toBeInstanceOf(ErroFormato);
    await expect(responderFormatosDoCliente(marcaSemResposta, { inventado: true }, "formatos-sem-resposta")).rejects.toBeInstanceOf(ErroFormato);
    expect(CHAVES_DE_FORMATO).toHaveLength(13);
    expect(await db().select().from(formatosDaMarca).where(eq(formatosDaMarca.clienteId, marcaSemResposta))).toEqual([]);
  });
});

describe("o filtro por formato onde a marca lê o banco", () => {
  it("evidência do roteiro: a marca que desligou 'humor e meme' não recebe o meme; a que ligou recebe; a sem resposta fica com o padrão e a regra antiga", async () => {
    const semMeme = await evidenciaParaRoteiro(nichoId, "limpeza de estofado", 20, [], await filtroDeFormatosDaMarca(marcaSemMeme));
    const comMeme = await evidenciaParaRoteiro(nichoId, "limpeza de estofado", 20, [], await filtroDeFormatosDaMarca(marcaComMeme));
    const semResposta = await evidenciaParaRoteiro(nichoId, "limpeza de estofado", 20, [], await filtroDeFormatosDaMarca(marcaSemResposta));
    const idsDe = (lista: { id: number }[]) => lista.map((v) => v.id);

    expect(idsDe(semMeme)).toContain(ids.passo);
    expect(idsDe(semMeme)).not.toContain(ids.meme);
    // Com resposta, o corte global de meme da H4 sai e vale o formato: o meme entra para quem ligou "humor e meme".
    expect(idsDe(comMeme)).toContain(ids.meme);
    // Recorte de outro nunca serve de modelo, para marca nenhuma.
    for (const lista of [semMeme, comMeme, semResposta]) expect(idsDe(lista)).not.toContain(ids.recorte);
    // Sem resposta: os oito do padrão (humor e meme desligado) e o corte da H4 de sempre.
    expect(idsDe(semResposta)).toContain(ids.passo);
    expect(idsDe(semResposta)).not.toContain(ids.meme);
    // O vídeo sem fala passa pela régua do setor, não pelas chaves do cliente.
    expect(idsDe(semMeme)).toContain(ids.semfala);
  });

  it("o vídeo ainda sem formato (não reclassificado) passa como hoje: o nulo entra, o meme marcado pela H4 continua fora", async () => {
    const lista = await evidenciaParaRoteiro(nichoId, "limpeza de estofado", 20, [], await filtroDeFormatosDaMarca(marcaSemMeme));
    const idsDeLista = lista.map((v) => v.id);
    expect(idsDeLista).toContain(ids.antigoNulo);
    expect(idsDeLista).not.toContain(ids.antigoMeme);
    // Sem o filtro da marca (testes, ferramentas), nada mudou: continua como antes do E44.
    const antigo = (await evidenciaParaRoteiro(nichoId, "limpeza de estofado", 20)).map((v) => v.id);
    expect(antigo).toContain(ids.passo);
    expect(antigo).not.toContain(ids.meme);
  });

  it("evidência do roteiro traz o formato do vídeo (para o roteiro ser escrito nesse formato)", async () => {
    const lista = await evidenciaParaRoteiro(nichoId, "limpeza de estofado", 20, [], await filtroDeFormatosDaMarca(marcaComMeme));
    expect(lista.find((v) => v.id === ids.passo)?.formatoCatalogo).toBe("passo_a_passo");
    expect(lista.find((v) => v.id === ids.meme)?.formatoCatalogo).toBe("humor_e_meme");
    expect(lista.find((v) => v.id === ids.antigoNulo)?.formatoCatalogo).toBeNull();
  });

  it("as evidências já previstas (por id) também respeitam o formato", async () => {
    const todas = Object.values(ids);
    const semMeme = (await evidenciaPorIds(todas, await filtroDeFormatosDaMarca(marcaSemMeme))).map((v) => v.id);
    const comMeme = (await evidenciaPorIds(todas, await filtroDeFormatosDaMarca(marcaComMeme))).map((v) => v.id);
    expect(semMeme).not.toContain(ids.meme);
    expect(comMeme).toContain(ids.meme);
    expect(comMeme).not.toContain(ids.recorte);
  });

  it("prova do tema: o mesmo filtro", async () => {
    const semMeme = (await evidenciaParaTema(nichoId, "limpeza de estofado", 20, undefined, [], await filtroDeFormatosDaMarca(marcaSemMeme))).map((v) => v.id);
    const comMeme = (await evidenciaParaTema(nichoId, "limpeza de estofado", 20, undefined, [], await filtroDeFormatosDaMarca(marcaComMeme))).map((v) => v.id);
    expect(semMeme).toContain(ids.passo);
    expect(semMeme).not.toContain(ids.meme);
    expect(comMeme).toContain(ids.meme);
  });

  it("Referências, nos dois caminhos (os que respeitam a régua e o 'Todos'): só formato ligado", async () => {
    const semMeme = await filtroDeFormatosDaMarca(marcaSemMeme);
    const comMeme = await filtroDeFormatosDaMarca(marcaComMeme);

    const regua = (await referenciasDoNicho(nichoId, { periodoDias: 90, formatosDaMarca: semMeme })).videos.map((v) => v.id);
    expect(regua).toContain(ids.passo);
    expect(regua).not.toContain(ids.meme);
    expect(regua).not.toContain(ids.recorte);
    const reguaComMeme = (await referenciasDoNicho(nichoId, { periodoDias: 90, formatosDaMarca: comMeme })).videos.map((v) => v.id);
    expect(reguaComMeme).toContain(ids.meme);

    const todos = (await todosOsVideosDoNicho(nichoId, { periodoDias: 90, formatosDaMarca: semMeme })).videos.map((v) => v.id);
    expect(todos).toContain(ids.passo);
    expect(todos).not.toContain(ids.meme);
    expect(todos).toContain(ids.antigoNulo);
    const todosComMeme = (await todosOsVideosDoNicho(nichoId, { periodoDias: 90, formatosDaMarca: comMeme })).videos.map((v) => v.id);
    expect(todosComMeme).toContain(ids.meme);
  });
});

describe("a extração grava o formato", () => {
  it("aplicarResultadoExtracao grava formato_catalogo em coluna própria, fora do jsonb da análise", async () => {
    const id = await criarVideo("extraido", { formato: null });
    await aplicarResultadoExtracao(id, {
      assunto: "a",
      gancho: "g",
      estrutura: "e",
      fechamento: "f",
      chamadaFinal: "c",
      formato: "fala_para_camera",
      porQueFuncionou: "p",
      etiquetas: ["x"],
      pertenceAoNicho: true,
      motivoNicho: "m",
      idioma: "pt-BR",
      tipoAbertura: "outro",
      tipoConteudo: "original",
      serveDeModelo: true,
      formatoCatalogo: "antes_e_depois",
    });
    const [video] = await db().select({ formato: videos.formatoCatalogo, analise: videos.analise }).from(videos).where(eq(videos.id, id));
    expect(video.formato).toBe("antes_e_depois");
    expect(video.analise).not.toHaveProperty("formatoCatalogo");
  });
});
