import { NextResponse } from "next/server";

import { idDoParametro, marcaDoCarrossel, respostaDeErro, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { apagarFoto, fotoDaMarca } from "@/servicos/carrossel";

export const dynamic = "force-dynamic";

/** A foto, para a tela mostrar. Só da marca da sessão: de outra marca responde 404, igual a uma que não existe. */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string; fotoId: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const { fotoId } = await contexto.params;
  const id = idDoParametro(fotoId);
  const foto = id === null ? null : await fotoDaMarca(marca.clienteId, id);
  if (!foto) return respostaDeErro("nao encontrado", 404);
  return new NextResponse(new Uint8Array(foto.bytes), { headers: { "Content-Type": foto.tipo, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string; fotoId: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const parametros = await contexto.params;
  const carrosselId = idDoParametro(parametros.id);
  const fotoId = idDoParametro(parametros.fotoId);
  if (carrosselId === null || fotoId === null || !(await apagarFoto(marca.clienteId, carrosselId, fotoId))) return respostaDeErro("nao encontrado", 404);
  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}
