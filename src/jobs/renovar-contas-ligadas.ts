/**
 * Job `renovar-contas-ligadas` (E19 PR 1): todo dia, renova o acesso das contas de Instagram que as pessoas ligaram (antes de vencer), avisa por e-mail, uma vez, o dono da marca cuja
 * ligação não renova mais, e apaga as contas candidatas que ninguém escolheu.
 *
 * NÃO respeita o portão por assinatura das tarefas diárias (E22 PR 3), de propósito: renovar é uma chamada à Meta por conta por mês, sem IA nem coleta paga, e a marca que fica sem
 * assinatura por um mês e volta a assinar não pode ter perdido a ligação (a pessoa teria de refazer todo o caminho no aplicativo da Meta). Quem não assina deixa de ser LIDA (a curva
 * pula a marca), mas o acesso continua válido; o e-mail de aviso, quando a Meta recusa, também continua. O resumo mostra só números, nunca nome de conta nem token (a tela de rotinas do admin o exibe).
 */
import { varrerVideosVelhos } from "@/lib/video-temporario";
import { renovarContasLigadas } from "@/servicos/conta-conectada";

/**
 * E19b: o job também varre os vídeos temporários de publicação que ficaram para trás (processo que caiu no meio): o worker enxerga a mesma pasta do app (volume `roteiros_publicar`), então
 * a limpeza não depende de alguém subir outro vídeo. A conferência de cada publicação (`rodarConferenciaDaPublicacao`) também varre, a cada rodada.
 */
export async function rodarRenovarContasLigadas(agora = new Date()): Promise<Record<string, unknown>> {
  const videosVarridos = await varrerVideosVelhos(agora).catch(() => 0);
  return { ...(await renovarContasLigadas(agora)), videosVarridos };
}
