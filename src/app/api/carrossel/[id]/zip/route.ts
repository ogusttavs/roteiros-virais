import * as Sentry from "@sentry/node";
import { NextResponse } from "next/server";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { montarZip } from "@/carrossel/zip";
import { ErroFilaCheia } from "@/lib/chromium-de-impressao";
import { logger } from "@/lib/log";
import { idDoParametro, marcaDoCarrossel, respostaDeErro } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";

export const dynamic = "force-dynamic";

/** Todos os slides do carrossel num zip (`slide-01.png`, `slide-02.png`...), 1080 por 1350. Só da marca da sessão. */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  if (id === null) return respostaDeErro("nao encontrado", 404);
  try {
    const resultado = await pngDoCarrossel(marca.clienteId, id);
    if (!resultado) return respostaDeErro("nao encontrado", 404);
    const zip = montarZip(resultado.png.map((bytes, i) => ({ nome: `slide-${String(i + 1).padStart(2, "0")}.png`, bytes })));
    return new NextResponse(new Uint8Array(zip), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="carrossel.zip"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (erro) {
    if (erro instanceof ErroFilaCheia) return respostaDeErro("muitos pedidos agora, tente de novo em instantes", 503);
    logger.error({ err: erro, carrosselId: id }, "carrossel: nao foi possivel gerar o zip");
    Sentry.captureException(erro, { tags: { rota: "carrossel-zip" }, extra: { carrosselId: id } });
    return respostaDeErro("nao foi possivel gerar as imagens agora, tente de novo", 504);
  }
}
