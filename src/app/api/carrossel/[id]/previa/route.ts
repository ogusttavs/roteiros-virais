import * as Sentry from "@sentry/node";
import { NextResponse } from "next/server";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { ErroFilaCheia } from "@/lib/chromium-de-impressao";
import { logger } from "@/lib/log";
import { idDoParametro, marcaDoCarrossel, respostaDeErro, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";

export const dynamic = "force-dynamic";

/** A escala da prévia: 0,4 dá 432 por 540, o bastante para a miniatura da tela e para ler o slide aberto. */
const ESCALA_DA_PREVIA = 0.4;

/**
 * A prévia dos slides para a tela: o MESMO render do PNG final, em escala menor, devolvido como imagem embutida (`data:`), uma por slide, com o aviso de qual slide precisa encurtar o texto e qual precisa de
 * uma foto. `?n=3` devolve só o slide 3 (depois de trocar o texto). Só da marca da sessão.
 */
export async function GET(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  if (id === null) return respostaDeErro("nao encontrado", 404);
  const n = new URL(request.url).searchParams.get("n");
  const somente = n === null ? undefined : idDoParametro(n);
  if (n !== null && somente === null) return respostaDeErro("nao encontrado", 404);
  try {
    const resultado = await pngDoCarrossel(marca.clienteId, id, somente === undefined || somente === null ? undefined : somente - 1, ESCALA_DA_PREVIA);
    if (!resultado) return respostaDeErro("nao encontrado", 404);
    const primeiro = somente ?? 1;
    return NextResponse.json(
      { slides: resultado.slides.map((s, i) => ({ n: primeiro + i, imagem: `data:image/png;base64,${s.png.toString("base64")}`, precisaEncurtar: s.precisaEncurtar, semFoto: s.semFoto })) },
      { headers: SEM_CACHE },
    );
  } catch (erro) {
    if (erro instanceof ErroFilaCheia) return respostaDeErro("muitos pedidos agora, tente de novo em instantes", 503);
    logger.error({ err: erro, carrosselId: id }, "carrossel: nao foi possivel gerar a previa");
    Sentry.captureException(erro, { tags: { rota: "carrossel-previa" }, extra: { carrosselId: id } });
    return respostaDeErro("nao foi possivel montar a previa agora, tente de novo", 504);
  }
}
