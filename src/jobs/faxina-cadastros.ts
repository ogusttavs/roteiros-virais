/**
 * Job `faxina-cadastros` (E63 PR 1): todo dia, apaga a conta de cadastro próprio que nunca confirmou o e-mail em 7 dias, junto com a marca vazia que nasceu com ela, para o e-mail não ficar
 * preso. Deixa os números no resumo da execução, que a tela de rotinas do admin mostra.
 */
import { faxinarCadastrosSemConfirmar } from "@/servicos/cadastro";

export async function rodarFaxinaDosCadastros(agora = new Date()): Promise<Record<string, unknown>> {
  return { ...(await faxinarCadastrosSemConfirmar(agora)) };
}
