import { NextResponse } from "next/server";

import { logger } from "@/lib/log";
import { marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { criarCapaComTrava } from "@/servicos/capa-noticia";

export const dynamic = "force-dynamic";

/**
 * E66, a capa de notícia: `{ noticiaId, titulo, cor? }` cria a capa (um carrossel de um slide do tipo `noticia`) com o título escolhido ou escrito pela pessoa. Sem IA, mas conta como um roteiro no teto
 * do teste. A foto vem depois, por `/api/carrossel/<id>/fotos`. A marca vem da sessão.
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
  if (typeof corpo.titulo !== "string") return respostaDeErro("escolha o titulo da capa", 400);
  try {
    const resultado = await criarCapaComTrava(marca.clienteId, { noticiaId: corpo.noticiaId, titulo: corpo.titulo, cor: typeof corpo.cor === "string" ? corpo.cor : undefined }, () => recusaDaCobranca({ gasto: "roteiro" }));
    if ("recusa" in resultado) return resultado.recusa;
    return NextResponse.json({ id: resultado.capa.id }, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    logger.error({ err: erro, clienteId: marca.clienteId }, "capa: nao foi possivel criar");
    return respostaDeErro("nao foi possivel criar a capa agora, tente de novo", 500);
  }
}
