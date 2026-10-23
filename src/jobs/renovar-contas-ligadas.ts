/**
 * Job `renovar-contas-ligadas` (E19 PR 1): todo dia, renova o acesso das contas de Instagram que as pessoas ligaram (antes de vencer), avisa por e-mail, uma vez, o dono da marca cuja
 * ligação não renova mais, e apaga as contas candidatas que ninguém escolheu. O resumo mostra só números, nunca nome de conta nem token (a tela de rotinas do admin o exibe).
 */
import { renovarContasLigadas } from "@/servicos/conta-conectada";

export async function rodarRenovarContasLigadas(agora = new Date()): Promise<Record<string, unknown>> {
  return { ...(await renovarContasLigadas(agora)) };
}
