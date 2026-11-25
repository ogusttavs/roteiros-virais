import { NextResponse } from "next/server";

import { idDoParametro, marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { carrosselDaMarca, fotosDoCarrossel, trocarSlide } from "@/servicos/carrossel";

export const dynamic = "force-dynamic";

/** Um carrossel da marca da sessão, com os slides, a legenda e a lista de fotos (sem os bytes). De outra marca, 404. */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  const carrossel = id === null ? null : await carrosselDaMarca(marca.clienteId, id);
  if (!carrossel) return respostaDeErro("nao encontrado", 404);
  const fotos = await fotosDoCarrossel(marca.clienteId, carrossel.id);
  return NextResponse.json({ carrossel, fotos }, { headers: SEM_CACHE });
}

/** Troca o texto de um slide: `{ indice, titulo?, corpo?, fonte?, fotoId?, fotoDepoisId? }`. O tipo do slide não muda. */
export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  if (id === null) return respostaDeErro("nao encontrado", 404);
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return respostaDeErro("corpo do pedido invalido", 400);
  }
  if (typeof corpo.indice !== "number") return respostaDeErro("diga qual slide", 400);
  const numeroOuNulo = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" ? v : undefined);
  try {
    const atualizado = await trocarSlide(marca.clienteId, id, corpo.indice, {
      titulo: typeof corpo.titulo === "string" ? corpo.titulo : undefined,
      corpo: typeof corpo.corpo === "string" ? corpo.corpo : undefined,
      fonte: corpo.fonte === null ? null : typeof corpo.fonte === "string" ? corpo.fonte : undefined,
      fotoId: numeroOuNulo(corpo.fotoId),
      fotoDepoisId: numeroOuNulo(corpo.fotoDepoisId),
    });
    return NextResponse.json({ carrossel: atualizado }, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    throw erro;
  }
}
