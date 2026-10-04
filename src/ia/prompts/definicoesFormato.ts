import { FORMATOS_DO_CATALOGO, FORMATOS_FORA_DO_CATALOGO } from "@/config/formatos";

/**
 * A lista fechada de formatos que a extração recebe (E44 PR 1): a chave e a definição de uma frase de cada uma, as treze do cliente primeiro e depois os valores que
 * nunca servem de modelo. A frase é a do estudo (`config/formatos.ts`), escrita para o cliente, que serve igual para o modelo.
 */
export function definicoesFormato(): string {
  const doCliente = FORMATOS_DO_CATALOGO.map((f) => `  - "${f.chave}": ${f.frase}`);
  const foraDoCatalogo = FORMATOS_FORA_DO_CATALOGO.map((f) => `  - "${f.chave}": ${f.frase}`);
  return [...doCliente, ...foraDoCatalogo].join("\n");
}
