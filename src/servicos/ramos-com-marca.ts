/**
 * Os setores (ramos) que têm ao menos uma marca ativa, para o `transcrever` ler mais vídeos neles por noite (achado de 23/10/2026: o ramo 5 tinha 3.523 vídeos acima do piso e só 109 lidos).
 * A marca conta pelo ramo principal (`clientes.nicho_id`) e pelos alternativos que o admin ligou (`ramos_da_conta`). Com a cobrança ligada (E22), a marca que precisa assinar e não assinou
 * não conta (`separarMarcasPorAssinatura`): com a cobrança desligada, que é o caso hoje, é só "a marca está ativa".
 */
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { clientes, ramosDaConta } from "@/db/schema";

import { separarMarcasPorAssinatura } from "./assinatura-tarefas";

export async function setoresComMarcaAtiva(agora: Date = new Date()): Promise<Set<number>> {
  const principais = await db()
    .selectDistinct({ id: clientes.id, nichoId: clientes.nichoId })
    .from(clientes)
    .where(and(eq(clientes.ativo, true), isNotNull(clientes.nichoId)));
  const alternativos = await db()
    .selectDistinct({ id: clientes.id, nichoId: ramosDaConta.nichoId })
    .from(ramosDaConta)
    .innerJoin(clientes, eq(clientes.id, ramosDaConta.clienteId))
    .where(eq(clientes.ativo, true));
  const todas = [...principais, ...alternativos];
  const { liberadas } = await separarMarcasPorAssinatura(todas.map((l) => l.id), { agora });
  return new Set(todas.filter((l) => liberadas.has(l.id)).map((l) => l.nichoId).filter((id): id is number => id !== null));
}
