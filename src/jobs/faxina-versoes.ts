/**
 * Job `faxina-versoes` (E26 4c): todo dia, apaga as versões do roteiro que ninguém escolheu em grupos parados há mais de 30 dias (`DIAS_DAS_VERSOES_GUARDADAS`), para `versoes_do_roteiro`
 * não crescer para sempre (três linhas com o roteiro inteiro a cada geração). Deixa o número no resumo da execução, que a tela de rotinas do admin mostra.
 */
import { faxinarVersoes } from "@/servicos/versoes";

export async function rodarFaxinaDasVersoes(agora = new Date()): Promise<Record<string, unknown>> {
  return { ...(await faxinarVersoes(agora)) };
}
