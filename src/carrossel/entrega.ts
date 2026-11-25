/**
 * E65 PR 1: o que as rotas de baixar usam: lê o carrossel e as fotos da marca e chama o render. Fica fora do serviço de texto (`servicos/carrossel.ts`) para quem só escreve texto não carregar o navegador.
 */
import { logger } from "@/lib/log";
import { carrosselDaMarca, fotosComBytes } from "@/servicos/carrossel";

import { renderizarSlides } from "./render";

/** Os PNG do carrossel da marca (todos, ou só o slide `somente`, a partir de 0), ou nulo se o carrossel não é da marca. */
export async function pngDoCarrossel(clienteId: number, carrosselId: number, somente?: number): Promise<{ png: Buffer[]; avisos: string[]; tema: string } | null> {
  const carrossel = await carrosselDaMarca(clienteId, carrosselId);
  if (!carrossel) return null;
  if (somente !== undefined && (somente < 0 || somente >= carrossel.slides.length)) return null;
  const fotos = await fotosComBytes(clienteId, carrosselId);
  const resultado = await renderizarSlides({ slides: carrossel.slides, fotos, cor: carrossel.cor, somente });
  if (resultado.avisos.length > 0) logger.warn({ clienteId, carrosselId, avisos: resultado.avisos }, "carrossel: texto cortado para caber no slide");
  return { ...resultado, tema: carrossel.tema };
}
