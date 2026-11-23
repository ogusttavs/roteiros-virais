/**
 * Job `lembrete-fim-do-teste` (E22, o teste grátis): de hora em hora, manda ao dono da conta o e-mail "o seu teste grátis termina em 2 dias" e, no dia em que o teste acaba sem virar pagamento, "o seu teste grátis terminou" (`servicos/assinatura-teste.ts`). Deixa os números no
 * resumo da execução, que a tela de rotinas do admin mostra.
 */
import { avisarFimDoTeste, avisarTesteTerminado } from "@/servicos/assinatura-teste";

export async function rodarLembreteFimDoTeste(agora = new Date()): Promise<Record<string, unknown>> {
  const antes = await avisarFimDoTeste(agora);
  const terminado = await avisarTesteTerminado(agora);
  return { ...antes, terminadoCandidatas: terminado.candidatas, terminadoAvisadas: terminado.avisadas, terminadoSemDono: terminado.semDono, terminadoFalhas: terminado.falhas };
}
