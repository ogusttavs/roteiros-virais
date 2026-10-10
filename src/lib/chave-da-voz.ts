/**
 * E28 (parte 3): a chave de uma voz do público (`chaveDaVoz`, 12 caracteres hexadecimais) como ela chega do navegador (`?pergunta=`, ou o argumento de uma Server Action). O que não tem
 * essa forma nunca vai adiante: nem à consulta, nem ao pedido guardado nas versões. A voz é sempre achada de novo no servidor, nas vozes do setor da marca da sessão.
 */
export function chaveDeVozValida(valor: unknown): string | undefined {
  return typeof valor === "string" && /^[0-9a-f]{12}$/.test(valor) ? valor : undefined;
}
