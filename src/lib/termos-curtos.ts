/**
 * E17 parte 1 (ajuste de 23/10/2026): os termos de 2 e 3 letras que SÃO a palavra do tema ("IA", "SEO", "MEI"). A busca por palavra descarta o que tem menos de 4 letras
 * (`palavrasChave`), e com isso um tema sobre IA perdia a única palavra que o definia (caso E07 da medição com dados reais: três vídeos certos sobre inteligência artificial,
 * nenhum achado). Aqui o termo curto é tratado como palavra inteira: casa pelo radical igual, nunca por grafia parecida nem por pedaço de etiqueta (duas letras casariam com tudo).
 *
 * Conta como termo curto: a sigla escrita em maiúsculas dentro de um texto que também tem minúsculas ("como usar IA na loja"), ou uma sigla conhecida em qualquer caixa
 * ("ia", "seo"). Texto todo em maiúsculas só vale pela lista de siglas (senão "DE" e "EM" virariam termo). Função pura.
 */
const SIGLAS_CONHECIDAS = new Set(["ia", "seo", "mei", "pix", "ads", "roi", "crm", "ppf", "rpg", "cpf"]);

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function termosCurtosDoTema(texto: string): string[] {
  const temMinuscula = /\p{Ll}/u.test(texto);
  const achados = new Set<string>();
  for (const pedaco of texto.split(/[^\p{L}]+/u)) {
    if (pedaco.length < 2 || pedaco.length > 3) continue;
    const normal = semAcento(pedaco);
    const emMaiusculas = pedaco === pedaco.toUpperCase() && pedaco !== pedaco.toLowerCase();
    if (SIGLAS_CONHECIDAS.has(normal) || (emMaiusculas && temMinuscula)) achados.add(normal);
  }
  return [...achados];
}
