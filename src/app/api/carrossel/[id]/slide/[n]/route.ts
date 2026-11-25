import * as Sentry from "@sentry/node";
import { NextResponse } from "next/server";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { ErroFilaCheia } from "@/lib/chromium-de-impressao";
import { logger } from "@/lib/log";
import { idDoParametro, marcaDoCarrossel, respostaDeErro } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";

export const dynamic = "force-dynamic";

/** Um slide em PNG, 1080 por 1350 (`n` de 1 até o total). Só da marca da sessão. */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string; n: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const parametros = await contexto.params;
  const id = idDoParametro(parametros.id);
  const n = idDoParametro(parametros.n);
  if (id === null || n === null) return respostaDeErro("nao encontrado", 404);
  try {
    const resultado = await pngDoCarrossel(marca.clienteId, id, n - 1);
    if (!resultado) return respostaDeErro("nao encontrado", 404);
    return new NextResponse(new Uint8Array(resultado.png[0]), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="slide-${String(n).padStart(2, "0")}.png"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (erro) {
    if (erro instanceof ErroFilaCheia) return respostaDeErro("muitos pedidos agora, tente de novo em instantes", 503);
    logger.error({ err: erro, carrosselId: id }, "carrossel: nao foi possivel gerar o slide");
    Sentry.captureException(erro, { tags: { rota: "carrossel-slide" }, extra: { carrosselId: id } });
    return respostaDeErro("nao foi possivel gerar a imagem agora, tente de novo", 504);
  }
}
