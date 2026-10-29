import { NextResponse } from "next/server";

import { naoAchou, quemPodeVerOArquivo } from "@/lib/arquivo-da-edicao";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { legendaDaEdicao } from "@/servicos/edicao-tela";

export const dynamic = "force-dynamic";

/**
 * E47 PR 4: a legenda do vídeo pronto em arquivo (`legenda.srt`, SubRip), para quem quer acabar a edição em outro aplicativo. Os tempos são os do vídeo editado. Só da marca da sessão, só com a
 * edição pronta, e nunca no "ver como".
 */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const dono = await quemPodeVerOArquivo(contexto);
  if (!("clienteId" in dono)) return dono;
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;
  const srt = await legendaDaEdicao(dono.clienteId, dono.edicaoId);
  if (srt === null) return naoAchou();
  return new NextResponse(srt, {
    headers: { "Content-Type": "application/x-subrip; charset=utf-8", "Content-Disposition": 'attachment; filename="legenda.srt"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
