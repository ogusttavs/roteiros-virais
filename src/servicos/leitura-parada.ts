/**
 * Quando a leitura de uma rede para (achado de 23/10/2026: a transcrição do YouTube ficou parada 20 dias porque o proxy acabou, e o ramo 5 chegou a 3 mil vídeos acima do piso
 * sem leitura). Este módulo é a memória dessa parada, sem tabela nova: o `transcrever` grava em `execucoes_job.resumo.leituraParada` o estado de cada rede ao fim de cada rodada, e a
 * rodada seguinte lê o estado da anterior para (1) não gastar as vagas da noite com a rede parada (só uma tentativa de prova), (2) contar "desde quando" e (3) avisar o admin.
 *
 * Uma rede está PARADA quando, na última rodada que disse alguma coisa sobre ela:
 *  - o proxy recusou ou não respondeu (vale para o YouTube e o TikTok, que passam por ele): `proxy sem trafego`, `proxy recusou o acesso`, `proxy fora do ar`;
 *  - o YouTube barrou o robô ou pendurou o limite de tempo dez vezes seguidas, ou cinco ou mais vezes sem nenhuma leitura boa na rodada: `bloqueio`;
 *  - qualquer rede teve `FALHAS_SEM_LEITURA_PARA_PARAR` falhas ou mais e nenhuma leitura boa na rodada inteira (a rodada é diária, então é um dia sem ler nada enquanto há fila): `sem leitura`.
 * Uma leitura boa limpa a rede. Rodada que não tentou nada nela não muda nada.
 *
 * Funções puras (sem banco) para provar a regra sem fila; só `estadoAtualDaLeitura` toca o banco.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { execucoesJob, type Plataforma } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import type { MotivoDoProxy } from "@/jobs/youtube-cliente";

export const PLATAFORMAS_LIDAS: readonly Plataforma[] = ["youtube", "tiktok", "instagram"];

/** Quantas falhas, sem nenhuma leitura boa na rodada, dizem que a rede parou (e não que alguns vídeos estavam mortos). */
export const FALHAS_SEM_LEITURA_PARA_PARAR = 5;

export const MOTIVOS_DO_PROXY: readonly MotivoDoProxy[] = ["proxy sem trafego", "proxy recusou o acesso", "proxy fora do ar"];

export type CausaDaParada = MotivoDoProxy | "bloqueio" | "sem leitura";

/** Uma rede parada: a causa e desde quando (texto ISO, para caber no resumo da execução). */
export type ParadaDaLeitura = { causa: CausaDaParada; desde: string };
export type EstadoDaLeitura = Partial<Record<Plataforma, ParadaDaLeitura>>;

/** A mesma parada, com a data já como `Date`, para a tela e o e-mail. */
export type LeituraParada = { plataforma: Plataforma; causa: CausaDaParada; desde: Date };

/** O proxy do YouTube (que o TikTok também usa) parou: o motivo e desde quando, contando as noites seguidas. */
export type ProxyParado = { motivo: MotivoDoProxy; desde: Date };

const CAUSAS = new Set<string>([...MOTIVOS_DO_PROXY, "bloqueio", "sem leitura"]);

export function ehCausaDoProxy(causa: CausaDaParada): causa is MotivoDoProxy {
  return (MOTIVOS_DO_PROXY as readonly string[]).includes(causa);
}

function dataValida(texto: unknown): Date | null {
  if (typeof texto !== "string") return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// O que o resumo antigo (antes deste módulo) sabia: só o proxy.
// ---------------------------------------------------------------------------

function motivoDoResumo(resumo: Record<string, unknown> | null): MotivoDoProxy | null {
  const motivo = resumo?.youtubePausadoMotivo;
  return typeof motivo === "string" && (MOTIVOS_DO_PROXY as readonly string[]).includes(motivo) ? (motivo as MotivoDoProxy) : null;
}

/**
 * O proxy respondeu nesta rodada? Houve pelo menos uma tentativa de YouTube ou TikTok (os dois passam por ele) em que ele não foi o que falhou: um vídeo lido, ou um vídeo que falhou
 * por culpa dele mesmo (privado, removido, bloqueio do robô). Rodada sem tentativa pelo proxy (só Instagram, fila vazia) não prova nada, e as de antes do aviso, sem `tentativas`, tampouco.
 */
function proxyRespondeuNoResumo(resumo: Record<string, unknown> | null): boolean {
  const tentativas = resumo?.tentativas as Record<string, unknown> | undefined;
  const sucessos = resumo?.sucessos as Record<string, unknown> | undefined;
  const pelaRede = Number(tentativas?.youtube ?? 0) + Number(tentativas?.tiktok ?? 0);
  const falhasDoProxy = Number(resumo?.falhasPorProxy ?? 0);
  const lidos = Number(sucessos?.youtube ?? 0) + Number(sucessos?.tiktok ?? 0);
  return lidos > 0 || pelaRede - falhasDoProxy > 0;
}

/**
 * O proxy do YouTube está parado agora? Pura, para testar: as execuções do `transcrever` que terminaram, da mais nova para a mais velha. Vale a última rodada que disse alguma coisa:
 * se ela parou pelo proxy, ele está parado, e "desde" é a mais antiga das rodadas seguidas que pararam pelo proxy (o instante em que o job anotou, ou o início da rodada). Uma rodada
 * em que o proxy respondeu diz que ele voltou: se ela mesma parou no fim da noite (baixou uma parte e o proxy acabou de novo), conta como parada e a contagem das noites termina nela;
 * se não parou, o proxy não está parado. Uma rodada que não tentou nada pelo proxy não diz nada.
 */
export function proxyParadoDasExecucoes(execucoes: { iniciadoEm: Date; resumo: Record<string, unknown> | null }[]): ProxyParado | null {
  const paradas: { iniciadoEm: Date; resumo: Record<string, unknown> | null; motivo: MotivoDoProxy }[] = [];
  for (const e of execucoes) {
    const motivo = motivoDoResumo(e.resumo);
    if (motivo) paradas.push({ ...e, motivo });
    if (proxyRespondeuNoResumo(e.resumo)) break;
  }
  if (paradas.length === 0) return null;
  const maisAntiga = paradas[paradas.length - 1];
  const anotado = dataValida(maisAntiga.resumo?.proxyPausadoDesde);
  return { motivo: paradas[0].motivo, desde: anotado ?? maisAntiga.iniciadoEm };
}

// ---------------------------------------------------------------------------
// O estado por rede, do resumo da última rodada
// ---------------------------------------------------------------------------

/** Lê `leituraParada` de um resumo; nulo quando o resumo é de antes deste módulo (não tem o campo, ou não é um objeto). */
function estadoDoResumo(resumo: Record<string, unknown> | null): EstadoDaLeitura | null {
  const bruto = resumo?.leituraParada;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const estado: EstadoDaLeitura = {};
  for (const plataforma of PLATAFORMAS_LIDAS) {
    const item = (bruto as Record<string, unknown>)[plataforma] as { causa?: unknown; desde?: unknown } | undefined;
    if (!item || typeof item.causa !== "string" || !CAUSAS.has(item.causa) || !dataValida(item.desde)) continue;
    estado[plataforma] = { causa: item.causa as CausaDaParada, desde: item.desde as string };
  }
  return estado;
}

/**
 * O estado de cada rede agora: o da rodada mais nova que o gravou. Se nenhuma rodada o gravou ainda (as de antes deste módulo, em produção até o primeiro deploy dele), vale o que o resumo
 * antigo dizia do proxy, aplicado ao YouTube e ao TikTok. Pura: recebe as execuções do `transcrever`, da mais nova para a mais velha.
 */
export function estadoDaLeituraDasExecucoes(execucoes: { iniciadoEm: Date; resumo: Record<string, unknown> | null }[]): EstadoDaLeitura {
  for (const e of execucoes) {
    const estado = estadoDoResumo(e.resumo);
    if (estado) return estado;
  }
  const proxy = proxyParadoDasExecucoes(execucoes);
  if (!proxy) return {};
  const parada: ParadaDaLeitura = { causa: proxy.motivo, desde: proxy.desde.toISOString() };
  return { youtube: parada, tiktok: parada };
}

export function paradasEmLista(estado: EstadoDaLeitura): LeituraParada[] {
  return PLATAFORMAS_LIDAS.flatMap((plataforma) => {
    const parada = estado[plataforma];
    const desde = parada ? dataValida(parada.desde) : null;
    return parada && desde ? [{ plataforma, causa: parada.causa, desde }] : [];
  });
}

/** O proxy parado, no formato que o Início e as Rotinas já mostravam: a causa do proxy mais antiga entre o YouTube e o TikTok. */
export function proxyDoEstado(estado: EstadoDaLeitura): ProxyParado | null {
  const doProxy = paradasEmLista(estado).filter((p): p is LeituraParada & { causa: MotivoDoProxy } => ehCausaDoProxy(p.causa));
  if (doProxy.length === 0) return null;
  const maisAntiga = doProxy.reduce((a, b) => (b.desde < a.desde ? b : a));
  return { motivo: maisAntiga.causa, desde: maisAntiga.desde };
}

/** As paradas que não são do proxy (bloqueio e rede sem leitura), cada uma com a sua rede. */
export function outrasParadas(estado: EstadoDaLeitura): LeituraParada[] {
  return paradasEmLista(estado).filter((p) => !ehCausaDoProxy(p.causa));
}

// ---------------------------------------------------------------------------
// O que a rodada viu e o estado que ela deixa
// ---------------------------------------------------------------------------

export type ObservacaoDaRodada = {
  /** Leituras boas (legenda ou Groq) por rede nesta rodada. */
  sucessos: Record<Plataforma, number>;
  /** Falhas do vídeo (download, Groq, tempo limite) por rede nesta rodada; o proxy que recusa não entra (não é falha do vídeo). */
  falhas: Record<Plataforma, number>;
  /** Falhas do YouTube com a mensagem do robô, para dizer `bloqueio` em vez de `sem leitura`. */
  falhasDeBloqueioNoYoutube: number;
  /** O proxy parou nesta rodada (o motivo), se parou. */
  proxyParado: MotivoDoProxy | null;
  /** O freio de dez falhas seguidas ligou para o YouTube / TikTok em algum setor. */
  freio: { youtube: boolean; tiktok: boolean };
  /** O proxy respondeu nesta rodada (uma leitura boa, ou um vídeo que falhou por culpa dele mesmo). */
  proxyRespondeu: boolean;
};

/** A causa que parou cada rede nesta rodada, se parou. Pura. */
export function causasDaRodada(obs: ObservacaoDaRodada): Partial<Record<Plataforma, CausaDaParada>> {
  const causas: Partial<Record<Plataforma, CausaDaParada>> = {};
  const semLeitura = (p: Plataforma) => obs.sucessos[p] === 0 && obs.falhas[p] >= FALHAS_SEM_LEITURA_PARA_PARAR;

  if (obs.proxyParado) {
    causas.youtube = obs.proxyParado;
    causas.tiktok = obs.proxyParado;
  } else {
    if (obs.freio.youtube || (obs.sucessos.youtube === 0 && obs.falhasDeBloqueioNoYoutube >= FALHAS_SEM_LEITURA_PARA_PARAR)) causas.youtube = "bloqueio";
    else if (semLeitura("youtube")) causas.youtube = "sem leitura";
    if (obs.freio.tiktok || semLeitura("tiktok")) causas.tiktok = "sem leitura";
  }
  if (semLeitura("instagram")) causas.instagram = "sem leitura";
  return causas;
}

/**
 * O estado que a rodada deixa, a partir do que a anterior deixou e do que esta viu. Pura.
 *  - A rede parou nesta rodada: fica parada; "desde" é o da rodada anterior se ela já estava parada e nada foi lido agora, senão é agora.
 *  - Leu algo e não parou: limpa.
 *  - Estava parada pelo proxy e o proxy respondeu: limpa (a falha do vídeo não é do proxy).
 *  - Fora isso (rodada sem tentativa, ou só falhas poucas): mantém o que estava.
 */
export function proximoEstadoDaLeitura(anterior: EstadoDaLeitura, obs: ObservacaoDaRodada, agora: Date): EstadoDaLeitura {
  const causas = causasDaRodada(obs);
  const novo: EstadoDaLeitura = {};
  for (const plataforma of PLATAFORMAS_LIDAS) {
    const antes = anterior[plataforma];
    const causa = causas[plataforma];
    if (causa) {
      novo[plataforma] = { causa, desde: antes && obs.sucessos[plataforma] === 0 ? antes.desde : agora.toISOString() };
    } else if (obs.sucessos[plataforma] > 0) {
      continue;
    } else if (antes && ehCausaDoProxy(antes.causa) && plataforma !== "instagram" && obs.proxyRespondeu) {
      continue;
    } else if (antes) {
      novo[plataforma] = antes;
    }
  }
  return novo;
}

// ---------------------------------------------------------------------------
// O banco
// ---------------------------------------------------------------------------

/**
 * O estado de cada rede agora, pelas últimas rodadas do `transcrever` que terminaram bem. Só as chaves de que a conta precisa saem do banco: o resumo inteiro leva a lista de erros da
 * noite, e esta consulta roda a cada carga do Início e das Rotinas. Rodadas de um ramo só (a primeira carga, "rodar só um ramo") têm o mesmo nome, por isso o limite é folgado.
 */
export async function estadoAtualDaLeitura(): Promise<EstadoDaLeitura> {
  const execucoes = await db()
    .select({
      iniciadoEm: execucoesJob.iniciadoEm,
      resumo: sql<Record<string, unknown>>`jsonb_build_object('leituraParada', ${execucoesJob.resumo}->'leituraParada', 'youtubePausadoMotivo', ${execucoesJob.resumo}->'youtubePausadoMotivo', 'proxyPausadoDesde', ${execucoesJob.resumo}->'proxyPausadoDesde', 'sucessos', ${execucoesJob.resumo}->'sucessos', 'tentativas', ${execucoesJob.resumo}->'tentativas', 'falhasPorProxy', ${execucoesJob.resumo}->'falhasPorProxy')`,
    })
    .from(execucoesJob)
    .where(and(eq(execucoesJob.nome, FILAS.transcrever), eq(execucoesJob.status, "ok")))
    .orderBy(desc(execucoesJob.id))
    .limit(60);
  return estadoDaLeituraDasExecucoes(execucoes);
}
