/**
 * As datas da marca (E60): quais ramos a marca tem, para a base de `src/config/datas.ts` escolher as datas dela. O ramo principal e os alternativos
 * (que só o admin liga) valem igual: uma clínica que o admin ligou também em medicina vê o Dia do Médico.
 */
import { eq } from "drizzle-orm";

import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { nichos } from "@/db/schema";
import { logger } from "@/lib/log";

import { ramosAlternativosDaMarca } from "./ramos-da-conta";

/** Os slugs de ramo da marca (o principal primeiro), ou vazio se ela ainda não tem ramo: então só as datas gerais valem. */
export async function ramosDaMarcaParaDatas(cliente: { id: number; nichoId: number | null }): Promise<string[]> {
  const ramos: string[] = [];
  if (cliente.nichoId) {
    const [principal] = await db().select({ ramoCatalogo: nichos.ramoCatalogo }).from(nichos).where(eq(nichos.id, cliente.nichoId));
    const slug = ramoPorSlug(principal?.ramoCatalogo)?.slug;
    if (slug) ramos.push(slug);
  }
  for (const alternativo of await ramosAlternativosDaMarca(cliente.id)) {
    if (alternativo.ramoSlug && !ramos.includes(alternativo.ramoSlug)) ramos.push(alternativo.ramoSlug);
  }
  return ramos;
}

/** O mesmo, sem nunca derrubar a tela: as datas são um extra, e uma falha do banco aqui só as tira (a tela abre igual). */
export async function ramosDaMarcaParaDatasSemFalha(cliente: { id: number; nichoId: number | null }): Promise<string[]> {
  return ramosDaMarcaParaDatas(cliente).catch((erro) => {
    logger.warn({ err: erro, clienteId: cliente.id }, "datas: nao foi possivel ler os ramos da marca (so as datas gerais valem)");
    return [];
  });
}
