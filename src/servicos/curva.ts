/**
 * Acompanhamento da curva de viralização (etapa 15, parte 1; escopo 4.8):
 * quando o cliente marca "postei", o sistema mede o vídeo de hora em hora
 * nas primeiras 24h, a cada 6h até 72h, depois 1x por dia até 30 dias, e
 * compara sempre com o histórico da própria conta, nunca número absoluto.
 * Funções puras (cadência, "acima do normal") e consultas de leitura aqui;
 * o job que chama a API de verdade e grava fica em
 * `src/jobs/curva-cliente.ts`.
 */
import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { clientes, contas, metricasVideoCliente, videosCliente, type Plataforma } from "@/db/schema";

const HORA_MS = 60 * 60 * 1000;
const LIMITE_DIAS = 30;
const MINIMO_VIDEOS_PROPRIOS = 5;
const MULTIPLICADOR_ACIMA_DO_NORMAL = 2;

/**
 * Intervalo entre medições, dado a idade do vídeo em horas (escopo 4.8):
 * 1h nas primeiras 24h, 6h até 72h, 24h depois disso.
 */
export function intervaloDeMedicaoH(idadeH: number): number {
  if (idadeH <= 24) return 1;
  if (idadeH <= 72) return 6;
  return 24;
}

/**
 * Se um vídeo postado em `postadoEm`, com a última medição em
 * `ultimaColeta` (nula se nunca medido), está na hora de medir de novo em
 * `agora`. Depois de `LIMITE_DIAS`, nunca mais (decisão 1 do
 * `PROXIMO.md`: "para" depois de 30 dias). O job chama isto para cada
 * `videosCliente` antes de gastar cota de API; a mesma conta resolve
 * "não duplica no mesmo intervalo": rodar de novo dentro do intervalo
 * atual devolve `false`.
 */
export function estaNaHoraDeMedir(postadoEm: Date, ultimaColeta: Date | null, agora: Date): boolean {
  const idadeH = (agora.getTime() - postadoEm.getTime()) / HORA_MS;
  if (idadeH < 0 || idadeH > LIMITE_DIAS * 24) return false;
  if (!ultimaColeta) return true;

  const desdeUltimaH = (agora.getTime() - ultimaColeta.getTime()) / HORA_MS;
  return desdeUltimaH >= intervaloDeMedicaoH(idadeH);
}

export type VideoParaMedir = {
  id: number;
  clienteId: number;
  plataforma: Plataforma;
  idExterno: string;
  postadoEm: Date;
  ultimaColeta: Date | null;
};

/**
 * Todo `videos_cliente` com link reconhecido (plataforma e id externo
 * preenchidos; sem link válido é "sem acompanhamento", nunca entra aqui)
 * postado nos últimos `LIMITE_DIAS` dias. O job filtra por
 * `estaNaHoraDeMedir` depois de ler, para o cálculo de cadência ficar num
 * lugar só, testável sem banco.
 */
export async function videosParaMedir(agora: Date): Promise<VideoParaMedir[]> {
  const limite = new Date(agora.getTime() - LIMITE_DIAS * 24 * HORA_MS);
  const linhas = await db()
    .select({
      id: videosCliente.id,
      clienteId: videosCliente.clienteId,
      plataforma: videosCliente.plataforma,
      idExterno: videosCliente.idExterno,
      postadoEm: videosCliente.postadoEm,
      ultimaColeta: videosCliente.ultimaColeta,
    })
    .from(videosCliente)
    .where(
      and(
        isNotNull(videosCliente.plataforma),
        isNotNull(videosCliente.idExterno),
        gte(videosCliente.postadoEm, limite),
      ),
    );

  return linhas as VideoParaMedir[];
}

export type MedianaConta = { mediana: number | null; aprendendo: boolean };

/**
 * A coleta grava `contas.handle` sem "@" no TikTok e no Instagram, e com
 * "@" no YouTube (`src/servicos/nichos.ts`, `analisarUrlPerfil`); o
 * cliente digita o perfil dele no briefing do jeito que quiser. Sem
 * normalizar os dois lados da mesma forma, a comparação nunca batia
 * (rodada de acabamento de 06/09, item 4).
 */
export function normalizarHandle(handle: string, plataforma: Plataforma): string {
  const limpo = handle.replace(/\s+/g, "").replace(/^@+/, "");
  return plataforma === "youtube" ? `@${limpo}` : limpo;
}

/**
 * "Normal da conta" (decisão 3 do `PROXIMO.md`). Quando a conta do cliente
 * já existe em `contas` (mesma plataforma, o handle que ele informou no
 * briefing, normalizado) com `mediana_views`, usa essa, fonte maior e mais
 * estável. Senão, mediana das views finais (última medição) dos vídeos
 * anteriores do próprio cliente em `videos_cliente`, a partir do quinto;
 * antes disso `aprendendo: true`, sem número.
 */
export async function medianaDaConta(
  clienteId: number,
  plataforma: Plataforma,
  excluirVideoClienteId: number,
): Promise<MedianaConta> {
  const [cliente] = await db().select({ perfis: clientes.perfis }).from(clientes).where(eq(clientes.id, clienteId));
  const handleBruto = cliente?.perfis?.[plataforma];
  const handle = handleBruto?.trim() ? normalizarHandle(handleBruto, plataforma) : null;

  if (handle) {
    const [contaDoCliente] = await db()
      .select({ medianaViews: contas.medianaViews })
      .from(contas)
      .where(and(eq(contas.plataforma, plataforma), eq(contas.handle, handle)));
    if (contaDoCliente?.medianaViews != null) {
      return { mediana: Number(contaDoCliente.medianaViews), aprendendo: false };
    }
  }

  const videosAnteriores = await db()
    .select({ id: videosCliente.id })
    .from(videosCliente)
    .where(and(eq(videosCliente.clienteId, clienteId), ne(videosCliente.id, excluirVideoClienteId)));

  if (videosAnteriores.length < MINIMO_VIDEOS_PROPRIOS) {
    return { mediana: null, aprendendo: true };
  }

  const idsAnteriores = videosAnteriores.map((v) => v.id);
  const metricas = await db()
    .select({ videoClienteId: metricasVideoCliente.videoClienteId, views: metricasVideoCliente.views, coletadoEm: metricasVideoCliente.coletadoEm })
    .from(metricasVideoCliente)
    .where(inArray(metricasVideoCliente.videoClienteId, idsAnteriores))
    .orderBy(desc(metricasVideoCliente.coletadoEm));

  const ultimaPorVideo = new Map<number, number>();
  for (const m of metricas) {
    if (!ultimaPorVideo.has(m.videoClienteId)) ultimaPorVideo.set(m.videoClienteId, m.views);
  }

  const valores = [...ultimaPorVideo.values()].sort((a, b) => a - b);
  if (valores.length < MINIMO_VIDEOS_PROPRIOS) {
    return { mediana: null, aprendendo: true };
  }

  const meio = Math.floor(valores.length / 2);
  const mediana = valores.length % 2 === 0 ? (valores[meio - 1] + valores[meio]) / 2 : valores[meio];
  return { mediana, aprendendo: false };
}

/** Última medição dividida pela mediana maior ou igual a 2 (decisão 4 do `PROXIMO.md`). */
export function estaAcimaDoNormal(ultimaMedicaoViews: number, mediana: number | null): boolean {
  return mediana !== null && mediana > 0 && ultimaMedicaoViews / mediana >= MULTIPLICADOR_ACIMA_DO_NORMAL;
}

export type PontoCurva = { coletadoEm: Date; views: number };

/** Os pontos medidos de um vídeo, mais antigo primeiro (decisão 5: texto e números, não gráfico). */
export async function pontosDaCurva(videoClienteId: number): Promise<PontoCurva[]> {
  const linhas = await db()
    .select({ coletadoEm: metricasVideoCliente.coletadoEm, views: metricasVideoCliente.views })
    .from(metricasVideoCliente)
    .where(eq(metricasVideoCliente.videoClienteId, videoClienteId))
    .orderBy(metricasVideoCliente.coletadoEm);
  return linhas;
}

export type CurvaDeVideo =
  | { status: "sem_acompanhamento" }
  | { status: "sem_medicao" }
  | { status: "aprendendo"; pontos: PontoCurva[] }
  | { status: "medido"; pontos: PontoCurva[]; acimaDoNormal: boolean; multiplicador: number };

/**
 * A curva de um `videos_cliente` para `/historico` (decisão 5). `null`
 * quando o vídeo não tem link reconhecido (plataforma ou id externo
 * ausentes): "sem acompanhamento" (decisão 6).
 */
export async function curvaDoVideo(video: {
  id: number;
  clienteId: number;
  plataforma: Plataforma | null;
  idExterno: string | null;
}): Promise<CurvaDeVideo> {
  if (!video.plataforma || !video.idExterno) return { status: "sem_acompanhamento" };

  const pontos = await pontosDaCurva(video.id);
  if (pontos.length === 0) return { status: "sem_medicao" };

  const { mediana, aprendendo } = await medianaDaConta(video.clienteId, video.plataforma, video.id);
  if (aprendendo || mediana === null) return { status: "aprendendo", pontos };

  const ultimaMedicao = pontos[pontos.length - 1].views;
  return {
    status: "medido",
    pontos,
    acimaDoNormal: estaAcimaDoNormal(ultimaMedicao, mediana),
    multiplicador: mediana > 0 ? ultimaMedicao / mediana : 0,
  };
}

export type AvisoVideoSubindo = { videoClienteId: number; postadoEm: Date; multiplicador: number };

/**
 * O vídeo postado mais recente do cliente que está "acima do normal" agora
 * (decisão 4 do `PROXIMO.md`: aviso curto em `/hoje`). `null` sem nenhum.
 */
export async function videoSubindoParaAviso(clienteId: number): Promise<AvisoVideoSubindo | null> {
  const postados = await db()
    .select({
      id: videosCliente.id,
      plataforma: videosCliente.plataforma,
      idExterno: videosCliente.idExterno,
      postadoEm: videosCliente.postadoEm,
    })
    .from(videosCliente)
    .where(and(eq(videosCliente.clienteId, clienteId), isNotNull(videosCliente.plataforma), isNotNull(videosCliente.idExterno)))
    .orderBy(desc(videosCliente.postadoEm))
    .limit(10);

  for (const video of postados) {
    const curva = await curvaDoVideo({ ...video, clienteId });
    if (curva.status === "medido" && curva.acimaDoNormal) {
      return { videoClienteId: video.id, postadoEm: video.postadoEm, multiplicador: curva.multiplicador };
    }
  }
  return null;
}

/**
 * A curva de cada vídeo postado da lista de `roteiroId` de `/historico`,
 * pelo `roteiroId` (decisão 5 do `PROXIMO.md`). Sem entrada no mapa para um
 * `roteiroId` que não tem `videos_cliente` (ainda não postado).
 */
export async function curvasDoHistorico(
  clienteId: number,
  roteiroIds: number[],
): Promise<Map<number, CurvaDeVideo>> {
  const resultado = new Map<number, CurvaDeVideo>();
  if (roteiroIds.length === 0) return resultado;

  const videos = await db()
    .select({
      id: videosCliente.id,
      roteiroId: videosCliente.roteiroId,
      plataforma: videosCliente.plataforma,
      idExterno: videosCliente.idExterno,
    })
    .from(videosCliente)
    .where(inArray(videosCliente.roteiroId, roteiroIds));

  for (const video of videos) {
    if (video.roteiroId === null) continue;
    resultado.set(video.roteiroId, await curvaDoVideo({ ...video, clienteId }));
  }
  return resultado;
}
