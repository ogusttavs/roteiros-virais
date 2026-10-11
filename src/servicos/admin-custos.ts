import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { CAMBIO_USD_BRL, CUSTO_FIXO_MENSAL_BRL, TETO_DIARIO_BRL, usdParaBrl } from "@/config/dinheiro";
import { db } from "@/db";
import { clientes, configuracaoAdmin, custosExternos, custosFixos, geracoesIA, nichos, pesquisasNaHora, roteiros, type CustoFixo, type StatusDaPesquisa } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { textosCustosAdmin } from "@/textos/admin-custos";
import { reaisEmLinguagemDeGente } from "@/textos/pesquisa";

import { encerrarPesquisasParadas, estimarPesquisa, PESO_DA_PROFUNDIDADE, type Profundidade } from "./pesquisa-na-hora";

const DIA_MS = 24 * 60 * 60 * 1000;
const CHAVE_TETO = "teto_diario_brl";

/** O que cada tarefa de IA é, em língua de gente, para "Por onde o dinheiro vai". O que não está aqui aparece pelo nome da tarefa. */
export const ROTULO_DA_TAREFA: Record<string, string> = {
  roteiro: "IA: escrever os roteiros",
  verificarTexto: "IA: conferir o que foi escrito",
  temasDoDia: "IA: temas do dia",
  avaliarTema: "IA: notas dos temas",
  avaliarResposta: "IA: notas do briefing",
  notaDaVersao: "IA: notas das versões do roteiro",
  marcarFala: "IA: marcar a fala dos roteiros",
  compilarPerfil: "IA: perfil da marca",
  aprenderCliente: "IA: aprender com as reprovações",
  extrairVideo: "Analisar os vídeos",
  extrairVideoSemFala: "Analisar os vídeos sem fala",
  analisarVisual: "Analisar os vídeos (imagem)",
  lerComentarios: "Ler os comentários do público",
  juntarVozes: "Juntar o que o público diz",
  modeloNicho: "Montar o modelo do ramo",
  filtrarNoticias: "Escolher as notícias",
  resumirNoticia: "Resumir as notícias dos assuntos",
  agruparTendencias: "Agrupar o que está em alta no Brasil",
  temaDoMomento: "Escrever o tema do momento",
  sugerirContasDoSetor: "Pesquisar o mercado do ramo",
  classificarContaDoSetor: "Pesquisar o mercado do ramo",
  entenderMarca: "Entender a marca",
  analisarPerfilCitado: "Entender a marca",
  pesquisaNaHora: "Pesquisar na hora (busca na web)",
  conferirPremissa: "Pesquisar na hora (conferir a premissa)",
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
  proxy: "Tráfego do proxy do YouTube (a transcrição)",
};

export type LinhaForaDaIA = { fonte: string; rotulo: string; usd: number; unidades: number; unidade: "minutos" | "resultados" | "megabytes"; execucoes: number; algumEstimado: boolean };
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

// ---------------------------------------------------------------------------------------------------------------------
// A pesquisa na hora (E54, parte 4): uma linha por pesquisa, para a prova com a chave real ter onde olhar
// ---------------------------------------------------------------------------------------------------------------------

/** Uma pesquisa na hora como o admin a lê: quem pediu, o quê, quanto custou e como terminou. */
export type LinhaDePesquisaNaHora = {
  id: number;
  criadoEm: Date;
  clienteId: number;
  marca: string;
  pedido: string;
  profundidade: Profundidade;
  status: StatusDaPesquisa;
  buscas: number;
  custoUsd: number;
  /** Quantos dados voltaram e quantos a pessoa marcou. */
  dados: number;
  marcados: number;
  premissa: "sem_premissa" | "confere" | "nao_confere";
  /** O que a pessoa decidiu diante do aviso (nulo sem aviso ou sem decisão). */
  decisao: "fontes" | "mudar" | "manter" | null;
  perguntouPosicao: boolean;
  respondeuPosicao: boolean;
  /** A pessoa marcou os dados e seguiu (a tela estampa a confirmação). */
  confirmada: boolean;
  /** Quantos roteiros nasceram desta pesquisa (a cópia que o roteiro guarda aponta para ela); as versões de um roteiro contam como um só. */
  roteiros: number;
  motivo: string | null;
  /** Do pedido ao fim, em segundos; nulo enquanto roda e nulo no erro (a que passou do prazo é fechada na hora em que alguém abre a página, então o tempo seria o da espera, não o da pesquisa). */
  duracaoS: number | null;
};

export type ResumoDasPesquisasNaHora = {
  total: number;
  prontas: number;
  semAchados: number;
  erros: number;
  rodando: number;
  buscas: number;
  custoUsd: number;
  /** A média só das que gastaram alguma coisa (o erro que caiu sem busca não entra). */
  custoMedioUsd: number | null;
  marcas: number;
  comRoteiro: number;
  /** Estimado (o que a tela diz para a pessoa) e medido, por tamanho. */
  porTamanho: {
    profundidade: Profundidade;
    /** Só as que gastaram (a base da média). */
    pesquisas: number;
    custoMedioUsd: number | null;
    buscasMedias: number | null;
    estimadoUsd: number;
    estimadoBuscas: number;
    /** O que a tela diz para a pessoa ("uns R$ 0,50"), arredondado como ela, ao lado da estimativa exata do motor. */
    estimadoDito: string;
  }[];
  /** Quantas pesquisas por marca por dia o teto deixa (a "Mais a fundo" conta como `pesoAFundo`). */
  tetoPorMarcaPorDia: number;
  pesoAFundo: number;
};

/** Como a pesquisa terminou, numa frase (E54 parte 4): o estado, o que a pessoa fez com os dados e o que a premissa pediu. */
export function desfechoDaPesquisa(l: Pick<LinhaDePesquisaNaHora, "status" | "dados" | "marcados" | "confirmada" | "roteiros" | "premissa" | "decisao" | "perguntouPosicao">): string {
  const d = textosCustosAdmin.pesquisas.desfecho;
  if (l.status === "pesquisando" || l.status === "executando") return d.rodando;
  if (l.status === "erro") return d.erro;
  if (l.status === "sem_achados") return d.semAchados;
  const partes: string[] = [];
  // Os dados já vêm pré-marcados pelo motor: só vale como "a pessoa marcou" depois que ela seguiu (ou que um roteiro já saiu da pesquisa).
  if (!l.confirmada && l.roteiros === 0) {
    partes.push(d.prontaSemMarcar(l.dados));
  } else {
    partes.push(d.pronta(l.marcados, l.dados));
    partes.push(l.roteiros > 0 ? d.virouRoteiro(l.roteiros) : d.semRoteiro);
  }
  if (l.premissa === "nao_confere") partes.push(d.premissa[l.decisao ?? "semDecisao"]);
  if (l.perguntouPosicao) partes.push(d.posicao);
  return partes.join(", ");
}

export type PesquisasNaHoraDoAdmin = { resumo: ResumoDasPesquisasNaHora; linhas: LinhaDePesquisaNaHora[]; desde: Date; cortadas: boolean };

/**
 * As pesquisas na hora dos últimos 30 dias, com hoje (a mais recente primeiro), e o resumo da janela inteira, mesmo quando a lista é cortada em `limite`. Fecha antes as que ficaram
 * presas (a mesma limpeza que a tela da pessoa faz), para uma pesquisa que o worker perdeu não aparecer como "rodando" para sempre.
 */
export async function pesquisasNaHoraDoAdmin(agora: Date = new Date(), limite = 100): Promise<PesquisasNaHoraDoAdmin> {
  await encerrarPesquisasParadas(null, agora);
  const desde = new Date(inicioDoDia(hojeISO(agora)).getTime() - 30 * DIA_MS);
  const linhasDoBanco = await db()
    .select({
      id: pesquisasNaHora.id,
      criadoEm: pesquisasNaHora.criadoEm,
      terminadoEm: pesquisasNaHora.terminadoEm,
      clienteId: pesquisasNaHora.clienteId,
      marca: clientes.nome,
      pedido: pesquisasNaHora.pedido,
      profundidade: pesquisasNaHora.profundidade,
      status: pesquisasNaHora.status,
      buscas: pesquisasNaHora.buscas,
      custoUsd: pesquisasNaHora.custoUsd,
      dados: sql<number>`jsonb_array_length(${pesquisasNaHora.achados})::int`,
      marcados: sql<number>`jsonb_array_length(${pesquisasNaHora.selecionados})::int`,
      premissa: sql<string | null>`${pesquisasNaHora.premissa}->>'situacao'`,
      decisao: pesquisasNaHora.decisaoDaPremissa,
      perguntou: sql<boolean>`${pesquisasNaHora.perguntaDePosicao} is not null`,
      respondeu: sql<boolean>`${pesquisasNaHora.posicaoDaPessoa} is not null`,
      confirmada: sql<boolean>`${pesquisasNaHora.confirmadaEm} is not null`,
      roteiros: sql<number>`(select count(distinct coalesce(r.versao_de, r.id))::int from ${roteiros} r where r.cliente_id = ${pesquisasNaHora.clienteId} and (r.pesquisa_na_hora->>'pesquisaId') = ${pesquisasNaHora.id}::text)`,
      motivo: pesquisasNaHora.motivo,
    })
    .from(pesquisasNaHora)
    .innerJoin(clientes, eq(clientes.id, pesquisasNaHora.clienteId))
    .where(gte(pesquisasNaHora.criadoEm, desde))
    .orderBy(desc(pesquisasNaHora.criadoEm), desc(pesquisasNaHora.id));

  const todas: LinhaDePesquisaNaHora[] = linhasDoBanco.map((l) => ({
    id: l.id,
    criadoEm: l.criadoEm,
    clienteId: l.clienteId,
    marca: l.marca,
    pedido: l.pedido,
    profundidade: l.profundidade,
    status: l.status,
    buscas: l.buscas,
    custoUsd: Number(l.custoUsd),
    dados: l.dados,
    marcados: l.marcados,
    premissa: l.premissa === "nao_confere" || l.premissa === "confere" ? l.premissa : "sem_premissa",
    decisao: l.decisao ?? null,
    perguntouPosicao: l.perguntou,
    respondeuPosicao: l.respondeu,
    confirmada: l.confirmada,
    roteiros: l.roteiros,
    motivo: l.motivo,
    duracaoS: l.terminadoEm && l.status !== "erro" ? Math.max(0, Math.round((l.terminadoEm.getTime() - l.criadoEm.getTime()) / 1000)) : null,
  }));

  const gastaram = todas.filter((l) => l.buscas > 0 || l.custoUsd > 0);
  const media = (lista: LinhaDePesquisaNaHora[], campo: "custoUsd" | "buscas") => (lista.length > 0 ? lista.reduce((a, l) => a + l[campo], 0) / lista.length : null);
  const porTamanho = (["normal", "aprofundada"] as const).map((profundidade) => {
    const dessas = gastaram.filter((l) => l.profundidade === profundidade);
    const estimativa = estimarPesquisa(profundidade);
    return {
      profundidade,
      pesquisas: dessas.length,
      custoMedioUsd: media(dessas, "custoUsd"),
      buscasMedias: media(dessas, "buscas"),
      estimadoUsd: estimativa.usd,
      estimadoBuscas: estimativa.buscas,
      estimadoDito: reaisEmLinguagemDeGente(estimativa.reais),
    };
  });

  return {
    resumo: {
      total: todas.length,
      prontas: todas.filter((l) => l.status === "pronta").length,
      semAchados: todas.filter((l) => l.status === "sem_achados").length,
      erros: todas.filter((l) => l.status === "erro").length,
      rodando: todas.filter((l) => l.status === "pesquisando" || l.status === "executando").length,
      buscas: todas.reduce((a, l) => a + l.buscas, 0),
      custoUsd: todas.reduce((a, l) => a + l.custoUsd, 0),
      custoMedioUsd: media(gastaram, "custoUsd"),
      marcas: new Set(todas.map((l) => l.clienteId)).size,
      comRoteiro: todas.filter((l) => l.roteiros > 0).length,
      porTamanho,
      tetoPorMarcaPorDia: config.regras.pesquisasNaHoraPorMarcaPorDia,
      pesoAFundo: PESO_DA_PROFUNDIDADE.aprofundada,
    },
    linhas: todas.slice(0, limite),
    desde,
    cortadas: todas.length > limite,
  };
}
