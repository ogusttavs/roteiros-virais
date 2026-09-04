/**
 * Favoritos da biblioteca de referências (etapa 12, decisão 1 do
 * `PROXIMO.md`): favoritar um vídeo grava a referência do cliente; a
 * próxima recompilação do perfil (`compilarEGravarPerfil`, briefing.ts)
 * inclui os favoritos em `PerfilCompilado.referencias`, do mesmo jeito que
 * `clientes.camadaExclusiva` já populava concorrentes e perfis admirados
 * por código, não pela IA.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { favoritos, videos, type AnaliseVideo } from "@/db/schema";

export async function favoritosDoCliente(clienteId: number): Promise<Set<number>> {
  const linhas = await db()
    .select({ videoId: favoritos.videoId })
    .from(favoritos)
    .where(eq(favoritos.clienteId, clienteId));
  return new Set(linhas.map((l) => l.videoId));
}

/** Idempotente: favoritar de novo o que já está salvo não dá erro (índice único cuida disso). */
export async function favoritar(clienteId: number, videoId: number): Promise<void> {
  await db().insert(favoritos).values({ clienteId, videoId }).onConflictDoNothing();
}

export async function desfavoritar(clienteId: number, videoId: number): Promise<void> {
  await db()
    .delete(favoritos)
    .where(and(eq(favoritos.clienteId, clienteId), eq(favoritos.videoId, videoId)));
}

/** Uma linha por favorito, mais recente primeiro, para `PerfilCompilado.referencias`. */
export async function referenciasParaPerfil(clienteId: number): Promise<string[]> {
  const linhas = await db()
    .select({ analise: videos.analise })
    .from(favoritos)
    .innerJoin(videos, eq(videos.id, favoritos.videoId))
    .where(eq(favoritos.clienteId, clienteId))
    .orderBy(desc(favoritos.criadoEm));

  return linhas
    .filter((l): l is { analise: AnaliseVideo } => l.analise !== null)
    .map((l) => `${l.analise.assunto}: ${l.analise.gancho}`);
}
