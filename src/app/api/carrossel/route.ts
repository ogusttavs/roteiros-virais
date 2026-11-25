import { NextResponse } from "next/server";

import { logger } from "@/lib/log";
import { marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { carrosseisDaMarca, gerarCarrossel, type DeOndeVem } from "@/servicos/carrossel";

export const dynamic = "force-dynamic";

/** Os carrosséis da marca da sessão, do mais novo para o mais antigo. */
export async function GET() {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const lista = await carrosseisDaMarca(marca.clienteId);
  return NextResponse.json({ carrosseis: lista.map((c) => ({ id: c.id, tema: c.tema, quantidade: c.quantidade, criadoEm: c.criadoEm })) }, { headers: SEM_CACHE });
}

function deOndeVem(corpo: Record<string, unknown>): DeOndeVem | null {
  const de = corpo.de as Record<string, unknown> | undefined;
  if (!de || typeof de !== "object") return null;
  if (de.origem === "roteiro" && typeof de.roteiroId === "number") return { origem: "roteiro", roteiroId: de.roteiroId };
  if (de.origem === "noticia" && typeof de.noticiaId === "number") return { origem: "noticia", noticiaId: de.noticiaId };
  if (de.origem === "tema") return { origem: "tema", titulo: typeof de.titulo === "string" ? de.titulo : undefined, texto: typeof de.texto === "string" ? de.texto : undefined };
  return null;
}

/**
 * Cria um carrossel: `{ quantidade: 5 | 7 | 9, de: { origem: "tema", titulo | texto } | { origem: "roteiro", roteiroId } | { origem: "noticia", noticiaId }, cor?, observacao? }`.
 * Gasta IA, então passa pelo portão da cobrança e conta como um roteiro no teto do teste. A marca vem da sessão.
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
  const de = deOndeVem(corpo);
  if (!de) return respostaDeErro("diga de onde vem o carrossel", 400);
  try {
    const carrossel = await gerarCarrossel(marca.clienteId, {
      quantidade: typeof corpo.quantidade === "number" ? corpo.quantidade : Number.NaN,
      cor: typeof corpo.cor === "string" ? corpo.cor : undefined,
      observacao: typeof corpo.observacao === "string" ? corpo.observacao.slice(0, 500) : undefined,
      de,
    });
    return NextResponse.json({ id: carrossel.id }, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    logger.error({ err: erro, clienteId: marca.clienteId }, "carrossel: nao foi possivel gerar");
    return respostaDeErro("nao foi possivel criar o carrossel agora, tente de novo", 500);
  }
}
