import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { disparosDoAdmin, user } from "@/db/schema";

/** Guarda um "rodar agora" do admin (quem, qual fila, quando). */
export async function registrarDisparo(fila: string, porUsuarioId: string): Promise<void> {
  await db().insert(disparosDoAdmin).values({ fila, porUsuarioId });
}

export type DisparoComNome = { fila: string; em: Date; porNome: string | null };

/** O disparo à mão mais recente de cada fila (quem e quando), para o detalhe da rotina. */
export async function ultimosDisparos(filas: string[]): Promise<Map<string, DisparoComNome>> {
  if (filas.length === 0) return new Map();
  const linhas = await db()
    .select({ fila: disparosDoAdmin.fila, em: disparosDoAdmin.em, porNome: user.name })
    .from(disparosDoAdmin)
    .leftJoin(user, eq(user.id, disparosDoAdmin.porUsuarioId))
    .where(inArray(disparosDoAdmin.fila, filas))
    .orderBy(desc(disparosDoAdmin.em), desc(disparosDoAdmin.id));
  const mapa = new Map<string, DisparoComNome>();
  for (const l of linhas) if (!mapa.has(l.fila)) mapa.set(l.fila, l);
  return mapa;
}
