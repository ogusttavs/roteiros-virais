/**
 * As tendências do Brasil (E55): o que está em alta no país hoje, para todos os setores. Aqui moram as regras puras (a chave de um assunto, o que é sensível, se um assunto segue em alta) e a
 * leitura da lista de agora. A coleta (`jobs/tendencias-brasil.ts`) grava; o tema do momento (`jobs/tema-do-momento.ts`), a nota do tema (`servicos/temas.ts`) e o filtro dos temas do dia lêem.
 * Tendência é para o mesmo dia: a lista de agora é a rodada mais recente, e só vale se for de poucas horas atrás.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { tendenciasBrasil, type TemaDoDia, type TendenciaBrasil } from "@/db/schema";

import { normalizarTexto } from "./noticias-assuntos";
import { raizesDoTexto } from "./noticias-do-tema";

/** Quanto tempo uma rodada continua sendo "a lista de agora": a coleta roda de madrugada e ao meio-dia, então 18 horas cobrem um intervalo e um atraso. */
export const HORAS_DA_LISTA_DE_AGORA = 18;
const HORA_MS = 60 * 60 * 1000;

/** O assunto sem acento, sem pontuação e minúsculo, para comparar o mesmo assunto de uma rodada para a outra. */
export function chaveDoAssunto(assunto: string): string {
  return normalizarTexto(assunto);
}

/**
 * Tragédia, morte, crime, violência e política partidária: o assunto entra como sinal de momento na nota do tema, mas nunca vira tema sugerido sozinho. O modelo marca `sensivel` e este
 * conferir por palavras é a segunda trava (o modelo barato erra). Casa por início de palavra, sem acento, para pegar "eleição" e "eleições".
 */
const SENSIVEIS = [
  "morte", "morre", "morreu", "morto", "mortos", "morta", "assassin", "tragedia", "acidente", "velorio", "luto", "suicid", "estupr", "chacina", "massacre", "incendio", "desabament", "naufrag",
  "sequestr", "atentado", "guerra", "bomba", "ataque", "feminicid", "violencia", "homicid", "latrocin", "tiroteio", "baleado", "afogad", "queda de aviao", "enchente", "terremoto",
  "eleic", "candidat", "partido", "bolsonar", "lula", "urna", "deputad", "senador", "vereador", "prefeit", "governador", "presidenciavel", "pesquisa eleitoral", "debate eleitoral",
];
const REGEX_SENSIVEL = new RegExp(`\\b(${SENSIVEIS.join("|")})`);

export function ehSensivel(texto: string): boolean {
  return REGEX_SENSIVEL.test(normalizarTexto(texto));
}

/** Um assunto do tema do momento segue em alta quando a lista de agora tem o mesmo assunto (mesma chave) ou um que divide uma palavra de busca com ele (termo de três letras ou mais). */
export function assuntoSegueEmAlta(
  doMomento: { chave: string; termos: string[] },
  lista: { chave: string; termos: string[] }[],
): boolean {
  const meus = new Set([doMomento.chave, ...doMomento.termos.map(chaveDoAssunto)].filter((t) => t.length >= 3));
  return lista.some((a) => [a.chave, ...a.termos.map(chaveDoAssunto)].some((t) => t.length >= 3 && meus.has(t)));
}

export type ListaDeAgora = { coletadaEm: Date; assuntos: TendenciaBrasil[] };

/** A rodada mais recente de tendências, ou nulo quando não há nenhuma ou ela já passou de `HORAS_DA_LISTA_DE_AGORA`. Os assuntos vêm do mais alto (posição 1) para o mais baixo. */
export async function listaDeTendenciasDeAgora(agora: Date = new Date()): Promise<ListaDeAgora | null> {
  const [ultima] = await db().select({ coletadaEm: tendenciasBrasil.coletadaEm }).from(tendenciasBrasil).orderBy(desc(tendenciasBrasil.coletadaEm)).limit(1);
  if (!ultima || agora.getTime() - ultima.coletadaEm.getTime() > HORAS_DA_LISTA_DE_AGORA * HORA_MS) return null;
  const assuntos = await db().select().from(tendenciasBrasil).where(eq(tendenciasBrasil.coletadaEm, ultima.coletadaEm)).orderBy(tendenciasBrasil.posicao);
  return { coletadaEm: ultima.coletadaEm, assuntos };
}

/** O tema do momento vale hoje e enquanto o assunto dele segue na lista de agora; sem lista de agora, não vale. */
export function temaDoMomentoAindaVale(tema: TemaDoDia, lista: ListaDeAgora | null): boolean {
  if (!tema.doMomento) return true;
  if (!lista) return false;
  return assuntoSegueEmAlta(tema.doMomento, lista.assuntos);
}

/** Tira dos temas os do momento que não valem mais (o assunto saiu da lista, ou a lista de agora sumiu); os outros ficam como estão. */
export function temasQueAindaValem(temas: TemaDoDia[], lista: ListaDeAgora | null): TemaDoDia[] {
  return temas.filter((t) => temaDoMomentoAindaVale(t, lista));
}

export type TendenciaQueToca = { assunto: string; fonte: "google" | "youtube"; sensivel: boolean };

/**
 * Os assuntos em alta no Brasil agora que tocam um texto (o tema que a pessoa propôs): os que dividem uma palavra com ele (raiz de 5 letras, como as notícias do dia). Todos entram, inclusive os
 * sensíveis: aqui o assunto é só sinal de momento para a nota do tema, nunca um tema sugerido. No máximo 5, do mais alto para o mais baixo.
 */
export function tendenciasQueTocamOTema(texto: string, lista: ListaDeAgora | null): TendenciaQueToca[] {
  if (!lista) return [];
  const raizes = raizesDoTexto(texto);
  if (raizes.size === 0) return [];
  return lista.assuntos
    .filter((a) => {
      const doAssunto = raizesDoTexto(`${a.assunto} ${a.termos.join(" ")}`);
      return [...raizes].some((r) => doAssunto.has(r));
    })
    .slice(0, 5)
    .map((a) => ({ assunto: a.assunto, fonte: a.fontes[0]?.fonte ?? "google", sensivel: a.sensivel }));
}

