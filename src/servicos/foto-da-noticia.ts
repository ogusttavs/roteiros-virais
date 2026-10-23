/**
 * Quem pode ver a foto da matéria guardada (`imagens_noticia`, fix de 22/10/2026): a pessoa logada que tem uma marca ativa no setor da notícia (ramo principal ou alternativo), e o admin. A foto é
 * dado público do veículo, igual para todas as marcas do setor, mas a rota não é pública: só quem está dentro do painel e no setor da notícia a recebe.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { imagensNoticia, noticias, ramosDaConta } from "@/db/schema";

import { marcasDoUsuario } from "./clientes";

export type FotoDaNoticia = { tipo: string; bytes: Buffer };

export async function fotoGuardadaDaNoticia(noticiaId: number, usuario: { id: string; role?: string | null }): Promise<FotoDaNoticia | "negado" | null> {
  const [linha] = await db()
    .select({ nichoId: noticias.nichoId, tipo: imagensNoticia.tipo, bytes: imagensNoticia.bytes })
    .from(imagensNoticia)
    .innerJoin(noticias, eq(noticias.id, imagensNoticia.noticiaId))
    .where(and(eq(imagensNoticia.noticiaId, noticiaId), eq(imagensNoticia.situacao, "guardada")));
  if (!linha || !linha.bytes || !linha.tipo) return null;

  if (usuario.role !== "admin") {
    const marcas = await marcasDoUsuario(usuario.id);
    const setores = new Set<number>(marcas.map((m) => m.nichoId).filter((n): n is number => n !== null));
    if (marcas.length > 0) {
      const alternativos = await db()
        .select({ nichoId: ramosDaConta.nichoId })
        .from(ramosDaConta)
        .where(inArray(ramosDaConta.clienteId, marcas.map((m) => m.id)));
      for (const a of alternativos) setores.add(a.nichoId);
    }
    if (linha.nichoId === null || !setores.has(linha.nichoId)) return "negado";
  }
  return { tipo: linha.tipo, bytes: linha.bytes };
}
