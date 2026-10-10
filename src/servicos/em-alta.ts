/**
 * O cartão "Em alta hoje" (E55 PR 2, o passo 21 do Opus): o assunto que está em alta no Brasil hoje, trazido para o ramo da marca. Os dados vêm do que o PR 1 já guarda (o tema do momento
 * dentro de `temas_dia`, a lista de agora em `tendencias_brasil`, o roteiro que a marca já criou dele); aqui só se juntam e se medem as duas coisas que o desenho pede e o motor não tinha:
 * desde quando o assunto está em alta e o número de buscas do Google. Nenhum custo de modelo: tudo é leitura do banco.
 */
import { gte } from "drizzle-orm";

import { db } from "@/db";
import { tendenciasBrasil, type Cliente } from "@/db/schema";
import { logger } from "@/lib/log";

import { roteiroDoMomentoDeHoje, somarDiasISO } from "./roteiro";
import { temasParaCliente } from "./temas";
import { assuntoSegueEmAlta, listaDeTendenciasDeAgora, type ListaDeAgora } from "./tendencias";

const FUSO = "America/Sao_Paulo";
const HORA_MS = 60 * 60 * 1000;
/** O quanto para trás se olha para achar a primeira rodada em que o assunto apareceu: duas coletas por dia, então a de anteontem de manhã ainda entra. */
const HORAS_PARA_TRAS = 60;

export type DesdeQuando = { dia: "hoje" | "ontem" | "antes"; hora: number };

export type CartaoEmAlta = {
  assunto: string;
  /** De onde vem o assunto agora: a rodada de agora o traz pelas buscas do Google, pelos vídeos do YouTube, ou pelos dois. */
  doGoogle: boolean;
  doYoutube: boolean;
  /** Desde quando o assunto aparece sem parar nas rodadas de coleta; nulo se não deu para saber. */
  desde: DesdeQuando | null;
  /** O número de buscas do Google já escrito ("2.000"), ou nulo (YouTube, ou o Google não trouxe o número). */
  buscas: string | null;
  /** O tema do momento da marca: o índice dele na lista dos temas de hoje (é o `?tema=` do Criar), o título e o que gravar. */
  tema: { indice: number; titulo: string; descricao: string };
  /** O roteiro que a marca já criou hoje deste assunto, ou nulo se ainda não criou. */
  roteiro: { id: number; status: "gerado" | "gravado" | "postado" } | null;
};

/** Mesmo texto do número do Google que o motor guarda ("200+", "2000+", "500K+"): o número com ponto de milhar, sem o "+". Nulo se não for um número. */
export function formatarBuscasDoGoogle(trafego: string | null): string | null {
  if (!trafego) return null;
  const texto = trafego.trim();
  // Com K ou M, o ponto ou a vírgula é decimal ("1,5M+" são 1,5 milhão); sem eles, é separador de milhar ("12.345+").
  const comSufixo = texto.match(/^(\d+(?:[.,]\d+)?)\s*([KkMm])\s*\+?$/);
  const semSufixo = texto.match(/^(\d[\d.,]*)\s*\+?$/);
  let total: number;
  if (comSufixo) total = Number(comSufixo[1].replace(",", ".")) * (comSufixo[2].toLowerCase() === "k" ? 1_000 : 1_000_000);
  else if (semSufixo) total = Number(semSufixo[1].replace(/[.,]/g, ""));
  else return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total).toLocaleString("pt-BR");
}

type AssuntoDaRodada = { chave: string; termos: string[] };

/**
 * A rodada mais antiga das que vêm seguidas até a de agora, todas com o assunto (a mesma regra de "segue em alta" do tema do momento). Para na primeira rodada, indo para trás, em que ele
 * não aparece: o assunto que saiu e voltou conta de novo a partir da volta. Pura, para testar sem banco.
 */
export function rodadaMaisAntigaSeguida(doMomento: AssuntoDaRodada, rodadas: { coletadaEm: Date; assuntos: AssuntoDaRodada[] }[]): Date | null {
  const novasPrimeiro = [...rodadas].sort((a, b) => b.coletadaEm.getTime() - a.coletadaEm.getTime());
  let maisAntiga: Date | null = null;
  for (const rodada of novasPrimeiro) {
    if (!assuntoSegueEmAlta(doMomento, rodada.assuntos)) break;
    maisAntiga = rodada.coletadaEm;
  }
  return maisAntiga;
}

function dataNoBrasil(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}

/** "hoje, 5h", "ontem, 12h": o dia (no fuso do Brasil, em relação a `hoje`) e a hora cheia (para baixo) do instante. */
export function desdeQuandoDe(instante: Date, hoje: string): DesdeQuando {
  const dia = dataNoBrasil(instante);
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hour12: false }).format(instante)) % 24;
  return { dia: dia === hoje ? "hoje" : dia === somarDiasISO(hoje, -1) ? "ontem" : "antes", hora };
}

async function rodadasRecentes(agora: Date): Promise<{ coletadaEm: Date; assuntos: AssuntoDaRodada[] }[]> {
  const linhas = await db()
    .select({ coletadaEm: tendenciasBrasil.coletadaEm, chave: tendenciasBrasil.chave, termos: tendenciasBrasil.termos })
    .from(tendenciasBrasil)
    .where(gte(tendenciasBrasil.coletadaEm, new Date(agora.getTime() - HORAS_PARA_TRAS * HORA_MS)));
  const porRodada = new Map<number, { coletadaEm: Date; assuntos: AssuntoDaRodada[] }>();
  for (const linha of linhas) {
    const chaveDaRodada = linha.coletadaEm.getTime();
    const rodada = porRodada.get(chaveDaRodada) ?? { coletadaEm: linha.coletadaEm, assuntos: [] };
    rodada.assuntos.push({ chave: linha.chave, termos: linha.termos });
    porRodada.set(chaveDaRodada, rodada);
  }
  return [...porRodada.values()];
}

/**
 * O assunto de agora na lista, para dizer de que fontes ele vem e quantas buscas o Google contou: o de mesma chave, e só sem ele o que casa por termo (o mais alto). Sem a preferência
 * pela chave, "Copa do Brasil" podia pegar as fontes e o número de outro assunto da lista que divide a palavra "copa".
 */
function assuntoDeAgora(doMomento: AssuntoDaRodada, lista: ListaDeAgora) {
  return lista.assuntos.find((a) => a.chave === doMomento.chave) ?? lista.assuntos.find((a) => assuntoSegueEmAlta(doMomento, [a])) ?? null;
}

/**
 * O mesmo cartão, para as telas: uma falha ao montá-lo nunca derruba a agenda (o cartão só não aparece), mas vai para o log, para não sumir em silêncio.
 */
export async function cartaoEmAltaSemFalha(cliente: Cliente, hoje: string): Promise<CartaoEmAlta | null> {
  try {
    return await cartaoEmAltaDaMarca(cliente, hoje);
  } catch (erro) {
    logger.warn({ err: erro, clienteId: cliente.id }, "em-alta: o cartao nao saiu");
    return null;
  }
}

/**
 * O cartão "Em alta hoje" da marca, ou nulo: sem tema do momento (nenhum assunto cabe no ramo, ou o assunto já saiu do que está em alta, ou a lista de agora passou de 18 horas), ou quando a
 * pessoa já arquivou o roteiro deste assunto hoje ("Arquivar" é a saída do assunto do momento, e o cartão não oferece de novo o mesmo assunto no mesmo dia).
 */
export async function cartaoEmAltaDaMarca(cliente: Cliente, hoje: string, agora: Date = new Date()): Promise<CartaoEmAlta | null> {
  const resultado = await temasParaCliente(cliente, hoje);
  if (resultado.status !== "ok" || resultado.dataUsada !== hoje) return null;
  const indice = resultado.temas.findIndex((t) => t.doMomento !== undefined);
  if (indice < 0) return null;
  const tema = resultado.temas[indice];
  const doMomento = tema.doMomento!;

  const roteiro = await roteiroDoMomentoDeHoje(cliente.id, hoje, doMomento.chave);
  if (roteiro?.arquivado) return null;

  const [lista, rodadas] = await Promise.all([listaDeTendenciasDeAgora(agora), rodadasRecentes(agora)]);
  const deAgora = lista ? assuntoDeAgora(doMomento, lista) : null;
  const doGoogle = lista ? deAgora?.fontes.some((f) => f.fonte === "google") ?? false : doMomento.fonte.includes("Google");
  const doYoutube = lista ? deAgora?.fontes.some((f) => f.fonte === "youtube") ?? false : doMomento.fonte.includes("YouTube");
  // Sem lista de agora nem fonte no tema (não deveria acontecer: o tema do momento só vale com a lista), o cartão diz o que é mais provável, o Google.
  const nenhuma = !doGoogle && !doYoutube;
  const buscas = formatarBuscasDoGoogle(deAgora?.fontes.find((f) => f.fonte === "google" && f.trafego)?.trafego ?? null);
  const primeira = rodadaMaisAntigaSeguida(doMomento, rodadas);

  return {
    assunto: doMomento.assunto,
    doGoogle: doGoogle || nenhuma,
    doYoutube,
    desde: primeira ? desdeQuandoDe(primeira, hoje) : null,
    buscas,
    tema: { indice, titulo: tema.titulo, descricao: tema.descricao },
    roteiro: roteiro ? { id: roteiro.id, status: roteiro.status } : null,
  };
}
