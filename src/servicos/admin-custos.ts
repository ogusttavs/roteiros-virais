import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { CAMBIO_USD_BRL, CUSTO_FIXO_MENSAL_BRL, TETO_DIARIO_BRL, usdParaBrl } from "@/config/dinheiro";
import { db } from "@/db";
import { clientes, configuracaoAdmin, custosExternos, custosFixos, geracoesIA, nichos, roteiros, type CustoFixo } from "@/db/schema";
import { hojeISO } from "@/lib/config";

const DIA_MS = 24 * 60 * 60 * 1000;
const CHAVE_TETO = "teto_diario_brl";

/** O que cada tarefa de IA é, em língua de gente, para "Por onde o dinheiro vai". O que não está aqui aparece pelo nome da tarefa. */
export const ROTULO_DA_TAREFA: Record<string, string> = {
  roteiro: "IA: escrever os roteiros",
  verificarTexto: "IA: conferir o que foi escrito",
  temasDoDia: "IA: temas do dia",
  avaliarTema: "IA: notas dos temas",
  avaliarResposta: "IA: notas do briefing",
  compilarPerfil: "IA: perfil da marca",
  aprenderCliente: "IA: aprender com as reprovações",
  extrairVideo: "Analisar os vídeos",
  extrairVideoSemFala: "Analisar os vídeos sem fala",
  analisarVisual: "Analisar os vídeos (imagem)",
  modeloNicho: "Montar o modelo do ramo",
  filtrarNoticias: "Escolher as notícias",
  sugerirContasDoSetor: "Pesquisar o mercado do ramo",
  classificarContaDoSetor: "Pesquisar o mercado do ramo",
  entenderMarca: "Entender a marca",
  analisarPerfilCitado: "Entender a marca",
};

export function rotuloDaTarefa(tarefa: string): string {
  return ROTULO_DA_TAREFA[tarefa] ?? tarefa;
}

/** O início do dia (00:00 no Brasil) de uma data "YYYY-MM-DD". */
function inicioDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00-03:00`);
}

/** O valor mensal em reais de um fixo: dólar pelo câmbio do dia, anual dividido por 12. */
export function fixoPorMesEmReais(f: Pick<CustoFixo, "valor" | "moeda" | "periodo">): number {
  const valor = Number(f.valor);
  const emReais = f.moeda === "usd" ? valor * CAMBIO_USD_BRL : valor;
  return f.periodo === "anual" ? emReais / 12 : emReais;
}

export async function tetoDiarioEmReais(): Promise<number> {
  const [linha] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_TETO));
  const n = linha ? Number(linha.valor) : NaN;
  return Number.isFinite(n) && n > 0 ? n : TETO_DIARIO_BRL;
}

export async function definirTetoDiario(reais: number, porUsuarioId: string): Promise<void> {
  if (typeof reais !== "number" || !Number.isFinite(reais) || reais < 0.01 || reais > 100000) throw new ErroCusto("o teto precisa ser um valor maior que zero.");
  await db()
    .insert(configuracaoAdmin)
    .values({ chave: CHAVE_TETO, valor: String(reais), atualizadoPorUsuarioId: porUsuarioId })
    .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor: String(reais), atualizadoPorUsuarioId: porUsuarioId, atualizadoEm: new Date() } });
}

export class ErroCusto extends Error {}

export async function fixosAtivos(): Promise<CustoFixo[]> {
  return db().select().from(custosFixos).where(eq(custosFixos.ativo, true)).orderBy(custosFixos.id);
}

/** O fixo do mês em reais: a soma dos cadastrados; sem nenhum cadastrado, o da apresentação (R$ 1.639), dito na tela. */
export async function fixoMensalEmReais(): Promise<{ total: number; cadastrados: number }> {
  const lista = await fixosAtivos();
  if (lista.length === 0) return { total: CUSTO_FIXO_MENSAL_BRL, cadastrados: 0 };
  return { total: lista.reduce((a, f) => a + fixoPorMesEmReais(f), 0), cadastrados: lista.length };
}

export type DadosDoFixo = { nome: string; valor: number; moeda: "brl" | "usd"; periodo: "mensal" | "anual"; cobra?: string };

function validarFixo(d: DadosDoFixo): DadosDoFixo {
  if (typeof d?.nome !== "string" || typeof d.valor !== "number") throw new ErroCusto("confira o nome e o valor.");
  const nome = d.nome.trim();
  if (!nome || nome.length > 80) throw new ErroCusto("escreva o nome do custo, em até 80 letras.");
  if (!Number.isFinite(d.valor) || d.valor < 0 || d.valor > 10_000_000) throw new ErroCusto("o valor precisa ser um número, zero ou mais.");
  if (d.moeda !== "brl" && d.moeda !== "usd") throw new ErroCusto("a moeda é real ou dólar.");
  if (d.periodo !== "mensal" && d.periodo !== "anual") throw new ErroCusto("o período é por mês ou por ano.");
  return { nome, valor: d.valor, moeda: d.moeda, periodo: d.periodo, cobra: d.cobra?.trim().slice(0, 120) || undefined };
}

export async function adicionarFixo(dados: DadosDoFixo, porUsuarioId: string | null = null): Promise<CustoFixo> {
  const d = validarFixo(dados);
  const [novo] = await db().insert(custosFixos).values({ nome: d.nome, valor: d.valor.toFixed(2), moeda: d.moeda, periodo: d.periodo, cobra: d.cobra ?? null, criadoPorUsuarioId: porUsuarioId, atualizadoPorUsuarioId: porUsuarioId }).returning();
  return novo;
}

export async function editarFixo(id: number, dados: DadosDoFixo, porUsuarioId: string | null = null): Promise<CustoFixo> {
  const d = validarFixo(dados);
  const [linha] = await db()
    .update(custosFixos)
    .set({ nome: d.nome, valor: d.valor.toFixed(2), moeda: d.moeda, periodo: d.periodo, cobra: d.cobra ?? null, ...(porUsuarioId ? { atualizadoPorUsuarioId: porUsuarioId } : {}) })
    .where(and(eq(custosFixos.id, id), eq(custosFixos.ativo, true)))
    .returning();
  if (!linha) throw new ErroCusto("esse custo não existe mais.");
  return linha;
}

/** Tirar não apaga: o custo sai dos fixos de agora e continua na linha, com a data. */
export async function tirarFixo(id: number, porUsuarioId: string | null = null): Promise<void> {
  const tirados = await db().update(custosFixos).set({ ativo: false, tiradoEm: new Date(), ...(porUsuarioId ? { tiradoPorUsuarioId: porUsuarioId } : {}) }).where(and(eq(custosFixos.id, id), eq(custosFixos.ativo, true))).returning({ id: custosFixos.id });
  if (tirados.length === 0) throw new ErroCusto("esse custo não existe mais.");
}

/** O que cada serviço pago fora da IA é, em língua de gente. */
export const ROTULO_DA_FONTE_EXTERNA: Record<string, string> = {
  groq: "Transcrever os vídeos (Groq)",
  apify: "Buscar vídeos no TikTok e no Instagram (Apify)",
};

export type LinhaForaDaIA = { fonte: string; rotulo: string; usd: number; unidades: number; unidade: "minutos" | "resultados"; execucoes: number; algumEstimado: boolean };
export type LinhaDoRamo = { nichoId: number; nome: string; iaUsd: number; foraUsd: number; usd: number };

export type LinhaDeCusto = { chave: string; rotulo: string; usd: number; vezes: number };

export type CustosDoAdmin = {
  agora: Date;
  semDado: boolean;
  hoje: { usd: number; passouDoTeto: boolean; maisGastou: LinhaDeCusto | null };
  tetoBrl: number;
  ultimos7Usd: number;
  ultimos30Usd: number;
  roteiros30: number;
  porRoteiroUsd: number | null;
  porConta: { clienteId: number; nome: string; usd: number; roteiros: number }[];
  baseDosRamosUsd: number;
  /** O custo de 30 dias por ramo: a IA mais o que se paga fora dela (Groq e Apify). `semRamoUsd` é o que não é de um ramo só. */
  porRamo: LinhaDoRamo[];
  semRamoUsd: number;
  foraDaIA: { linhas: LinhaForaDaIA[]; totalUsd: number };
  porOndeVai: LinhaDeCusto[];
  fixos: { lista: (CustoFixo & { porMesBrl: number })[]; totalPorMesBrl: number; cadastrados: boolean };
};

/** Tudo o que a página de Custos mostra. Os 7 e os 30 dias vão até ontem: hoje fica à parte (o desenho, dúvida 12). */
export async function custosDoAdmin(agora: Date = new Date()): Promise<CustosDoAdmin> {
  const hoje = hojeISO(agora);
  const inicioHoje = inicioDoDia(hoje);
  const desde30 = new Date(inicioHoje.getTime() - 30 * DIA_MS);
  const desde7 = new Date(inicioHoje.getTime() - 7 * DIA_MS);
  const soma = sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)`;

  const [[doDia], [de7], [de30], tarefasHoje, tarefas30, contas30, [semConta], roteirosPorConta, [temAlgo], tetoBrl, fixos, iaPorRamo, foraPorRamo, foraPorFonte] = await Promise.all([
    db().select({ total: soma }).from(geracoesIA).where(gte(geracoesIA.criadoEm, inicioHoje)),
    db().select({ total: soma }).from(geracoesIA).where(and(gte(geracoesIA.criadoEm, desde7), lt(geracoesIA.criadoEm, inicioHoje))),
    db().select({ total: soma }).from(geracoesIA).where(and(gte(geracoesIA.criadoEm, desde30), lt(geracoesIA.criadoEm, inicioHoje))),
    db().select({ tarefa: geracoesIA.tarefa, usd: soma, vezes: sql<number>`count(*)::int` }).from(geracoesIA).where(gte(geracoesIA.criadoEm, inicioHoje)).groupBy(geracoesIA.tarefa),
    db().select({ tarefa: geracoesIA.tarefa, usd: soma, vezes: sql<number>`count(*)::int` }).from(geracoesIA).where(and(gte(geracoesIA.criadoEm, desde30), lt(geracoesIA.criadoEm, inicioHoje))).groupBy(geracoesIA.tarefa),
    db()
      .select({ clienteId: geracoesIA.clienteId, nome: clientes.nome, usd: soma })
      .from(geracoesIA)
      .innerJoin(clientes, eq(clientes.id, geracoesIA.clienteId))
      .where(and(gte(geracoesIA.criadoEm, desde30), lt(geracoesIA.criadoEm, inicioHoje), isNotNull(geracoesIA.clienteId)))
      .groupBy(geracoesIA.clienteId, clientes.nome)
      .orderBy(desc(soma)),
    db().select({ total: soma }).from(geracoesIA).where(and(gte(geracoesIA.criadoEm, desde30), lt(geracoesIA.criadoEm, inicioHoje), isNull(geracoesIA.clienteId))),
    db().select({ clienteId: roteiros.clienteId, total: sql<number>`count(*)::int` }).from(roteiros).where(and(gte(roteiros.data, hojeISO(desde30)), lt(roteiros.data, hoje))).groupBy(roteiros.clienteId),
    db().select({ n: sql<number>`count(*)::int` }).from(geracoesIA).limit(1),
    tetoDiarioEmReais(),
    fixosAtivos(),
    db()
      .select({ nichoId: geracoesIA.ramoId, usd: soma })
      .from(geracoesIA)
      .where(and(gte(geracoesIA.criadoEm, desde30), lt(geracoesIA.criadoEm, inicioHoje)))
      .groupBy(geracoesIA.ramoId),
    db()
      .select({ nichoId: custosExternos.ramoId, usd: sql<string>`coalesce(sum(${custosExternos.custoUsd}), 0)` })
      .from(custosExternos)
      .where(and(gte(custosExternos.criadoEm, desde30), lt(custosExternos.criadoEm, inicioHoje)))
      .groupBy(custosExternos.ramoId),
    db()
      .select({
        fonte: custosExternos.fonte,
        unidade: custosExternos.unidade,
        usd: sql<string>`coalesce(sum(${custosExternos.custoUsd}), 0)`,
        unidades: sql<string>`coalesce(sum(${custosExternos.unidades}), 0)`,
        execucoes: sql<number>`count(*)::int`,
        estimados: sql<number>`count(*) filter (where ${custosExternos.origemDoCusto} = 'estimado')::int`,
      })
      .from(custosExternos)
      .where(and(gte(custosExternos.criadoEm, desde30), lt(custosExternos.criadoEm, inicioHoje)))
      .groupBy(custosExternos.fonte, custosExternos.unidade),
  ]);

  const idsDosRamos = [...new Set([...iaPorRamo, ...foraPorRamo].map((x) => x.nichoId).filter((x): x is number => x !== null))];
  const nomesDosRamos = idsDosRamos.length > 0 ? await db().select({ id: nichos.id, nome: nichos.nome }).from(nichos).where(inArray(nichos.id, idsDosRamos)) : [];
  const nomeDoRamo = new Map(nomesDosRamos.map((n) => [n.id, n.nome]));
  const porRamoMapa = new Map<number, LinhaDoRamo>();
  let semRamoUsd = 0;
  for (const [lista, campo] of [[iaPorRamo, "iaUsd"], [foraPorRamo, "foraUsd"]] as const) {
    for (const x of lista) {
      const valor = Number(x.usd);
      if (x.nichoId === null) {
        semRamoUsd += valor;
        continue;
      }
      const atual = porRamoMapa.get(x.nichoId) ?? { nichoId: x.nichoId, nome: nomeDoRamo.get(x.nichoId) ?? `Ramo ${x.nichoId}`, iaUsd: 0, foraUsd: 0, usd: 0 };
      atual[campo] += valor;
      atual.usd += valor;
      porRamoMapa.set(x.nichoId, atual);
    }
  }
  const foraLinhas: LinhaForaDaIA[] = foraPorFonte.map((f) => ({ fonte: f.fonte, rotulo: ROTULO_DA_FONTE_EXTERNA[f.fonte] ?? f.fonte, usd: Number(f.usd), unidades: Number(f.unidades), unidade: f.unidade, execucoes: f.execucoes, algumEstimado: f.estimados > 0 })).sort((a, b) => b.usd - a.usd);

  const roteirosDe = new Map(roteirosPorConta.map((r) => [r.clienteId, r.total]));
  const roteiros30 = roteirosPorConta.reduce((a, r) => a + r.total, 0);
  const ultimos30Usd = Number(de30?.total ?? 0);
  const linhas = (l: { tarefa: string; usd: string; vezes: number }[]) => {
    const porRotulo = new Map<string, LinhaDeCusto>();
    for (const x of l) {
      const rotulo = rotuloDaTarefa(x.tarefa);
      const atual = porRotulo.get(rotulo) ?? { chave: x.tarefa, rotulo, usd: 0, vezes: 0 };
      atual.usd += Number(x.usd);
      atual.vezes += x.vezes;
      porRotulo.set(rotulo, atual);
    }
    return [...porRotulo.values()].sort((a, b) => b.usd - a.usd);
  };
  const hojeLinhas = linhas(tarefasHoje);
  const hojeUsd = Number(doDia?.total ?? 0);
  const listaFixos = fixos.map((f) => ({ ...f, porMesBrl: fixoPorMesEmReais(f) }));

  return {
    agora,
    semDado: (temAlgo?.n ?? 0) === 0 && listaFixos.length === 0,
    hoje: { usd: hojeUsd, passouDoTeto: usdParaBrl(hojeUsd) > tetoBrl, maisGastou: hojeLinhas[0] ?? null },
    tetoBrl,
    ultimos7Usd: Number(de7?.total ?? 0),
    ultimos30Usd,
    roteiros30,
    porRoteiroUsd: roteiros30 > 0 ? ultimos30Usd / roteiros30 : null,
    porConta: contas30.map((c) => ({ clienteId: c.clienteId!, nome: c.nome, usd: Number(c.usd), roteiros: roteirosDe.get(c.clienteId!) ?? 0 })),
    baseDosRamosUsd: Number(semConta?.total ?? 0),
    porRamo: [...porRamoMapa.values()].sort((a, b) => b.usd - a.usd),
    semRamoUsd,
    foraDaIA: { linhas: foraLinhas, totalUsd: foraLinhas.reduce((a, l) => a + l.usd, 0) },
    porOndeVai: linhas(tarefas30),
    fixos: { lista: listaFixos, totalPorMesBrl: listaFixos.reduce((a, f) => a + f.porMesBrl, 0), cadastrados: listaFixos.length > 0 },
  };
}
