/**
 * O alarme do disco do servidor (29/10/2026, pedido do Gustavo antes de abrir a edição de vídeo para clientes). A VPS tem 100 GB e é dividida com outro produto; vídeo enche disco rápido.
 *
 * O que há aqui:
 *  - a MEDIDA: o espaço do sistema de arquivos que o contêiner enxerga (`fs.statfs`; um volume do Docker é a mesma partição da máquina) mais o tamanho de `/var/edicao` e de `/var/publicar`;
 *  - o NÍVEL: normal, atenção (80% usado) ou crítico (90%), com os limites por variável de ambiente e uma folga de 2 pontos para descer (o disco que oscila em volta da linha não pisca);
 *  - a DECISÃO de avisar, pura: um aviso por nível por dia, e um de "voltou ao normal" depois de qualquer aviso;
 *  - o ESTADO, guardado em `configuracao_admin` (sem tabela nova), que o Início do admin lê e o job `vigiar-disco` atualiza a cada 15 minutos;
 *  - a RECUSA do envio de vídeo para editar quando o disco está crítico (`recusaPorDiscoCritico`), que mede na hora (um `statfs` é barato) e pede a limpeza.
 */
import { readdir, stat, statfs } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin } from "@/db/schema";
import { pastaDaEdicao } from "@/edicao/arquivos";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { pastaDosVideos } from "@/lib/video-temporario";
import { fraseDaEdicao } from "@/textos/edicao";

export type NivelDoDisco = "normal" | "atencao" | "critico";

export const CHAVE_DO_ALARME_DE_DISCO = "alarme_disco_estado";

/** Quantos pontos de porcentagem abaixo do limite o uso precisa cair para o nível baixar (evita avisar de novo a cada oscilação). */
export const FOLGA_PARA_DESCER_PONTOS = 2;

const PADRAO_ATENCAO = 80;
const PADRAO_CRITICO = 90;

export type LimitesDoDisco = { atencao: number; critico: number };

/** Os limites configurados. Valor fora do razoável volta para 80 e 90 (os dois juntos, para a ordem nunca se inverter). */
export function limitesDoDisco(configurado: { atencaoPercentual: number; criticoPercentual: number } = config.disco): LimitesDoDisco {
  const { atencaoPercentual: a, criticoPercentual: c } = configurado;
  if (!Number.isFinite(a) || !Number.isFinite(c) || a < 1 || a > 99 || c <= a || c > 100) return { atencao: PADRAO_ATENCAO, critico: PADRAO_CRITICO };
  return { atencao: a, critico: c };
}

/** O nível pelo uso. `anterior` aplica a folga: quem estava em um nível só desce dele quando o uso cai `FOLGA_PARA_DESCER_PONTOS` abaixo do limite. */
export function nivelDoUso(usadoPercentual: number, limites: LimitesDoDisco, anterior: NivelDoDisco | null = null): NivelDoDisco {
  if (usadoPercentual >= limites.critico) return "critico";
  if (anterior === "critico" && usadoPercentual >= limites.critico - FOLGA_PARA_DESCER_PONTOS) return "critico";
  if (usadoPercentual >= limites.atencao) return "atencao";
  if ((anterior === "critico" || anterior === "atencao") && usadoPercentual >= limites.atencao - FOLGA_PARA_DESCER_PONTOS) return "atencao";
  return "normal";
}

// ---------------------------------------------------------------------------
// A medida
// ---------------------------------------------------------------------------

export type MedidaDoDisco = {
  totalBytes: number;
  livreBytes: number;
  /** Como o `df`: usado dividido por (usado mais o que um usuário comum ainda pode gravar), com uma casa. */
  usadoPercentual: number;
  /** O tamanho de tudo o que está em `EDICAO_PASTA` (bruto e editado). */
  edicaoBytes: number;
  /** O tamanho de tudo o que está em `PUBLICAR_PASTA_TEMP`. */
  publicarBytes: number;
};

export type SistemaDeArquivos = { bsize: number; blocks: number; bfree: number; bavail: number };

export type DepsDaMedida = {
  /** Troca o `fs.statfs` (os testes dão o disco que quiserem). */
  statfs?: (caminho: string) => Promise<SistemaDeArquivos>;
  /** Troca a soma do tamanho de uma pasta. */
  tamanhoDaPasta?: (caminho: string) => Promise<number>;
};

/** A soma dos arquivos de uma pasta, descendo nas subpastas. Pasta que não existe (ainda não houve envio) vale zero; arquivo que some no meio da conta é ignorado. */
export async function tamanhoDaPasta(pasta: string): Promise<number> {
  let entradas;
  try {
    entradas = await readdir(pasta, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entrada of entradas) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) total += await tamanhoDaPasta(caminho);
    else if (entrada.isFile()) {
      try {
        total += (await stat(caminho)).size;
      } catch {
        // o arquivo foi apagado agora há pouco
      }
    }
  }
  return total;
}

/** O disco que o contêiner enxerga. Olha a pasta da edição (o volume) e, se ela ainda não existe, a raiz. */
async function statfsDoDisco(statfsDeDentro: (c: string) => Promise<SistemaDeArquivos>): Promise<SistemaDeArquivos> {
  try {
    return await statfsDeDentro(pastaDaEdicao());
  } catch {
    return statfsDeDentro(process.platform === "win32" ? process.cwd() : "/");
  }
}

function porcentagemUsada(fs: SistemaDeArquivos): number {
  const usados = fs.blocks - fs.bfree;
  const denominador = usados + fs.bavail;
  if (denominador <= 0) return 0;
  return Math.round((usados / denominador) * 1000) / 10;
}

/** Só o espaço do disco, sem somar as pastas: é o que a rota de envio mede a cada pedido. */
export async function medirEspacoDoDisco(deps: DepsDaMedida = {}): Promise<Pick<MedidaDoDisco, "totalBytes" | "livreBytes" | "usadoPercentual">> {
  const fs = await statfsDoDisco(deps.statfs ?? ((c) => statfs(c)));
  return { totalBytes: fs.blocks * fs.bsize, livreBytes: fs.bavail * fs.bsize, usadoPercentual: porcentagemUsada(fs) };
}

export async function medirDisco(deps: DepsDaMedida = {}): Promise<MedidaDoDisco> {
  const espaco = await medirEspacoDoDisco(deps);
  const somar = deps.tamanhoDaPasta ?? tamanhoDaPasta;
  const [edicaoBytes, publicarBytes] = await Promise.all([somar(pastaDaEdicao()), somar(pastaDosVideos())]);
  return { ...espaco, edicaoBytes, publicarBytes };
}

// ---------------------------------------------------------------------------
// A decisão de avisar (pura)
// ---------------------------------------------------------------------------

export type AcaoDeAviso = "atencao" | "critico" | "voltou";

/** O que o alarme lembra de uma medida para a outra. Datas de aviso são o dia do Brasil (`hojeISO`). */
export type EstadoDoAlarme = {
  nivel: NivelDoDisco;
  /** Desde quando o disco está neste nível (instante ISO). */
  desde: string;
  medidoEm: string;
  usadoPercentual: number;
  livreBytes: number;
  totalBytes: number;
  edicaoBytes: number;
  publicarBytes: number;
  /** O dia do último e-mail enviado de cada nível. */
  emailEm: { atencao: string | null; critico: string | null };
  /** O dia do último registro no Sentry de cada nível. */
  sentryEm: { atencao: string | null; critico: string | null };
  /** Houve aviso de atenção ou crítico e ainda não foi mandado o "voltou ao normal". */
  voltaPendente: boolean;
};

export type DecisaoDeAviso = { email: AcaoDeAviso | null; sentry: "atencao" | "critico" | null };

/**
 * O que avisar agora. Um e-mail e um registro no Sentry por nível por dia (a marca do dia só é gravada quando o envio deu certo, então um e-mail que falhou tenta de novo na próxima medida).
 * O "voltou ao normal" sai uma vez, na primeira medida normal depois de qualquer aviso. Pura.
 */
export function decidirAvisos(anterior: Pick<EstadoDoAlarme, "emailEm" | "sentryEm" | "voltaPendente"> | null, nivel: NivelDoDisco, hoje: string): DecisaoDeAviso {
  if (nivel === "normal") return { email: anterior?.voltaPendente ? "voltou" : null, sentry: null };
  return {
    email: anterior?.emailEm[nivel] === hoje ? null : nivel,
    sentry: anterior?.sentryEm[nivel] === hoje ? null : nivel,
  };
}

// ---------------------------------------------------------------------------
// O estado no banco
// ---------------------------------------------------------------------------

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

function marcas(valor: unknown): { atencao: string | null; critico: string | null } {
  const o = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  return { atencao: texto(o.atencao), critico: texto(o.critico) };
}

/** Lê o estado guardado; texto estragado ou de outra forma vale como "nunca medi". */
export function estadoDoTexto(bruto: string | null | undefined): EstadoDoAlarme | null {
  if (!bruto) return null;
  let o: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(bruto);
    if (!lido || typeof lido !== "object" || Array.isArray(lido)) return null;
    o = lido as Record<string, unknown>;
  } catch {
    return null;
  }
  const nivel = o.nivel;
  if (nivel !== "normal" && nivel !== "atencao" && nivel !== "critico") return null;
  const usado = numero(o.usadoPercentual);
  const livre = numero(o.livreBytes);
  const total = numero(o.totalBytes);
  const desde = texto(o.desde);
  const medidoEm = texto(o.medidoEm);
  if (usado === null || livre === null || total === null || !desde || !medidoEm) return null;
  return {
    nivel,
    desde,
    medidoEm,
    usadoPercentual: usado,
    livreBytes: livre,
    totalBytes: total,
    edicaoBytes: numero(o.edicaoBytes) ?? 0,
    publicarBytes: numero(o.publicarBytes) ?? 0,
    emailEm: marcas(o.emailEm),
    sentryEm: marcas(o.sentryEm),
    voltaPendente: o.voltaPendente === true,
  };
}

export async function lerEstadoDoAlarme(): Promise<EstadoDoAlarme | null> {
  const [linha] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_ALARME_DE_DISCO));
  return estadoDoTexto(linha?.valor);
}

export async function gravarEstadoDoAlarme(estado: EstadoDoAlarme): Promise<void> {
  const valor = JSON.stringify(estado);
  await db()
    .insert(configuracaoAdmin)
    .values({ chave: CHAVE_DO_ALARME_DE_DISCO, valor })
    .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor, atualizadoEm: new Date() } });
}

// ---------------------------------------------------------------------------
// A limpeza na hora e a recusa do envio
// ---------------------------------------------------------------------------

/** Pede ao worker a limpeza dos vídeos guardados agora, sem esperar a hora cheia. Um pedido por vez (o mesmo `singletonKey` não deixa empilhar). Nunca lança. */
export async function pedirLimpezaAgora(): Promise<boolean> {
  try {
    await garantirBossPronto();
    await boss().send(FILAS.limparEdicoes, {}, { singletonKey: "limpeza-por-disco-cheio" });
    return true;
  } catch (erro) {
    logger.warn({ err: erro }, "disco: nao foi possivel pedir a limpeza na hora");
    return false;
  }
}

export type DepsDaRecusaPorDisco = {
  medir?: () => Promise<Pick<MedidaDoDisco, "usadoPercentual">>;
  limites?: LimitesDoDisco;
  limparAgora?: () => Promise<unknown>;
};

export type RecusaPorDisco = { status: 503; codigo: "disco-cheio"; frase: string };

/**
 * No nível crítico o envio de vídeo para editar é recusado com uma frase para a pessoa, e a limpeza é pedida na hora. Mede o disco a cada pedido (a medida do job pode ter até 15 minutos). Se a medida
 * falhar, o envio segue: um disco que não conseguimos medir não pode derrubar o produto. Publicar no Instagram não passa por aqui e continua funcionando.
 */
export async function recusaPorDiscoCritico(deps: DepsDaRecusaPorDisco = {}): Promise<RecusaPorDisco | null> {
  const limites = deps.limites ?? limitesDoDisco();
  let usado: number;
  try {
    usado = (await (deps.medir ?? (() => medirEspacoDoDisco()))()).usadoPercentual;
  } catch (erro) {
    logger.warn({ err: erro }, "disco: nao foi possivel medir o disco no envio do video");
    return null;
  }
  if (usado < limites.critico) return null;
  await (deps.limparAgora ?? pedirLimpezaAgora)();
  return { status: 503, codigo: "disco-cheio", frase: fraseDaEdicao("disco-cheio") };
}
