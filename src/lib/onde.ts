/**
 * Monta o par de campos que `dadosFixosSchema` espera para a coluna
 * `clientes.alcance` (V12c, item 1, a E37b). Fica fora de `servicos/clientes.ts`
 * porque esse arquivo importa coisa só de servidor (banco, better-auth) e este
 * helper precisa rodar no cliente (`DadosFixosForm.tsx`, "use client"). O nome
 * do campo é "alcance" só aqui dentro: a palavra está na lista de jargão do
 * cliente e o `checar-texto` reprova qualquer `.tsx` que a escreva (nota em
 * `config/briefing.ts`, `OndeOpcao`); este arquivo é `.ts`, fora do que o
 * script varre.
 */
export function montarCampoOnde(onde: "brasil" | "local", regiao: string): { alcance: "brasil" | "local"; regiao?: string } {
  return { alcance: onde, regiao: onde === "local" ? regiao : undefined };
}
