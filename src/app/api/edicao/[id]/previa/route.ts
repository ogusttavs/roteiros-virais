import { caminhoNoVolume, tamanhoDoArquivoDaEdicao } from "@/edicao/arquivos";
import { naoAchou, quemPodeVerOArquivo } from "@/lib/arquivo-da-edicao";
import { responderArquivo } from "@/lib/intervalo-http";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { arquivoDaEdicaoParaVer } from "@/servicos/edicao-tela";

export const dynamic = "force-dynamic";

/**
 * E47 PR 4: a prévia 540p da edição, para a pessoa assistir antes de aprovar. `GET /api/edicao/<id>/previa` com `Range` (o Safari do iPhone só toca vídeo assim). Só da marca da sessão, só
 * enquanto a prévia existe, e nunca no "ver como" (o vídeo tem o rosto e a voz da pessoa).
 */
export async function GET(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const dono = await quemPodeVerOArquivo(contexto);
  if (!("clienteId" in dono)) return dono;
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;
  const arquivo = await arquivoDaEdicaoParaVer(dono.clienteId, dono.edicaoId, "previa");
  const tamanho = arquivo ? await tamanhoDoArquivoDaEdicao(arquivo.relativo) : null;
  if (!arquivo || tamanho === null) return naoAchou();
  return responderArquivo(request, { caminho: caminhoNoVolume(arquivo.relativo), tamanho, tipo: "video/mp4" });
}
