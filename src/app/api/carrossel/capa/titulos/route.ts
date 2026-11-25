import { NextResponse } from "next/server";

import { logger } from "@/lib/log";
import { marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { titulosDaCapaComTrava } from "@/servicos/capa-noticia";

export const dynamic = "force-dynamic";

/**
 * E66, a capa de notícia: `{ noticiaId }` devolve de 3 a 5 títulos para a capa, mais o veículo e a data que vão nela (saem da notícia). Gasta IA, então passa pelo portão da cobrança e confere o teto
 * do teste como um roteiro (a capa criada é que conta; aqui só se barra quem já está no teto). Uma geração por marca de cada vez. A marca vem da sessão.
 */
export async function POST(request: Request) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca({ gasto: "roteiro" });
  if (recusa) return recusa;
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return respostaDeErro("corpo do pedido invalido", 400);
  }
  if (typeof corpo.noticiaId !== "number" || !Number.isInteger(corpo.noticiaId)) return respostaDeErro("diga qual noticia", 400);
  try {
    const resultado = await titulosDaCapaComTrava(marca.clienteId, corpo.noticiaId, () => recusaDaCobranca({ gasto: "roteiro" }));
    if ("recusa" in resultado) return resultado.recusa;
    return NextResponse.json(resultado.titulos, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    logger.error({ err: erro, clienteId: marca.clienteId }, "capa: nao foi possivel escrever os titulos");
    return respostaDeErro("nao foi possivel escrever os titulos agora, tente de novo", 500);
  }
}
