/**
 * Os vídeos longos nas Referências (E52, PR 4c), contra o Postgres real: a lista é a dos longos do ramo acima do piso, só YouTube e só do setor (o de outro setor não entra, nem o curto, nem o
 * fora da janela), filtrada pela busca, pelas views mínimas e por "Brasil ou fora", na ordem pedida; o cartão leva os capítulos que o dono escreveu e "o capítulo que interessa" só quando a
 * leitura da estrutura existe e a abertura entrega. Os vídeos são inventados (o repositório é público).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos, type AnaliseVideoLonga } from "@/db/schema";
import { longosParaAsReferencias, quantosLongosTemOsRamos } from "@/servicos/referencias-longas";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const NOVE_CAPITULOS = ["00:00 Abertura", "01:00 Primeiro erro", "03:00 Segundo erro", "05:00 O teste", "07:00 Terceiro erro", "08:30 Quarto erro", "10:00 Fechamento"].join(String.fromCharCode(10));

let nichoId = 0;
let outroNichoId = 0;
let contaBr = 0;
let contaFora = 0;
let contaOutroSetor = 0;
let sequencia = 0;
const ids: Record<string, number> = {};

function analise(entregaAteS: number | null): AnaliseVideoLonga {
  return {
    versaoPrompt: "1.0.0",
    origemDosCapitulos: "descricao",
    assunto: "mancha no sofá",
    abertura: { promessa: "mostra o antes e o depois da mancha", entregaAteS, tipo: "resultado" },
    capitulos: [
      { inicioS: 0, nome: "Abertura", oQueFaz: "mostra o resultado", gancho: "mas o erro vem a seguir" },
      { inicioS: 60, nome: "Primeiro erro", oQueFaz: "esfrega antes do tempo", gancho: "e o segundo é pior" },
      { inicioS: 180, nome: "Segundo erro", oQueFaz: "produto demais", gancho: "agora o teste" },
      { inicioS: 300, nome: "O teste", oQueFaz: "canto escondido", gancho: "falta o último" },
      { inicioS: 420, nome: "Fechamento", oQueFaz: "resume", gancho: null },
    ],
    lacos: [],
    ondeSairia: [{ segundo: 120, porQue: "a lista é longa" }],
    fechamento: { oQueFaz: "pede o comentário", apontaParaProximoVideo: false },
    porQueFuncionou: "mostra o resultado antes de explicar",
  };
}

async function semear(chave: string, opcoes: { duracaoS?: number; conta?: number; nicho?: number; views?: number; foraDaCurva?: string; diasAtras?: number; descricao?: string | null; analise?: AnaliseVideoLonga; idioma?: string; titulo?: string; plataforma?: "youtube" | "instagram" }) {
  sequencia += 1;
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: opcoes.plataforma ?? "youtube",
      idExterno: `ref-longo-${sequencia}`,
      url: `https://exemplo.invalido/ref-longo-${sequencia}`,
      nichoId: opcoes.nicho ?? nichoId,
      contaId: opcoes.conta ?? contaBr,
      titulo: opcoes.titulo ?? `[exemplo] ${chave}`,
      descricao: opcoes.descricao ?? null,
      views: opcoes.views ?? 200_000,
      foraDaCurva: opcoes.foraDaCurva ?? "3.000",
      duracaoS: opcoes.duracaoS ?? 600,
      publicadoEm: new Date(Date.now() - (opcoes.diasAtras ?? 5) * DIA_MS),
      idioma: opcoes.idioma ?? "pt",
      analiseLonga: opcoes.analise,
      capaUrl: `https://exemplo.invalido/capa-${sequencia}.jpg`,
      origem: "coleta",
    })
    .returning();
  ids[chave] = v.id;
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [outro] = await db().insert(nichos).values({ slug: "ref-longo-outro", nome: "Odontologia", termos: ["dentista"] }).returning();
  const [nicho] = await db().insert(nichos).values({ slug: "ref-longo", nome: "Produtos de limpeza", termos: ["limpeza"], pisoViews: 50_000 }).returning();
  outroNichoId = outro.id;
  nichoId = nicho.id;
  const [br] = await db().insert(contas).values({ plataforma: "youtube", handle: "ref-longo-br", nome: "Casa Limpa Vídeos", nichoId, pais: "BR", idiomaPrincipal: "pt", medianaViews: 89_500, medianaOrigem: "conta" }).returning();
  const [fora] = await db().insert(contas).values({ plataforma: "youtube", handle: "ref-longo-fora", nome: "Clean Home", nichoId, pais: "US", idiomaPrincipal: "en" }).returning();
  const [outraConta] = await db().insert(contas).values({ plataforma: "youtube", handle: "ref-longo-outro", nome: "Dentista Dicas", nichoId: outroNichoId, pais: "BR", idiomaPrincipal: "pt" }).returning();
  contaBr = br.id;
  contaFora = fora.id;
  contaOutroSetor = outraConta.id;

  // com leitura que entrega aos 200 s (cai no capítulo "Segundo erro", de 3:00 a 5:00), com capítulos na descrição
  await semear("comLeitura", { titulo: "os 4 erros que estragam o sofá", descricao: NOVE_CAPITULOS, analise: analise(200), views: 412_000, foraDaCurva: "4.600", duracaoS: 662 });
  // com leitura, mas a abertura não entrega: não há capítulo que interesse
  await semear("naoEntrega", { titulo: "limpeza profunda do estofado", analise: analise(null), views: 150_000, foraDaCurva: "2.000" });
  // sem leitura: "Ver desde o começo"
  await semear("semLeitura", { titulo: "organizar o armário da cozinha", views: 90_000, foraDaCurva: "1.500", diasAtras: 2 });
  // de fora do Brasil
  await semear("deFora", { titulo: "how to clean a couch", conta: contaFora, idioma: "en", views: 600_000, foraDaCurva: "5.200" });
  // o que não entra
  await semear("curto", { titulo: "mancha rápida", duracaoS: 45 });
  await semear("muitoLongo", { titulo: "ao vivo de quatro horas", duracaoS: 4 * 3600 });
  await semear("outroSetor", { titulo: "clareamento dental", conta: contaOutroSetor, nicho: outroNichoId });
  await semear("foraDaJanela", { titulo: "vídeo antigo", diasAtras: 60 });
  await semear("abaixoDoPiso", { titulo: "poucas views", views: 1_000 });
  await semear("instagram", { titulo: "reel que passou de 3 minutos", plataforma: "instagram" });
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

const idsDe = (r: { videos: { id: number }[] }) => r.videos.map((v) => v.id);

describe("quais vídeos longos entram", () => {
  it("só os longos do YouTube do ramo, acima do piso e dentro da janela; nenhum curto, nenhum de outro setor, nenhum de hoje com mais de quarenta minutos", async () => {
    const r = await longosParaAsReferencias({ nichoIds: [nichoId] });
    expect(new Set(idsDe(r))).toEqual(new Set([ids.comLeitura, ids.naoEntrega, ids.semLeitura, ids.deFora]));
    expect(r.total).toBe(4);
  });

  it("a janela larga (90 dias) traz o vídeo de dois meses; a padrão (30) não", async () => {
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], dias: 30 }))).not.toContain(ids.foraDaJanela);
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], dias: 90 }))).toContain(ids.foraDaJanela);
  });

  it("o ramo pedido manda: o de outro setor só aparece quando ele é pedido, e vários ramos juntam as listas", async () => {
    const outro = await longosParaAsReferencias({ nichoIds: [outroNichoId] });
    expect(idsDe(outro)).toEqual([ids.outroSetor]);
    const juntos = await longosParaAsReferencias({ nichoIds: [nichoId, outroNichoId] });
    expect(idsDe(juntos)).toContain(ids.outroSetor);
    expect(idsDe(juntos)).toContain(ids.comLeitura);
    expect(await quantosLongosTemOsRamos([nichoId])).toBe(4);
    expect(await quantosLongosTemOsRamos([])).toBe(0);
  });

  it("um ramo sem nenhum vídeo longo devolve lista vazia, sem erro", async () => {
    const [vazio] = await db().insert(nichos).values({ slug: "ref-longo-vazio", nome: "Sem longos", termos: ["x"] }).returning();
    expect(await longosParaAsReferencias({ nichoIds: [vazio.id] })).toEqual({ videos: [], total: 0 });
    expect(await quantosLongosTemOsRamos([vazio.id])).toBe(0);
  });
});

describe("os filtros que valem para o longo", () => {
  it("a busca olha o título e o nome da conta, sem acento nem maiúscula", async () => {
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], busca: "SOFA" }))).toEqual([ids.comLeitura]);
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], busca: "casa limpa" })).sort()).toEqual([ids.comLeitura, ids.naoEntrega, ids.semLeitura].sort());
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], busca: "xyz-nada" }))).toEqual([]);
  });

  it("as views mínimas cortam abaixo delas", async () => {
    expect(new Set(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], viewsMin: 100_000 })))).toEqual(new Set([ids.comLeitura, ids.naoEntrega, ids.deFora]));
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], viewsMin: 500_000 }))).toEqual([ids.deFora]);
  });

  it("'Brasil ou fora' separa o vídeo do Brasil do de fora", async () => {
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], brasil: false }))).toEqual([ids.deFora]);
    expect(new Set(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], brasil: true })))).toEqual(new Set([ids.comLeitura, ids.naoEntrega, ids.semLeitura]));
  });

  it("a ordem padrão é a dos mais acima do normal da conta; 'views' e 'recentes' reordenam; só os salvos entram quando pedidos", async () => {
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId] }))).toEqual([ids.deFora, ids.comLeitura, ids.naoEntrega, ids.semLeitura]);
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], ordem: "views" }))).toEqual([ids.deFora, ids.comLeitura, ids.naoEntrega, ids.semLeitura]);
    // o mais recente primeiro: "semLeitura" é de 2 dias atrás, os outros de 5
    expect((await longosParaAsReferencias({ nichoIds: [nichoId], ordem: "recentes" })).videos[0].id).toBe(ids.semLeitura);
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], apenasIds: [ids.semLeitura, ids.outroSetor] }))).toEqual([ids.semLeitura]);
    expect(idsDe(await longosParaAsReferencias({ nichoIds: [nichoId], apenasIds: [] }))).toEqual([]);
  });

  it("os filtros somam: busca mais views mais Brasil", async () => {
    const r = await longosParaAsReferencias({ nichoIds: [nichoId], busca: "estofado", viewsMin: 100_000, brasil: true });
    expect(idsDe(r)).toEqual([ids.naoEntrega]);
    expect(r.total).toBe(1);
  });
});

describe("o cartão do longo", () => {
  it("leva os capítulos da descrição (até cinco, com quantos faltam), a conta, a mediana e a capa", async () => {
    const r = await longosParaAsReferencias({ nichoIds: [nichoId], busca: "sofá" });
    const v = r.videos[0];
    expect(v.contaNome).toBe("Casa Limpa Vídeos");
    expect(v.medianaConta).toBe(89_500);
    expect(v.capaUrl).toContain("capa-");
    expect(v.capitulos.map((c) => c.titulo)).toEqual(["Abertura", "Primeiro erro", "Segundo erro", "O teste", "Terceiro erro"]);
    expect(v.capitulos[3].inicioS).toBe(300);
    expect(v.totalDeCapitulos).toBe(7);
    expect(v.duracaoS).toBe(662);
    expect(v.nichoId).toBe(nichoId);
  });

  it("com a leitura e a abertura que entrega, 'o capítulo que interessa' é o que contém o segundo da entrega, com a promessa", async () => {
    const [v] = (await longosParaAsReferencias({ nichoIds: [nichoId], busca: "sofá" })).videos;
    expect(v.capituloQueInteressa).toEqual({ inicioS: 180, fimS: 300, nome: "Segundo erro", promessa: "mostra o antes e o depois da mancha" });
    expect(v.leitura?.porQueFuncionou).toContain("resultado antes");
  });

  it("sem leitura, ou com a abertura que não entrega, não há capítulo que interessa (nada é inventado)", async () => {
    const todos = (await longosParaAsReferencias({ nichoIds: [nichoId] })).videos;
    expect(todos.find((v) => v.id === ids.naoEntrega)?.capituloQueInteressa).toBeNull();
    expect(todos.find((v) => v.id === ids.semLeitura)?.capituloQueInteressa).toBeNull();
    expect(todos.find((v) => v.id === ids.semLeitura)?.leitura).toBeNull();
    // sem capítulos na descrição, a lista é vazia
    expect(todos.find((v) => v.id === ids.semLeitura)?.capitulos).toEqual([]);
  });
});
