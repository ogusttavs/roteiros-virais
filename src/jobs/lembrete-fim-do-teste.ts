/**
 * Job `lembrete-fim-do-teste` (E22, o teste grátis): de hora em hora, manda ao dono da conta o e-mail "o seu teste grátis termina em 2 dias" (`servicos/assinatura-teste.ts`). Deixa os números no
 * resumo da execução, que a tela de rotinas do admin mostra.
 */
import { avisarFimDoTeste } from "@/servicos/assinatura-teste";

export async function rodarLembreteFimDoTeste(agora = new Date()): Promise<Record<string, unknown>> {
  return { ...(await avisarFimDoTeste(agora)) };
}
