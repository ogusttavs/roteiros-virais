import { NextResponse } from "next/server";

import { caminhoDaAnimacaoNoVolume, tamanhoDoArquivoDaAnimacao } from "@/animacao/arquivos";
import { quemPodeVerOArquivo } from "@/lib/arquivo-da-edicao";
import { responderArquivo } from "@/lib/intervalo-http";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { arquivoDaAnimacaoParaVer } from "@/servicos/animacao";
import { fraseDaAnimacao } from "@/textos/animacao";

export const dynamic = "force-dynamic";

/**
 * E68 A2: o vídeo final 1080 por 1920 pronto. `GET /api/animacao/<id>/final` toca no navegador (com `Range`); com `?baixar=1` o navegador baixa o arquivo (`video-em-animacao.mp4`). Só da marca da sessão (que precisa estar na lista `ANIMACAO_CONTAS`), só enquanto o arquivo existe, e nunca no "ver como" (403, como o vídeo da edição). Outra marca, fora da lista e
 * sem arquivo respondem igual (404).
 */
export async function GET(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const dono = await quemPodeVerOArquivo(contexto);
  if (!("clienteId" in dono)) return dono;
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;
  const arquivo = await arquivoDaAnimacaoParaVer(dono.clienteId, dono.edicaoId, "final");
  const tamanho = arquivo ? await tamanhoDoArquivoDaAnimacao(arquivo.relativo) : null;
  if (!arquivo || tamanho === null) return NextResponse.json({ erro: fraseDaAnimacao("nao-achou"), codigo: "nao-achou" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return responderArquivo(request, { caminho: caminhoDaAnimacaoNoVolume(arquivo.relativo), tamanho, tipo: "video/mp4", baixarComo: new URL(request.url).searchParams.get("baixar") === "1" ? "video-em-animacao.mp4" : undefined });
}
