/**
 * O "voltar" que uma tela leva na URL (`?voltar=<caminho>`, hotfix de 22/10/2026): o passo do objetivo do Criar manda a pessoa a Referências com o caminho de onde ela veio, e Referências mostra
 * "Voltar para o seu roteiro" que leva de volta. Como o valor vem da barra de endereço, só vale um caminho DE DENTRO do aplicativo dentro de `/criar/`: nada de outro site, de protocolo, de
 * `//` nem de barra invertida. Qualquer outra coisa vale como se o parâmetro não existisse.
 */
const TAMANHO_MAXIMO = 1500;
const BASE = "http://aplicativo.local";

export function caminhoDeVoltaValido(valor: string | null | undefined): string | null {
  if (!valor || valor.length > TAMANHO_MAXIMO) return null;
  if (!valor.startsWith("/criar/") || valor.startsWith("//") || valor.includes("\\")) return null;
   
  if (/[\u0000-\u001f\u007f]/.test(valor)) return null;
  try {
    const url = new URL(valor, BASE);
    if (url.origin !== BASE || !url.pathname.startsWith("/criar/")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
