import { caminhoNoVolume, tamanhoDoArquivoDaEdicao } from "@/edicao/arquivos";
import { naoAchou, quemPodeVerOArquivo } from "@/lib/arquivo-da-edicao";
import { responderArquivo } from "@/lib/intervalo-http";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { arquivoDaEdicaoParaVer } from "@/servicos/edicao-tela";

export const dynamic = "force-dynamic";

/**
 * E47 PR 4: o vídeo editado pronto (1080p, sem música), depois do sim da pessoa. `GET /api/edicao/<id>/pronto` toca no navegador (com `Range`); com `?baixar=1` o navegador baixa o arquivo
 * (`video-editado.mp4`). Só da marca da sessão, só com a edição pronta (7 dias de guarda), e nunca no "ver como".
 */
export async function GET(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const dono = await quemPodeVerOArquivo(contexto);
  if (!("clienteId" in dono)) return dono;
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;
  const arquivo = await arquivoDaEdicaoParaVer(dono.clienteId, dono.edicaoId, "editado");
  const tamanho = arquivo ? await tamanhoDoArquivoDaEdicao(arquivo.relativo) : null;
  if (!arquivo || tamanho === null) return naoAchou();
  const baixar = new URL(request.url).searchParams.get("baixar") === "1";
  return responderArquivo(request, { caminho: caminhoNoVolume(arquivo.relativo), tamanho, tipo: "video/mp4", baixarComo: baixar ? "video-editado.mp4" : undefined });
}
