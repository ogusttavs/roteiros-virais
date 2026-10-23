/**
 * Job `embedar-videos` (E17 parte 1): guarda os vetores da busca por significado dos vídeos analisados. Só é agendado com `EMBEDDINGS_PREENCHER=1` (`agenda.ts`), e mesmo disparado à mão
 * (`npm run job -- embedar-videos`, ou "rodar agora" no admin) não faz nada com a chave desligada: devolve `{ desligado: true }` e a execução fica registrada como ok, sem chamar porta nenhuma.
 * O trabalho está em `servicos/vetores-dos-videos.ts`, com os tetos.
 */
import { config } from "@/lib/config";
import { preencherVetores, type OpcoesDoPreenchimento } from "@/servicos/vetores-dos-videos";

export async function rodarEmbedarVideos(opcoes: OpcoesDoPreenchimento & { ligado?: boolean } = {}): Promise<Record<string, unknown>> {
  const ligado = opcoes.ligado ?? config.embeddings.preencher;
  if (!ligado) return { desligado: true, motivo: "EMBEDDINGS_PREENCHER nao esta ligado" };
  return { ...(await preencherVetores({ porta: opcoes.porta, agora: opcoes.agora, videosPorRodada: opcoes.videosPorRodada, tetoUsdPorDia: opcoes.tetoUsdPorDia, textosPorChamada: opcoes.textosPorChamada })) };
}
