/**
 * As cores que o aparelho enxerga fora do CSS (V7, item 5 do PROXIMO.md): o
 * manifesto do aplicativo instalado e a cor da barra do navegador. Repetem
 * `--cor-fundo` de `src/ui/tokens.css` (claro e escuro), porque manifesto e
 * metatag nao leem CSS. `cores-do-aparelho.test.ts` confere os valores contra
 * o token, para a copia nao envelhecer quando a paleta mudar.
 */
export const COR_FUNDO_CLARO = "#f7f7f5";
export const COR_FUNDO_ESCURO = "#050506";
