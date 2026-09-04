"use server";

import type { SaidaAvaliarTema } from "@/ia/prompts/avaliarTema";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { avaliarTema } from "@/servicos/temas";

/** `/hoje/tema-livre` (brief-frontend.md 6.4). O cliente sempre vem da sessão, nunca de um parâmetro. */
export async function avaliarTemaAction(texto: string): Promise<SaidaAvaliarTema> {
  const cliente = await clienteDaSessaoAtual();
  return avaliarTema(cliente, texto);
}
