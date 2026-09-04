"use server";

import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { desfavoritar, favoritar } from "@/servicos/referencias";

/** `/referencias` (brief-frontend.md 6.6). O cliente sempre vem da sessão, nunca de um parâmetro. */
export async function favoritarAction(videoId: number): Promise<void> {
  const cliente = await clienteDaSessaoAtual();
  await favoritar(cliente.id, videoId);
}

export async function desfavoritarAction(videoId: number): Promise<void> {
  const cliente = await clienteDaSessaoAtual();
  await desfavoritar(cliente.id, videoId);
}
