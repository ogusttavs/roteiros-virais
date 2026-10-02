/**
 * Monta o conjunto de campos que `dadosFixosSchema` espera para a coluna
 * `clientes.alcance` (V12c, item 1, a E37b; E42a, item 1, as duas opções novas: "outro_pais" e
 * "mais_de_um_pais"). Fica fora de `servicos/clientes.ts` porque esse arquivo importa coisa só de
 * servidor (banco, better-auth) e este helper precisa rodar no cliente (`DadosFixosForm.tsx`,
 * "use client"). O nome do campo é "alcance" só aqui dentro: a palavra está na lista de jargão do
 * cliente e o `checar-texto` reprova qualquer `.tsx` que a escreva (nota em `config/briefing.ts`,
 * `OndeOpcao`); este arquivo é `.ts`, fora do que o script varre.
 */
export type OndeValor = "brasil" | "local" | "outro_pais" | "mais_de_um_pais";

export function montarCampoOnde(
  onde: OndeValor,
  regiao: string,
  pais: string,
  paises: string,
): { alcance: OndeValor; regiao?: string; pais?: string; paises?: string } {
  return {
    alcance: onde,
    regiao: onde === "local" ? regiao : undefined,
    pais: onde === "outro_pais" ? pais : undefined,
    paises: onde === "mais_de_um_pais" ? paises : undefined,
  };
}
