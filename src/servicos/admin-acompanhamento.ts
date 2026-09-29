/**
 * O painel de acompanhamento da viagem (V10, admin, só leitura): dia a dia
 * por marca, e o que está quebrado agora. Estes dois blocos alimentam três
 * lugares: a tela `/admin/viagem`, o endpoint `/api/saude/viagem` (sem
 * sessão, só números agregados) e o e-mail diário do Fable.
 *
 * "Uma consulta por bloco" (PROXIMO.md): cada função de consulta faz um
 * SELECT (ou dois bem próximos), e a montagem final só cruza os resultados
 * em memória. Nenhuma delas filtra por `origem <> 'seed'` de propósito
 * (regra do `plataforma/CLAUDE.md` é para consulta de produto que o
 * cliente vê; esta tela é do admin, olhando o motor inteiro).
 *
 * Achado ao escrever isto: `execucoes_job` não tem `nicho_id` nem
 * `cliente_id` (uma execução de coleta cobre todos os nichos ativos de uma
 * vez, `src/servicos/admin-coleta.ts` já documenta isso). Por isso o
 * "estado" de coleta/transcrição por dia é o mesmo para todas as marcas
 * (é a mesma execução); só a "contagem" (vídeos novos, vídeos transcritos)
 * é por nicho de verdade, lida direto de `videos`.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  clientes,
  consumoApi,
  execucoesJob,
  metricasVideoCliente,
  planoGravacoes,
  roteiros,
  temasDia,
  videos,
  videosCliente,
  type EstadoPlano,
  type FormatoRoteiro,
} from "@/db/schema";
import { MARCADOR_SEGUNDA_TENTATIVA } from "@/ia/verificador";
import { LIMITE_DIARIO_UNIDADES as TETO_YOUTUBE_UNIDADES_DIA } from "@/jobs/coleta-youtube";
import { FILAS } from "@/jobs/fila";
import { chamadasDesde, JANELA_MS, LIMITE_CHAMADAS_HORA as TETO_META_CHAMADAS_HORA } from "@/jobs/meta-api";
import { config, hojeISO } from "@/lib/config";

const FUSO = "America/Sao_Paulo";

/** Todo job cujo resultado é vídeo novo no banco (contas-base é catch-up, conta como coleta). */
const NOMES_JOB_COLETA: string[] = [
  FILAS.coletaYoutube,
  FILAS.coletaApify,
  FILAS.coletaMeioDia,
  FILAS.contasBase,
  FILAS.metaContas,
  FILAS.metaHashtags,
  FILAS.descobertaInstagram,
];

export type EstadoAgregado = "ok" | "erro" | "rodando" | "sem_execucao";

/** "Pior estado vence": erro > rodando > ok, para quando mais de uma execução cai no mesmo dia. */
const PESO_ESTADO: Record<Exclude<EstadoAgregado, "sem_execucao">, number> = { ok: 1, rodando: 2, erro: 3 };

/** Últimos `periodoDias` dias, do mais antigo ao de hoje, em data local do Brasil ("YYYY-MM-DD"). */
export function diasDoPeriodo(periodoDias: number, hoje: Date = new Date()): string[] {
  const dias: string[] = [];
  for (let i = periodoDias - 1; i >= 0; i--) {
    dias.push(hojeISO(new Date(hoje.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return dias;
}

export type MarcaAtiva = { id: number; nome: string; nichoId: number | null; ultimoAcessoEm: Date | null };

/** Bloco 1: as marcas que entram nas colunas da tabela. */
export async function marcasAtivas(): Promise<MarcaAtiva[]> {
  return db()
    .select({ id: clientes.id, nome: clientes.nome, nichoId: clientes.nichoId, ultimoAcessoEm: clientes.ultimoAcessoEm })
    .from(clientes)
    .where(eq(clientes.ativo, true))
    .orderBy(clientes.nome);
}

export type EstadoJobDia = { dia: string; estado: EstadoAgregado; erro: string | null };

/** Bloco 2: o estado (pior de todas as execuções do dia) de um grupo de jobs, por dia. Sem nicho: é a mesma execução para todo mundo. */
async function estadoPorDia(nomes: string[], desde: string): Promise<Map<string, EstadoJobDia>> {
  const linhas = await db()
    .select({
      dia: sql<string>`(${execucoesJob.iniciadoEm} at time zone ${FUSO})::date::text`,
      status: execucoesJob.status,
      erro: execucoesJob.erro,
    })
    .from(execucoesJob)
    .where(and(inArray(execucoesJob.nome, nomes), gte(execucoesJob.iniciadoEm, new Date(`${desde}T00:00:00-03:00`))))
    .orderBy(execucoesJob.id);

  const porDia = new Map<string, EstadoJobDia>();
  for (const linha of linhas) {
    const atual = porDia.get(linha.dia);
    if (!atual || PESO_ESTADO[linha.status] >= PESO_ESTADO[atual.estado as Exclude<EstadoAgregado, "sem_execucao">]) {
      porDia.set(linha.dia, { dia: linha.dia, estado: linha.status, erro: linha.status === "erro" ? linha.erro : null });
    }
  }
  return porDia;
}

export type ContagemNichoDia = { nichoId: number; dia: string; quantidade: number };

/**
 * Bloco 3: vídeos novos por nicho e dia (a "contagem lida" da coleta, por
 * marca de verdade). A expressão do dia é a MESMA instância em `select` e
 * em `groupBy` (achado rodando o teste de integração): com duas strings
 * SQL escritas em separado, ainda que idênticas no texto final, o Postgres
 * as trata como duas expressões diferentes e reprova com "must appear in
 * the GROUP BY clause".
 */
async function novosVideosPorNichoEDia(desde: string): Promise<Map<string, number>> {
  const dia = sql<string>`(${videos.coletadoEm} at time zone ${FUSO})::date::text`;
  const linhas = await db()
    .select({ nichoId: videos.nichoId, dia, quantidade: count() })
    .from(videos)
    .where(and(isNotNull(videos.nichoId), gte(videos.coletadoEm, new Date(`${desde}T00:00:00-03:00`))))
    .groupBy(sql`1, 2`);
  const mapa = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.nichoId === null) continue;
    mapa.set(`${linha.nichoId}:${linha.dia}`, linha.quantidade);
  }
  return mapa;
}

/** Bloco 4: vídeos transcritos por nicho e dia (`transcrito_em`, não `atualizado_em`: a recoleta não conta como transcrição). */
async function transcritosPorNichoEDia(desde: string): Promise<Map<string, number>> {
  const dia = sql<string>`(${videos.transcritoEm} at time zone ${FUSO})::date::text`;
  const linhas = await db()
    .select({ nichoId: videos.nichoId, dia, quantidade: count() })
    .from(videos)
    .where(and(isNotNull(videos.nichoId), isNotNull(videos.transcritoEm), gte(videos.transcritoEm, new Date(`${desde}T00:00:00-03:00`))))
    .groupBy(sql`1, 2`);
  const mapa = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.nichoId === null) continue;
    mapa.set(`${linha.nichoId}:${linha.dia}`, linha.quantidade);
  }
  return mapa;
}

/** Bloco 5: quantos temas saíram, por nicho e dia. */
async function temasPorNichoEDia(desde: string): Promise<Map<string, number>> {
  const linhas = await db()
    .select({ nichoId: temasDia.nichoId, dia: sql<string>`${temasDia.data}::text`, temas: temasDia.temas })
    .from(temasDia)
    .where(gte(temasDia.data, desde));
  const mapa = new Map<string, number>();
  for (const linha of linhas) {
    mapa.set(`${linha.nichoId}:${linha.dia}`, linha.temas.length);
  }
  return mapa;
}

export type RoteirosDiaResumo = {
  porOrigem: Record<"sugerido" | "livre" | "momento", number>;
  porFormato: Record<FormatoRoteiro, number>;
  gravados: number;
  postados: number;
  total: number;
};

function resumoRoteirosVazio(): RoteirosDiaResumo {
  return {
    porOrigem: { sugerido: 0, livre: 0, momento: 0 },
    porFormato: { reels: 0, story: 0 },
    gravados: 0,
    postados: 0,
    total: 0,
  };
}

/** Bloco 6: roteiros por marca e dia, já quebrados por origem, formato e status. */
async function roteirosPorMarcaEDia(desde: string): Promise<Map<string, RoteirosDiaResumo>> {
  const linhas = await db()
    .select({
      clienteId: roteiros.clienteId,
      dia: sql<string>`${roteiros.data}::text`,
      origem: roteiros.origem,
      formato: roteiros.formato,
      status: roteiros.status,
      quantidade: count(),
    })
    .from(roteiros)
    .where(gte(roteiros.data, desde))
    .groupBy(roteiros.clienteId, roteiros.data, roteiros.origem, roteiros.formato, roteiros.status);

  const mapa = new Map<string, RoteirosDiaResumo>();
  for (const linha of linhas) {
    const chave = `${linha.clienteId}:${linha.dia}`;
    const resumo = mapa.get(chave) ?? resumoRoteirosVazio();
    resumo.porOrigem[linha.origem] += linha.quantidade;
    resumo.porFormato[linha.formato] += linha.quantidade;
    resumo.total += linha.quantidade;
    if (linha.status === "gravado" || linha.status === "postado") resumo.gravados += linha.quantidade;
    if (linha.status === "postado") resumo.postados += linha.quantidade;
    mapa.set(chave, resumo);
  }
  return mapa;
}

/** Bloco 7: quantas medidas da curva entraram, por marca e dia. */
async function curvaPorMarcaEDia(desde: string): Promise<Map<string, number>> {
  const dia = sql<string>`(${metricasVideoCliente.coletadoEm} at time zone ${FUSO})::date::text`;
  const linhas = await db()
    .select({ clienteId: videosCliente.clienteId, dia, quantidade: count() })
    .from(metricasVideoCliente)
    .innerJoin(videosCliente, eq(videosCliente.id, metricasVideoCliente.videoClienteId))
    .where(gte(metricasVideoCliente.coletadoEm, new Date(`${desde}T00:00:00-03:00`)))
    .groupBy(sql`1, 2`);
  const mapa = new Map<string, number>();
  for (const linha of linhas) {
    mapa.set(`${linha.clienteId}:${linha.dia}`, linha.quantidade);
  }
  return mapa;
}

export type PlanoDiaResumo = Record<EstadoPlano, number>;

function resumoPlanoVazio(): PlanoDiaResumo {
  return { sugerido: 0, aceito: 0, gravado: 0, pulado: 0 };
}

/** Bloco 8: o plano do dia (itens sugeridos, aceitos, gravados, pulados), por marca e dia. */
async function planoPorMarcaEDia(desde: string): Promise<Map<string, PlanoDiaResumo>> {
  const linhas = await db()
    .select({
      clienteId: planoGravacoes.clienteId,
      dia: sql<string>`${planoGravacoes.dia}::text`,
      estado: planoGravacoes.estado,
      quantidade: count(),
    })
    .from(planoGravacoes)
    .where(gte(planoGravacoes.dia, desde))
    .groupBy(planoGravacoes.clienteId, planoGravacoes.dia, planoGravacoes.estado);

  const mapa = new Map<string, PlanoDiaResumo>();
  for (const linha of linhas) {
    const chave = `${linha.clienteId}:${linha.dia}`;
    const resumo = mapa.get(chave) ?? resumoPlanoVazio();
    resumo[linha.estado] += linha.quantidade;
    mapa.set(chave, resumo);
  }
  return mapa;
}

export type LinhaAcompanhamentoDia = {
  dia: string;
  coleta: { estado: EstadoAgregado; erro: string | null; novos: number };
  transcrever: { estado: EstadoAgregado; erro: string | null; transcritos: number };
  temas: number;
  roteiros: RoteirosDiaResumo;
  curva: { medidas: number };
  plano: PlanoDiaResumo;
};

export type MarcaAcompanhamento = MarcaAtiva & { linhas: LinhaAcompanhamentoDia[] };

/**
 * Item 1 do PROXIMO.md: um dia por linha, uma marca por coluna (aqui, uma
 * marca com um array de linhas, uma por dia; a tela decide a orientação).
 * `marcaId` filtra para uma marca só (o filtro da tela); sem ele, todas as
 * marcas ativas.
 */
export async function acompanhamentoDaViagem(
  periodoDias: 7 | 14 | 30,
  marcaId?: number,
  hoje: Date = new Date(),
): Promise<MarcaAcompanhamento[]> {
  const dias = diasDoPeriodo(periodoDias, hoje);
  const desde = dias[0];

  const todasMarcas = await marcasAtivas();
  const marcas = marcaId ? todasMarcas.filter((m) => m.id === marcaId) : todasMarcas;

  const [estadoColeta, estadoTranscrever, novos, transcritos, temas, roteirosPorDia, curva, plano] = await Promise.all([
    estadoPorDia(NOMES_JOB_COLETA, desde),
    estadoPorDia([FILAS.transcrever], desde),
    novosVideosPorNichoEDia(desde),
    transcritosPorNichoEDia(desde),
    temasPorNichoEDia(desde),
    roteirosPorMarcaEDia(desde),
    curvaPorMarcaEDia(desde),
    planoPorMarcaEDia(desde),
  ]);

  return marcas.map((marca) => ({
    ...marca,
    linhas: dias.map((dia) => {
      const chaveNicho = `${marca.nichoId}:${dia}`;
      const chaveMarca = `${marca.id}:${dia}`;
      const coletaDoDia = estadoColeta.get(dia);
      const transcreverDoDia = estadoTranscrever.get(dia);
      return {
        dia,
        coleta: {
          estado: coletaDoDia?.estado ?? "sem_execucao",
          erro: coletaDoDia?.erro ?? null,
          novos: novos.get(chaveNicho) ?? 0,
        },
        transcrever: {
          estado: transcreverDoDia?.estado ?? "sem_execucao",
          erro: transcreverDoDia?.erro ?? null,
          transcritos: transcritos.get(chaveNicho) ?? 0,
        },
        temas: temas.get(chaveNicho) ?? 0,
        roteiros: roteirosPorDia.get(chaveMarca) ?? resumoRoteirosVazio(),
        curva: { medidas: curva.get(chaveMarca) ?? 0 },
        plano: plano.get(chaveMarca) ?? resumoPlanoVazio(),
      };
    }),
  }));
}

// --- Item 2: o que está quebrado agora (reaproveitado pela tela, pelo /api/saude/viagem e pelo e-mail) ---

export type UltimoErroJob = { nome: string; quando: Date; mensagem: string };

/** Bloco 9: o último job que terminou em erro, qualquer fila. */
export async function ultimoErroDeJob(): Promise<UltimoErroJob | null> {
  const [linha] = await db()
    .select({ nome: execucoesJob.nome, terminadoEm: execucoesJob.terminadoEm, iniciadoEm: execucoesJob.iniciadoEm, erro: execucoesJob.erro })
    .from(execucoesJob)
    .where(eq(execucoesJob.status, "erro"))
    .orderBy(desc(execucoesJob.id))
    .limit(1);
  if (!linha) return null;
  return { nome: linha.nome, quando: linha.terminadoEm ?? linha.iniciadoEm, mensagem: linha.erro ?? "" };
}

/** A última execução de coleta (o mesmo grupo de `NOMES_JOB_COLETA`) que terminou ok, para o /api/saude/viagem. */
export async function ultimaColetaOkEm(): Promise<Date | null> {
  const [linha] = await db()
    .select({ terminadoEm: execucoesJob.terminadoEm, iniciadoEm: execucoesJob.iniciadoEm })
    .from(execucoesJob)
    .where(and(inArray(execucoesJob.nome, NOMES_JOB_COLETA), eq(execucoesJob.status, "ok")))
    .orderBy(desc(execucoesJob.id))
    .limit(1);
  return linha ? (linha.terminadoEm ?? linha.iniciadoEm) : null;
}

export type ConsumoFonte = { fonte: "youtube" | "apify" | "meta" | "groq"; unidades: number; teto: number | null; unidade: "dia" | "hora" };

/**
 * Bloco 10: consumo de hoje contra o teto de cada fonte. Nem toda fonte usa
 * o mesmo relógio nem a mesma tabela: youtube e apify (e groq, sem teto) são
 * `consumo_api` por dia calendário; a Meta é `chamadas_meta_api`, por hora
 * corrida (o limite dela é por hora, não por dia, `LIMITE_CHAMADAS_HORA`
 * em `meta-api.ts`), então "unidades" ali é "chamadas na última hora", não
 * "hoje". Mostrar os dois jeitos como se fossem o mesmo teto seria
 * inventar uma equivalência que não existe.
 */
export async function consumoAgoraPorFonte(): Promise<ConsumoFonte[]> {
  const [porDia, chamadasMetaNaJanela] = await Promise.all([
    db().select({ fonte: consumoApi.fonte, unidades: consumoApi.unidades }).from(consumoApi).where(eq(consumoApi.data, hojeISO())),
    // Mesma janela que o limitador de verdade usa (JANELA_MS, meta-api.ts), nunca uma conta em separado:
    // se a janela do limitador mudar um dia, este número precisa mudar junto, não ficar para trás.
    chamadasDesde(new Date(Date.now() - JANELA_MS)),
  ]);
  const porFonteDia = new Map(porDia.map((l) => [l.fonte, l.unidades]));
  return [
    { fonte: "youtube", unidades: porFonteDia.get("youtube") ?? 0, teto: TETO_YOUTUBE_UNIDADES_DIA, unidade: "dia" },
    { fonte: "apify", unidades: porFonteDia.get("apify") ?? 0, teto: config.coleta.apifyMaxResultadosDia, unidade: "dia" },
    { fonte: "meta", unidades: chamadasMetaNaJanela, teto: TETO_META_CHAMADAS_HORA, unidade: "hora" },
    /**
     * `transcrever.ts` (o maior consumidor de verdade da Groq) ainda não registra em `consumo_api`
     * (decisão pendente registrada em `TODO.md` desde 22/09/2026); só `momento.ts` (o "gravar agora"
     * por áudio) grava. Este número existe, mas não é o consumo real da Groq; o estado do job
     * `transcrever` (coluna "transcrição" da tabela acima) é o sinal confiável de uma falha da Groq.
     */
    { fonte: "groq", unidades: porFonteDia.get("groq") ?? 0, teto: null, unidade: "dia" },
  ];
}

export type GeracaoReprovadaDuasVezes = { tarefa: string; clienteId: number | null; motivo: string; quando: Date };

/**
 * Bloco 11: a última geração que reprovou duas vezes seguidas (o `ErroIA`
 * que a pessoa viu na tela, `gerarComVerificacao` em `ia/verificador.ts`).
 * `motivo_avaliacao` é preenchido em toda tentativa que o verificador local
 * ou o `verificarTexto` reprovou, aprovada ou não depois (é diferente de
 * `avaliacao`, que é a reação do cliente ao roteiro pronto).
 *
 * Achado da revisão: duas linhas seguidas da mesma tarefa e do mesmo
 * cliente com motivo preenchido NÃO bastam sozinhas. `avaliarResposta`
 * (briefing) chama `gerarComVerificacao` uma vez por pergunta, sempre com a
 * mesma tarefa e o mesmo cliente; se a primeira tentativa da pergunta B
 * reprovar logo depois da segunda tentativa (também reprovada) da pergunta
 * A, as duas ficam adjacentes em `geracoes_ia` sem serem a mesma
 * invocação, e o `lag` sozinho contaria isso como "reprovou duas vezes" por
 * engano. A entrada da segunda tentativa de verdade sempre carrega
 * `MARCADOR_SEGUNDA_TENTATIVA` (`ia/verificador.ts`, o mesmo texto que
 * `gerarComVerificacao` acrescenta ao pedir para corrigir); exigir esse
 * marcador na linha mais recente é o que garante que as duas linhas são
 * primeira e segunda tentativa da mesma invocação, nunca de duas
 * diferentes.
 */
export async function ultimaGeracaoReprovadaDuasVezes(): Promise<GeracaoReprovadaDuasVezes | null> {
  const resultado = await db().execute<{
    tarefa: string;
    cliente_id: number | null;
    motivo_avaliacao: string;
    criado_em: string;
  }>(sql`
    select tarefa, cliente_id, motivo_avaliacao, criado_em
    from (
      select
        tarefa,
        cliente_id,
        motivo_avaliacao,
        criado_em,
        entradas ->> 'entrada' as entrada,
        id,
        lag(motivo_avaliacao) over (partition by tarefa, cliente_id order by id) as motivo_anterior
      from geracoes_ia
    ) com_anterior
    where motivo_avaliacao is not null
      and motivo_anterior is not null
      and entrada like ${`%${MARCADOR_SEGUNDA_TENTATIVA}%`}
    order by id desc
    limit 1
  `);
  const linha = resultado.rows[0];
  if (!linha) return null;
  // `db().execute()` roda fora do mapeamento de coluna do drizzle (criado_em vira o texto que o pg devolve
  // para timestamptz, nao um Date pronto); nunca confiar no tipo estatico aqui, sempre reconstruir.
  return { tarefa: linha.tarefa, clienteId: linha.cliente_id, motivo: linha.motivo_avaliacao, quando: new Date(linha.criado_em) };
}

export type ResumoQuebradoAgora = {
  ultimoErroJob: UltimoErroJob | null;
  consumo: ConsumoFonte[];
  geracaoReprovadaDuasVezes: GeracaoReprovadaDuasVezes | null;
};

/** O topo da tela (item 2): as três linhas fixas, uma consulta cada, em paralelo. */
export async function resumoQuebradoAgora(): Promise<ResumoQuebradoAgora> {
  const [ultimoErroJob, consumo, geracaoReprovadaDuasVezes] = await Promise.all([
    ultimoErroDeJob(),
    consumoAgoraPorFonte(),
    ultimaGeracaoReprovadaDuasVezes(),
  ]);
  return { ultimoErroJob, consumo, geracaoReprovadaDuasVezes };
}

export type SaudeViagem = {
  ok: true;
  marcasAtivas: number;
  roteirosHoje: number;
  ultimaColetaOkEm: string | null;
  ultimoErroJob: { nome: string; quando: string } | null;
  consumo: ConsumoFonte[];
  geracaoReprovadaDuasVezesAgora: boolean;
};

/**
 * Item 3: os mesmos números do item 2, mais marcas ativas, roteiros hoje e
 * a última coleta ok, sem nenhum dado de cliente (nem nome, nem tema, nem
 * texto): por isso o erro de job aqui não leva a mensagem (`mensagem` fica
 * só no admin, autenticado), e a geração reprovada duas vezes vira um
 * booleano, nunca a tarefa nem o motivo.
 */
export async function saudeDaViagem(): Promise<SaudeViagem> {
  const [marcas, roteirosHojeLinhas, ultimaColeta, resumo] = await Promise.all([
    marcasAtivas(),
    db().select({ total: count() }).from(roteiros).where(eq(roteiros.data, hojeISO())),
    ultimaColetaOkEm(),
    resumoQuebradoAgora(),
  ]);

  return {
    ok: true,
    marcasAtivas: marcas.length,
    roteirosHoje: roteirosHojeLinhas[0]?.total ?? 0,
    ultimaColetaOkEm: ultimaColeta ? ultimaColeta.toISOString() : null,
    ultimoErroJob: resumo.ultimoErroJob ? { nome: resumo.ultimoErroJob.nome, quando: resumo.ultimoErroJob.quando.toISOString() } : null,
    consumo: resumo.consumo,
    geracaoReprovadaDuasVezesAgora: resumo.geracaoReprovadaDuasVezes !== null,
  };
}
